import { Router, type IRouter, type RequestHandler } from "express";
import { and, or, asc, desc, eq } from "drizzle-orm";
import {
  db,
  semaDescriptionCandidatesTable,
  semaNarrationWindowsTable,
  semaProcessStagesTable,
  semaProjectsTable,
  semaReviewDecisionsTable,
  semaVisualBeatsTable,
  semaUploadsTable,
  semaProcessingTable,
  semaExecutionEventsTable,
} from "@workspace/db";
import {
  CreateProjectBody,
  CreateProjectResponse,
  AttachProjectMediaBody,
  AttachProjectMediaParams,
  AttachProjectMediaResponse,
  ExportProjectParams,
  ExportProjectResponse,
  GetProjectParams,
  GetProjectResponse,
  GetProjectReviewParams,
  GetProjectReviewResponse,
  ListProjectsResponse,
  RetryProjectProcessingBody,
  RetryProjectProcessingParams,
  RetryProjectProcessingResponse,
  UpdateBeatDecisionBody,
  UpdateBeatDecisionParams,
  UpdateBeatDecisionResponse,
} from "@workspace/api-zod";
import {
  createDecisionId,
  createProjectId,
  ensureDemoProject,
  getProjectById,
  getProjectReviewData,
  isExportAuthorized,
  pipelineStages,
  serializeDecision,
  serializeProject,
} from "../lib/sema-demo";
import { hasProtectedCollision, verifyRenderedFit } from "../lib/timing";
import { ObjectStorageService } from "../lib/objectStorage";

import { GoogleCloudProvider, googleConfiguration } from "../lib/google-cloud";
import { parseWave } from "../lib/wave";
import {
  audioHash,
  verifiedExport,
  withProjectLock,
  ExportValidationError,
} from "../lib/processing";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

