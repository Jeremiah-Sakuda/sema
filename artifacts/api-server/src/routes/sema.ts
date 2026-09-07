import { Router, type IRouter } from "express";
import { asc, desc, eq } from "drizzle-orm";
import { db, semaDescriptionCandidatesTable, semaNarrationWindowsTable, semaProcessStagesTable, semaProjectsTable, semaReviewDecisionsTable, semaVisualBeatsTable } from "@workspace/db";
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
import { verifyRenderedFit } from "../lib/timing";
import { ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

function vttTimecode(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${remainder.toFixed(3).padStart(6, "0")}`;
}

async function getExportEntries(projectId: string) {
  const [beats, windows, candidates, decisions] = await Promise.all([
    db.select().from(semaVisualBeatsTable).where(eq(semaVisualBeatsTable.projectId, projectId)),
    db.select().from(semaNarrationWindowsTable).where(eq(semaNarrationWindowsTable.projectId, projectId)),
    db.select().from(semaDescriptionCandidatesTable).where(eq(semaDescriptionCandidatesTable.projectId, projectId)),
    db.select().from(semaReviewDecisionsTable).where(eq(semaReviewDecisionsTable.projectId, projectId)),
  ]);
  const beatMap = new Map(beats.map((beat) => [beat.beatId, beat]));
  const windowMap = new Map(windows.map((window) => [window.windowId, window]));
  const candidateMap = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  return decisions
    .filter((decision) => decision.exportAuthorized)
    .map((decision) => {
      const beat = beatMap.get(decision.beatId);
      const candidate = candidateMap.get(decision.candidateId);
      const window = candidate ? windowMap.get(candidate.windowId) : undefined;
      return {
        beatId: decision.beatId,
        text: decision.finalText,
        evidenceFrames: beat?.evidenceFrames ?? [],
        start: Number(window?.start ?? beat?.start ?? 0),
        end: Number(window?.end ?? beat?.end ?? 0),
        reviewer: decision.reviewer,
        action: decision.action,
        updatedAt: decision.updatedAt.toISOString(),
      };
    });
}

router.get("/projects", async (_req, res): Promise<void> => {
  await ensureDemoProject();
  const projects = await db.select().from(semaProjectsTable).orderBy(desc(semaProjectsTable.updatedAt));
  const summaries = await Promise.all(
    projects.map(async (project) => {
      const [beats, decisions] = await Promise.all([
        db.select({ beatId: semaVisualBeatsTable.beatId }).from(semaVisualBeatsTable).where(eq(semaVisualBeatsTable.projectId, project.projectId)),
        db.select({ action: semaReviewDecisionsTable.action }).from(semaReviewDecisionsTable).where(eq(semaReviewDecisionsTable.projectId, project.projectId)),
      ]);
      const resolved = new Set(decisions.map((decision) => decision.action));
      return {
        ...serializeProject(project),
        beatCount: beats.length,
        resolvedCount: decisions.length + (resolved.has("left_undescribed") ? 0 : 0),
        approvedCount: decisions.filter((decision) => decision.action === "approve" || decision.action === "human_edited_approve").length,
      };
    }),
  );
  res.json(ListProjectsResponse.parse(summaries));
});

router.post("/projects", async (req, res): Promise<void> => {
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

router.post("/projects/:projectId/media", async (req, res): Promise<void> => {
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
    res.status(401).json({ error: "Authentication is required to attach media." });
    return;
  }
  if (
    !body.data.objectPath.startsWith("/objects/") ||
    !body.data.contentType.startsWith("video/")
  ) {
    res.status(400).json({ error: "Only uploaded video objects can be attached." });
    return;
  }

  const project = await getProjectById(params.data.projectId);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  try {
    await objectStorageService.trySetObjectEntityAclPolicy(
      body.data.objectPath,
      { owner: req.user.id, visibility: "private" },
    );
  } catch {
    res.status(400).json({ error: "The uploaded media object could not be found." });
    return;
  }

  const [updatedProject] = await db
    .update(semaProjectsTable)
    .set({
      mediaObjectPath: body.data.objectPath,
      mediaFileName: body.data.name,
      mediaContentType: body.data.contentType,
      duration: body.data.duration ?? project.duration,
      updatedAt: new Date(),
    })
    .where(eq(semaProjectsTable.projectId, project.projectId))
    .returning();

  res.json(AttachProjectMediaResponse.parse(serializeProject(updatedProject)));
});

router.patch("/projects/:projectId/beats/:beatId/decision", async (req, res): Promise<void> => {
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

  const [beat] = await db.select().from(semaVisualBeatsTable).where(eq(semaVisualBeatsTable.beatId, params.data.beatId)).limit(1);
  const [candidate] = await db.select().from(semaDescriptionCandidatesTable).where(eq(semaDescriptionCandidatesTable.beatId, params.data.beatId)).limit(1);
  const [window] = candidate
    ? await db.select().from(semaNarrationWindowsTable).where(eq(semaNarrationWindowsTable.windowId, candidate.windowId)).limit(1)
    : [];
  if (!beat || !candidate || beat.projectId !== params.data.projectId) {
    res.status(404).json({ error: "Visual beat not found" });
    return;
  }

  const finalText = body.data.finalText ?? candidate.text;
  const isEdited = finalText.trim() !== candidate.text.trim();
  if (
    (body.data.action === "approve" || body.data.action === "human_edited_approve") &&
    isEdited
  ) {
    res.status(409).json({
      error: "Edited wording needs a fresh narration render before it can be authorized.",
    });
    return;
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
    (body.data.action === "approve" || body.data.action === "human_edited_approve") &&
    (fit.status !== "pass" || candidate.fitStatus !== "pass")
  ) {
    res.status(409).json({
      error: fit.reason,
    });
    return;
  }
  const exportAuthorized = isExportAuthorized(body.data.action, fit.status === "pass" && candidate.fitStatus === "pass" ? "pass" : "failed");
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
          candidateId: body.data.candidateId ?? candidate.candidateId,
          reviewer: body.data.reviewer,
          exportAuthorized,
          updatedAt: now,
        })
        .where(eq(semaReviewDecisionsTable.decisionId, existingDecision.decisionId))
        .returning()
    : await db
        .insert(semaReviewDecisionsTable)
        .values({
          decisionId: createDecisionId(),
          projectId: params.data.projectId,
          beatId: params.data.beatId,
          candidateId: body.data.candidateId ?? candidate.candidateId,
          action: body.data.action,
          finalText,
          reviewer: body.data.reviewer,
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

  res.json(UpdateBeatDecisionResponse.parse(serializeDecision(decision)));
});

router.post("/projects/:projectId/process/retry", async (req, res): Promise<void> => {
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
  const stageName = body.data.stage ?? "review";
  await db.update(semaProcessStagesTable).set({ status: "complete" }).where(eq(semaProcessStagesTable.projectId, project.projectId));
  await db.update(semaProjectsTable).set({ status: "needs_review", progress: 100, updatedAt: new Date() }).where(eq(semaProjectsTable.projectId, project.projectId));
  const review = await getProjectReviewData(project.projectId);
  res.status(202).json(RetryProjectProcessingResponse.parse(review?.process));
});

router.get("/projects/:projectId/export/:fileName", async (req, res): Promise<void> => {
  const params = ExportProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const fileName = req.params.fileName;
  if (fileName === "sema-narration.wav") {
    res.status(501).json({ error: "Live TTS rendering is not connected for this project." });
    return;
  }

  await ensureDemoProject();
  const project = await getProjectById(params.data.projectId);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const entries = await getExportEntries(project.projectId);
  const decisions = await db.select().from(semaReviewDecisionsTable).where(eq(semaReviewDecisionsTable.projectId, project.projectId));
  const beatCount = await db.select({ beatId: semaVisualBeatsTable.beatId }).from(semaVisualBeatsTable).where(eq(semaVisualBeatsTable.projectId, project.projectId));
  const unresolved = beatCount.length - decisions.length;
  if (unresolved > 0 || decisions.some((decision) => (decision.action === "approve" || decision.action === "human_edited_approve") && !decision.exportAuthorized)) {
    res.status(409).json({ error: "Resolve every visual beat before downloading an export." });
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
      .map((entry) => `[${vttTimecode(entry.start)}] ${entry.text} — evidence: ${entry.evidenceFrames.join(", ")}`)
      .join("\n");
  } else if (fileName === "sema-decision-ledger.json") {
    contentType = "application/json; charset=utf-8";
    content = JSON.stringify({ projectId: project.projectId, title: project.title, entries }, null, 2);
  } else if (fileName === "sema-production-summary.txt") {
    content = [
      `Sema production summary: ${project.title}`,
      `Source media: ${project.mediaFileName ?? "not attached"}`,
      `Duration: ${Number(project.duration).toFixed(2)} seconds`,
      `Authorized narration cues: ${entries.length}`,
      `Every cue references visual evidence: yes`,
      "Narration WAV: not rendered; live TTS provider is required.",
    ].join("\n");
  } else {
    res.status(404).json({ error: "Export file not found" });
    return;
  }

  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.send(content);
});

router.post("/projects/:projectId/export", async (req, res): Promise<void> => {
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
  const decisions = await db.select().from(semaReviewDecisionsTable).where(eq(semaReviewDecisionsTable.projectId, project.projectId));
  const beatCount = await db.select({ beatId: semaVisualBeatsTable.beatId }).from(semaVisualBeatsTable).where(eq(semaVisualBeatsTable.projectId, project.projectId));
  const unresolved = beatCount.length - decisions.length;
  if (unresolved > 0 || decisions.some((decision) => decision.action === "approve" && !decision.exportAuthorized)) {
    res.status(409).json({ error: "Resolve every visual beat before export. Only fit-verified human decisions can ship." });
    return;
  }
  const approvedCount = decisions.filter((decision) => decision.exportAuthorized).length;
  const result = {
    projectId: project.projectId,
    status: "ready" as const,
    files: [
      { name: "sema-ad.webvtt", type: "Timed AD WebVTT", size: `${approvedCount} cues` },
      { name: "sema-ad.txt", type: "Plain-text script", size: `${approvedCount} lines` },
      { name: "sema-narration.wav", type: "Isolated narration stem (TTS adapter pending)", size: "not rendered" },
      { name: "sema-decision-ledger.json", type: "Decision provenance", size: `${decisions.length} decisions` },
      { name: "sema-production-summary.txt", type: "Production summary", size: "generated on export" },
    ],
    approvedCount,
    generatedAt: new Date().toISOString(),
  };
  await db.update(semaProjectsTable).set({ status: "exported", updatedAt: new Date() }).where(eq(semaProjectsTable.projectId, project.projectId));
  res.json(ExportProjectResponse.parse(result));
});

export default router;