function vttTimecode(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${remainder.toFixed(3).padStart(6, "0")}`;
}

router.use("/projects/:projectId", async (req, res, next) => {
  await ensureDemoProject();
  const projectId = String(req.params.projectId);
  const project = await getProjectById(projectId);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  if (projectId === "demo-project" && req.method === "GET") {
    next();
    return;
  }
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  if (project.ownerId !== req.user.id) {
    res.status(403).json({ error: "You do not own this project." });
    return;
  }
  next();
});

function locked(handler: RequestHandler): RequestHandler {
  return async (req, res, next) => {
    try {
      await withProjectLock(String(req.params.projectId), async () => {
        await handler(req, res, next);
      });
    } catch {
      if (!res.headersSent)
        res
          .status(409)
          .json({
            error:
              "Project is busy or unavailable. Try again after processing completes.",
          });
    }
  };
}

router.get("/projects", async (req, res): Promise<void> => {
  await ensureDemoProject();
  const projects = await db
    .select()
    .from(semaProjectsTable)
    .where(
      req.isAuthenticated()
        ? or(
            eq(semaProjectsTable.ownerId, req.user.id),
            eq(semaProjectsTable.projectId, "demo-project"),
          )
        : eq(semaProjectsTable.projectId, "demo-project"),
    )
    .orderBy(desc(semaProjectsTable.updatedAt));
  const summaries = await Promise.all(
    projects.map(async (project) => {
      const [beats, decisions] = await Promise.all([
        db
          .select({ beatId: semaVisualBeatsTable.beatId })
          .from(semaVisualBeatsTable)
          .where(eq(semaVisualBeatsTable.projectId, project.projectId)),
        db
          .select({ action: semaReviewDecisionsTable.action })
          .from(semaReviewDecisionsTable)
          .where(eq(semaReviewDecisionsTable.projectId, project.projectId)),
      ]);
      const resolved = new Set(decisions.map((decision) => decision.action));
      return {
        ...serializeProject(project),
        beatCount: beats.length,
        resolvedCount:
          decisions.length + (resolved.has("left_undescribed") ? 0 : 0),
        approvedCount: decisions.filter(
          (decision) =>
            decision.action === "approve" ||
            decision.action === "human_edited_approve",
        ).length,
      };
    }),
  );
  res.json(ListProjectsResponse.parse(summaries));
});

router.post("/projects", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Log in to create a project." });
    return;
  }
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const projectId = createProjectId();
  const [project] = await db
    .insert(semaProjectsTable)
    .values({
      projectId,
      ownerId: req.user.id,
      title: parsed.data.title,
      describerName: parsed.data.describerName,
      duration: 0,
      status: "processing",
      progress: 0,
    })
    .returning();

  await db.insert(semaProcessStagesTable).values(
    pipelineStages.map(([name, label], position) => ({
      stageId: `${projectId}-${name}`,
      projectId,
      name,
      label,
      status: position === 0 ? "active" : "pending",
      position,
    })),
  );

  res.status(201).json(CreateProjectResponse.parse(serializeProject(project)));
});

router.get("/projects/:projectId", async (req, res): Promise<void> => {
  const params = GetProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await ensureDemoProject();
  const project = await getProjectById(params.data.projectId);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json(GetProjectResponse.parse(serializeProject(project)));
});

router.get("/projects/:projectId/review", async (req, res): Promise<void> => {
  const params = GetProjectReviewParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await ensureDemoProject();
  const review = await getProjectReviewData(params.data.projectId);
  if (!review) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json(GetProjectReviewResponse.parse(review));
});

router.get(
  "/projects/:projectId/candidates/:candidateId/audio",
  async (req, res) => {
    const [candidate] = await db
      .select()
      .from(semaDescriptionCandidatesTable)
      .where(
        and(
          eq(
            semaDescriptionCandidatesTable.projectId,
            String(req.params.projectId),
          ),
          eq(
            semaDescriptionCandidatesTable.candidateId,
            String(req.params.candidateId),
          ),
        ),
      )
      .limit(1);
    const [processing] = await db
      .select()
      .from(semaProcessingTable)
      .where(eq(semaProcessingTable.projectId, String(req.params.projectId)));
    const render =
      candidate && processing?.manifest.renders[candidate.candidateId];
    if (!render) {
      res.status(404).json({ error: "Narration has not been rendered." });
      return;
    }
    try {
      const [audio] = await (
        await objectStorageService.getObjectEntityFile(render.objectPath)
      ).download();
      if (audioHash(audio) !== render.sha256) throw new Error("Audio changed.");
      res.setHeader("Content-Type", "audio/wav");
      res.setHeader("Cache-Control", "private, no-store");
      res.send(audio);
    } catch {
      res.status(503).json({ error: "Narration is temporarily unavailable." });
    }
  },
);

router.get("/projects/:projectId/processing-trace", async (req, res) => {
  const projectId = String(req.params.projectId);
  const events = await db
    .select()
    .from(semaExecutionEventsTable)
    .where(eq(semaExecutionEventsTable.projectId, projectId))
    .orderBy(asc(semaExecutionEventsTable.createdAt));
  const [processing] = await db
    .select()
    .from(semaProcessingTable)
    .where(eq(semaProcessingTable.projectId, projectId));
  res.setHeader("Cache-Control", "private, no-store");
  res.json({
    events,
    protectedIntervals: processing?.manifest.protectedIntervals ?? [],
  });
});

router.post(
  "/projects/:projectId/media",
  locked(async (req, res): Promise<void> => {
    const params = AttachProjectMediaParams.safeParse(req.params);
    const body = AttachProjectMediaBody.safeParse(req.body);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    if (!req.isAuthenticated()) {
      res
        .status(401)
        .json({ error: "Authentication is required to attach media." });
      return;
    }
    if (
      !body.data.objectPath.startsWith("/objects/") ||
      !body.data.contentType.startsWith("video/")
    ) {
      res
        .status(400)
        .json({ error: "Only uploaded video objects can be attached." });
      return;
    }

    const project = await getProjectById(params.data.projectId);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (project.mediaObjectPath) {
      res
        .status(409)
        .json({
          error: "Create a new project to use a different source video.",
        });
      return;
    }
    const [upload] = await db
      .select()
      .from(semaUploadsTable)
      .where(
        and(
          eq(semaUploadsTable.objectPath, body.data.objectPath),
          eq(semaUploadsTable.ownerId, req.user.id),
        ),
      )
      .limit(1);
    if (!upload) {
      res
        .status(403)
        .json({
          error: "This upload does not belong to you. Upload the source again.",
        });
      return;
    }
    try {
      googleConfiguration();
    } catch (error) {
      res
        .status(503)
        .json({
          error:
            error instanceof Error
              ? error.message
              : "Configure Google Cloud in Replit Secrets.",
        });
      return;
    }
    let sourcePath: string;
    try {
      sourcePath = await objectStorageService.snapshotUpload(
        body.data.objectPath,
        req.user.id,
      );
    } catch {
      res
        .status(400)
        .json({
          error: "The uploaded video is missing, empty, or larger than 250 MB.",
        });
      return;
    }

    const [updatedProject] = await db
      .update(semaProjectsTable)
      .set({
        mediaObjectPath: sourcePath,
        mediaFileName: body.data.name,
        mediaContentType: body.data.contentType,
        duration: 0,
        status: "processing",
        progress: 0,
        updatedAt: new Date(),
      })
      .where(eq(semaProjectsTable.projectId, project.projectId))
      .returning();

    res.json(
      AttachProjectMediaResponse.parse(serializeProject(updatedProject)),
    );
  }),
);

router.patch(
  "/projects/:projectId/beats/:beatId/decision",
  locked(async (req, res): Promise<void> => {
    const params = UpdateBeatDecisionParams.safeParse(req.params);
    const body = UpdateBeatDecisionBody.safeParse(req.body);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    await ensureDemoProject();
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }
    const reviewer =
      [req.user.firstName, req.user.lastName].filter(Boolean).join(" ") ||
      req.user.id;

    const [beat] = await db
      .select()
      .from(semaVisualBeatsTable)
      .where(eq(semaVisualBeatsTable.beatId, params.data.beatId))
      .limit(1);
    let [candidate] = await db
      .select()
      .from(semaDescriptionCandidatesTable)
      .where(
        and(
          eq(semaDescriptionCandidatesTable.beatId, params.data.beatId),
          ...(body.data.candidateId
            ? [
                eq(
                  semaDescriptionCandidatesTable.candidateId,
                  body.data.candidateId,
                ),
              ]
            : []),
        ),
      )
      .limit(1);
    const [window] = candidate
      ? await db
          .select()
          .from(semaNarrationWindowsTable)
          .where(eq(semaNarrationWindowsTable.windowId, candidate.windowId))
          .limit(1)
      : [];
    if (
      !beat ||
      !candidate ||
      beat.projectId !== params.data.projectId ||
      candidate.projectId !== params.data.projectId ||
      (window && window.projectId !== params.data.projectId)
    ) {
      res.status(404).json({ error: "Visual beat not found" });
      return;
    }

    const project = await getProjectById(params.data.projectId);
    if (!project || !["needs_review", "exported"].includes(project.status)) {
      res.status(409).json({ error: "Finish processing before reviewing." });
      return;
    }
    const finalText = (body.data.finalText ?? candidate.text).trim();
    const approving =
      body.data.action === "approve" ||
      body.data.action === "human_edited_approve";
    const [processing] = await db
      .select()
      .from(semaProcessingTable)
      .where(eq(semaProcessingTable.projectId, params.data.projectId));
    if (approving) {
      if (
        !finalText ||
        !processing ||
        processing.manifest.source !== project.mediaObjectPath ||
        !window ||
        window.protectedCollision ||
        hasProtectedCollision(window, processing.manifest.protectedIntervals)
      ) {
        res
          .status(409)
          .json({
            error: "Approval requires rendered narration in a safe window.",
          });
        return;
      }
      try {
        let render = processing.manifest.renders[candidate.candidateId];
        if (!render || render.text !== finalText) {
          const audio = await new GoogleCloudProvider().synthesize(finalText);
          const measured = parseWave(audio).duration;
          const fit = verifyRenderedFit({ window, renderedDuration: measured });
          if (fit.status !== "pass") {
            res.status(409).json({ error: fit.reason });
            return;
          }
          const objectPath = await objectStorageService.savePrivateArtifact(
            audio,
            "audio/wav",
            req.user.id,
          );
          render = { objectPath, text: finalText, sha256: audioHash(audio) };
          processing.manifest.renders[candidate.candidateId] = render;
          await db.transaction(async (tx) => {
            await tx
              .update(semaProcessingTable)
              .set({ manifest: processing.manifest })
              .where(eq(semaProcessingTable.projectId, params.data.projectId));
            await tx
              .update(semaDescriptionCandidatesTable)
              .set({
                text: finalText,
                ttsDuration: measured,
                fitStatus: "pass",
                attempt: candidate.attempt + 1,
              })
              .where(
                eq(
                  semaDescriptionCandidatesTable.candidateId,
                  candidate.candidateId,
                ),
              );
            await tx
              .update(semaReviewDecisionsTable)
              .set({ exportAuthorized: false })
              .where(eq(semaReviewDecisionsTable.beatId, beat.beatId));
          });
          candidate = {
            ...candidate,
            text: finalText,
            ttsDuration: measured,
            fitStatus: "pass",
          };
        }
        const [audio] = await (
          await objectStorageService.getObjectEntityFile(render.objectPath)
        ).download();
        if (audioHash(audio) !== render.sha256)
          throw new Error("Stored audio changed.");
        candidate.ttsDuration = parseWave(audio).duration;
      } catch {
        res
          .status(503)
          .json({
            error:
              "Narration could not be rendered or verified. Check provider configuration and storage, then retry.",
          });
        return;
      }
    }
    const fit = window
      ? verifyRenderedFit({
          window: { start: Number(window.start), end: Number(window.end) },
          renderedDuration: Number(candidate.ttsDuration),
          protectedCollision: window.protectedCollision,
        })
      : {
          status: "failed" as const,
          availableDuration: 0,
          requiredDuration: Number(candidate.ttsDuration) + 0.2,
          reason: "The narration window could not be found.",
        };
    if (
      (body.data.action === "approve" ||
        body.data.action === "human_edited_approve") &&
      (fit.status !== "pass" || candidate.fitStatus !== "pass")
    ) {
      res.status(409).json({
        error: fit.reason,
      });
      return;
    }
    const exportAuthorized = isExportAuthorized(
      body.data.action,
      fit.status === "pass" && candidate.fitStatus === "pass"
        ? "pass"
        : "failed",
    );
    const now = new Date();
    const [existingDecision] = await db
      .select()
      .from(semaReviewDecisionsTable)
      .where(eq(semaReviewDecisionsTable.beatId, params.data.beatId))
      .limit(1);
    const [decision] = existingDecision
      ? await db
          .update(semaReviewDecisionsTable)
          .set({
            action: body.data.action,
            finalText,
            candidateId: candidate.candidateId,
            reviewer,
            exportAuthorized,
            updatedAt: now,
          })
          .where(
            eq(
              semaReviewDecisionsTable.decisionId,
              existingDecision.decisionId,
            ),
          )
          .returning()
      : await db
          .insert(semaReviewDecisionsTable)
          .values({
            decisionId: createDecisionId(),
            projectId: params.data.projectId,
            beatId: params.data.beatId,
            candidateId: candidate.candidateId,
            action: body.data.action,
            finalText,
            reviewer,
            exportAuthorized,
            updatedAt: now,
          })
          .returning();

    await db
      .update(semaVisualBeatsTable)
      .set({
        state:
          body.data.action === "approve"
            ? "approved"
            : body.data.action === "human_edited_approve"
              ? "human_edited"
              : body.data.action === "reject"
                ? "rejected"
                : body.data.action,
      })
      .where(eq(semaVisualBeatsTable.beatId, beat.beatId));

    await db
      .update(semaProjectsTable)
      .set({ status: "needs_review", updatedAt: new Date() })
      .where(eq(semaProjectsTable.projectId, params.data.projectId));
    await db
      .insert(semaExecutionEventsTable)
      .values({
        eventId: createDecisionId(),
        projectId: params.data.projectId,
        runId: "human-review",
        stage: "review",
        event: "human_decision",
        details: {
          candidateId: candidate.candidateId,
          action: decision.action,
          reviewerId: req.user.id,
          exportAuthorized,
          measuredSeconds: candidate.ttsDuration,
        },
      });
    res.json(UpdateBeatDecisionResponse.parse(serializeDecision(decision)));
  }),
);

router.post(
  "/projects/:projectId/process/retry",
  locked(async (req, res): Promise<void> => {
    const params = RetryProjectProcessingParams.safeParse(req.params);
    const body = RetryProjectProcessingBody.safeParse(req.body ?? {});
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    await ensureDemoProject();
    const project = await getProjectById(params.data.projectId);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!project.mediaObjectPath || project.status !== "failed") {
      res
        .status(409)
        .json({ error: "Only failed source processing can be retried." });
      return;
    }
    try {
      googleConfiguration();
    } catch (error) {
      res
        .status(503)
        .json({
          error:
            error instanceof Error ? error.message : "Configure Google Cloud.",
        });
      return;
    }
    await db
      .update(semaProcessStagesTable)
      .set({ status: "pending" })
      .where(eq(semaProcessStagesTable.projectId, project.projectId));
    await db
      .update(semaProcessStagesTable)
      .set({ status: "active" })
      .where(
        and(
          eq(semaProcessStagesTable.projectId, project.projectId),
          eq(semaProcessStagesTable.name, "validate"),
        ),
      );
    await db
      .update(semaProjectsTable)
      .set({ status: "processing", progress: 0, updatedAt: new Date() })
      .where(eq(semaProjectsTable.projectId, project.projectId));
    const review = await getProjectReviewData(project.projectId);
    res.status(202).json(RetryProjectProcessingResponse.parse(review?.process));
  }),
);

router.get(
  "/projects/:projectId/export/:fileName",
  locked(async (req, res): Promise<void> => {
    const params = ExportProjectParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const fileName = req.params.fileName;

    await ensureDemoProject();
    const project = await getProjectById(params.data.projectId);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    let bundle;
    try {
      bundle = await verifiedExport(project.projectId);
    } catch (error) {
      res
        .status(409)
        .json({
          error:
            error instanceof ExportValidationError
              ? error.message
              : "Stored narration could not be verified. Check storage access and retry.",
        });
      return;
    }
    const { entries } = bundle;
    if (fileName === "sema-narration.wav") {
      res.setHeader("Content-Type", "audio/wav");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="sema-narration.wav"',
      );
      res.send(bundle.audio);
      return;
    }

    let content: string;
    let contentType = "text/plain; charset=utf-8";
    if (fileName === "sema-ad.webvtt") {
      contentType = "text/vtt; charset=utf-8";
      content = [
        "WEBVTT",
        "",
        ...entries.flatMap((entry) => [
          `NOTE beat=${entry.beatId} evidence=${entry.evidenceFrames.join(",")}`,
          `${vttTimecode(entry.start)} --> ${vttTimecode(entry.end)}`,
          entry.text,
          "",
        ]),
      ].join("\n");
    } else if (fileName === "sema-ad.txt") {
      content = entries
        .map(
          (entry) =>
            `[${vttTimecode(entry.start)}] ${entry.text} — evidence: ${entry.evidenceFrames.join(", ")}`,
        )
        .join("\n");
    } else if (fileName === "sema-decision-ledger.json") {
      contentType = "application/json; charset=utf-8";
      const events = await db
        .select()
        .from(semaExecutionEventsTable)
        .where(eq(semaExecutionEventsTable.projectId, project.projectId))
        .orderBy(asc(semaExecutionEventsTable.createdAt));
      content = JSON.stringify(
        {
          projectId: project.projectId,
          title: project.title,
          entries,
          decisions: bundle.decisions,
          executionTrace: events,
        },
        null,
        2,
      );
    } else if (fileName === "sema-production-summary.txt") {
      content = [
        `Sema production summary: ${project.title}`,
        `Source media: ${project.mediaFileName ?? "not attached"}`,
        `Duration: ${Number(project.duration).toFixed(2)} seconds`,
        `Authorized narration cues: ${entries.length}`,
        `Every cue references visual evidence: yes`,
        "Narration WAV: measured samples verified against protected intervals and approved wording.",
      ].join("\n");
    } else {
      res.status(404).json({ error: "Export file not found" });
      return;
    }

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(content);
  }),
);

router.post(
  "/projects/:projectId/export",
  locked(async (req, res): Promise<void> => {
    const params = ExportProjectParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    await ensureDemoProject();
    const project = await getProjectById(params.data.projectId);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    let bundle;
    try {
      bundle = await verifiedExport(project.projectId);
    } catch (error) {
      res
        .status(409)
        .json({
          error:
            error instanceof ExportValidationError
              ? error.message
              : "Stored narration could not be verified. Check storage access and retry.",
        });
      return;
    }
    const { decisions } = bundle;
    const approvedCount = bundle.entries.length;
    const result = {
      projectId: project.projectId,
      status: "ready" as const,
      files: [
        {
          name: "sema-ad.webvtt",
          type: "Timed AD WebVTT",
          size: `${approvedCount} cues`,
        },
        {
          name: "sema-ad.txt",
          type: "Plain-text script",
          size: `${approvedCount} lines`,
        },
        {
          name: "sema-narration.wav",
          type: "Isolated narration stem",
          size: `${bundle.audio.length} bytes`,
        },
        {
          name: "sema-decision-ledger.json",
          type: "Decision provenance",
          size: `${decisions.length} decisions`,
        },
        {
          name: "sema-production-summary.txt",
          type: "Production summary",
          size: "generated on export",
        },
      ],
      approvedCount,
      generatedAt: new Date().toISOString(),
    };
    await db
      .update(semaProjectsTable)
      .set({ status: "exported", updatedAt: new Date() })
      .where(eq(semaProjectsTable.projectId, project.projectId));
    res.json(ExportProjectResponse.parse(result));
  }),
);

export default router;
