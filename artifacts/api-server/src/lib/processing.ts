import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import {
  db,
  pool,
  semaProjectsTable,
  semaProcessStagesTable,
  semaReviewDecisionsTable,
  semaVisualBeatsTable,
  semaNarrationWindowsTable,
  semaDescriptionCandidatesTable,
  semaProcessingTable,
  semaExecutionEventsTable,
  type ProcessingManifest,
} from "@workspace/db";
import { GoogleCloudProvider } from "./google-cloud";
import {
  audibleIntervals,
  evidenceFrame,
  extractPcm,
  inspectMedia,
  videoClip,
} from "./media";
import {
  hasProtectedCollision,
  mergeIntervals,
  narrationWindows,
  verifyRenderedFit,
} from "./timing";
import { parseWave, narrationStem } from "./wave";
import { ObjectStorageService } from "./objectStorage";
import { pipelineStages, getProjectById } from "./sema-demo";
import { logger } from "./logger";
import {
  MAX_SOURCE_VIDEO_BYTES,
  MAX_SOURCE_VIDEO_LABEL,
} from "./source-video";

const storage = new ObjectStorageService();
export const audioHash = (audio: Buffer) =>
  createHash("sha256").update(audio).digest("hex");

// The same database lock guards processing, review writes and exports across instances.
export async function withProjectLock<T>(
  projectId: string,
  work: () => Promise<T>,
): Promise<T> {
  const connection = await pool.connect();
  let locked = false;
  try {
    const result = await connection.query(
      "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked",
      [`sema:${projectId}`],
    );
    locked = result.rows[0].locked;
    if (!locked)
      throw new Error("Project is busy. Try again after processing completes.");
    return await work();
  } finally {
    try {
      if (locked)
        await connection.query(
          "SELECT pg_advisory_unlock(hashtextextended($1, 0))",
          [`sema:${projectId}`],
        );
    } finally {
      connection.release();
    }
  }
}

async function processProject(projectId: string) {
  const project = await getProjectById(projectId);
  if (
    !project ||
    project.status !== "processing" ||
    !project.mediaObjectPath ||
    !project.ownerId
  )
    return;
  let directory: string | undefined;
  let activeStage = "validate";
  const runId = randomUUID();
  async function trace(
    event: string,
    details: Record<string, string | number | boolean> = {},
  ) {
    await db
      .insert(semaExecutionEventsTable)
      .values({
        eventId: randomUUID(),
        projectId,
        runId,
        stage: activeStage,
        event,
        details,
      });
  }
  const generated: string[] = [];
  let committed = false;
  async function stage(name: (typeof pipelineStages)[number][0]) {
    activeStage = name;
    await trace("stage_started");
    const index = pipelineStages.findIndex(([key]) => key === name);
    await db.transaction(async (tx) => {
      for (const [position, [key]] of pipelineStages.entries())
        await tx
          .update(semaProcessStagesTable)
          .set({
            status:
              position < index
                ? "complete"
                : position === index
                  ? "active"
                  : "pending",
          })
          .where(
            and(
              eq(semaProcessStagesTable.projectId, projectId),
              eq(semaProcessStagesTable.name, key),
            ),
          );
      await tx
        .update(semaProjectsTable)
        .set({
          progress: Math.floor((index / pipelineStages.length) * 100),
          updatedAt: new Date(),
        })
        .where(eq(semaProjectsTable.projectId, projectId));
    });
  }
  try {
    await stage("validate");
    const provider = new GoogleCloudProvider();
    directory = await mkdtemp(join(tmpdir(), "sema-media-"));
    const source = join(directory, "source");
    const sourceFile = await storage.getObjectEntityFile(
      project.mediaObjectPath,
    );
    const [metadata] = await sourceFile.getMetadata();
    if (Number(metadata.size) > MAX_SOURCE_VIDEO_BYTES)
      throw new Error(`Source video exceeds ${MAX_SOURCE_VIDEO_LABEL}.`);
    let downloaded = 0;
    await pipeline(
      sourceFile.createReadStream(),
      new Transform({
        transform(chunk, _encoding, callback) {
          downloaded += chunk.length;
          callback(
            downloaded > MAX_SOURCE_VIDEO_BYTES
              ? new Error(`Source video exceeds ${MAX_SOURCE_VIDEO_LABEL}.`)
              : null,
            chunk,
          );
        },
      }),
      createWriteStream(source, { mode: 0o600 }),
      { signal: AbortSignal.timeout(180_000) },
    );
    const { duration, hasAudio } = await inspectMedia(source);
    await stage("transcribe");
    const pcm = hasAudio
      ? await extractPcm(source, join(directory, "speech.pcm"))
      : Buffer.alloc(0);
    // Missing audio at the tail of a declared audio stream is protected, not inferred silent.
    const protectedInput = audibleIntervals(pcm);
    if (hasAudio && pcm.length / 32000 < duration - 0.1)
      protectedInput.push({ start: pcm.length / 32000, end: duration });
    const transcripts: { start: number; end: number; text: string }[] = [];
    for (let offset = 0; offset < pcm.length; offset += 49 * 32000) {
      const chunk = pcm.subarray(
        offset,
        Math.min(pcm.length, offset + 50 * 32000),
      );
      const speech = await provider.transcribe(chunk, offset / 32000);
      await trace("speech_recognized", {
        offset: offset / 32000,
        duration: chunk.length / 32000,
        wordIntervals: speech.intervals.length,
      });
      protectedInput.push(...speech.intervals);
      transcripts.push({
        start: offset / 32000,
        end: (offset + chunk.length) / 32000,
        text: speech.transcript,
      });
    }
    await stage("segment");
    const segments = Array.from(
      { length: Math.ceil(duration / 45) },
      (_, index) => ({
        start: index * 45,
        duration: Math.min(45, duration - index * 45),
      }),
    );
    await stage("beats");
    const beats: (typeof semaVisualBeatsTable.$inferInsert & {
      description: string;
    })[] = [];
    for (const segment of segments) {
      const clip = await videoClip(
        source,
        join(directory, "clip.mp4"),
        segment.start,
        segment.duration,
      );
      const context = transcripts
        .filter(
          (part) =>
            part.start < segment.start + segment.duration &&
            part.end > segment.start,
        )
        .map((part) => part.text)
        .join(" ");
      const drafts = await provider.analyze(clip, segment.duration, context);
      await trace("visual_analysis_completed", {
        offset: segment.start,
        duration: segment.duration,
        beats: drafts.length,
      });
      for (const draft of drafts) {
        const start = segment.start + draft.start;
        const end = segment.start + draft.end;
        const frame = await evidenceFrame(
          source,
          join(directory, "frame.jpg"),
          (start + end) / 2,
        );
        const framePath = await storage.savePrivateArtifact(
          frame,
          "image/jpeg",
          project.ownerId,
        );
        generated.push(framePath);
        beats.push({
          ...draft,
          start,
          end,
          beatId: `beat-${randomUUID()}`,
          projectId,
          evidenceFrames: [`/api/storage${framePath}`],
          state: "needs_human",
        });
      }
    }
    await stage("speech");
    const protectedIntervals = mergeIntervals(protectedInput, duration);
    await stage("windows");
    const gaps = narrationWindows(protectedIntervals, duration);
    await stage("plan");
    const windows: (typeof semaNarrationWindowsTable.$inferInsert)[] = [];
    const candidates: (typeof semaDescriptionCandidatesTable.$inferInsert)[] =
      [];
    // Reserve each assigned interval in full; no two candidates share a placement.
    for (const beat of beats) {
      const placements = gaps
        .map((gap) => ({
          start: Math.max(gap.start, beat.start),
          end: Math.min(gap.end, beat.end + 3),
        }))
        .filter(
          (gap) =>
            gap.end - gap.start >= 0.5 &&
            !windows.some(
              (window) => gap.start < window.end && window.start < gap.end,
            ),
        )
        .sort((a, b) => b.end - b.start - (a.end - a.start));
      const placement = placements[0];
      const window = {
        windowId: `window-${randomUUID()}`,
        projectId,
        start: placement?.start ?? beat.start,
        end: placement?.end ?? beat.end,
        duration: placement
          ? placement.end - placement.start
          : beat.end - beat.start,
        protectedCollision: !placement,
        silenceRatio: placement ? 1 : 0,
      };
      windows.push(window);
      if (!placement) beat.state = "no_safe_placement";
      else if (!beat.description.trim()) beat.state = "left_undescribed";
      candidates.push({
        candidateId: `candidate-${randomUUID()}`,
        projectId,
        beatId: beat.beatId,
        windowId: window.windowId,
        text: placement ? beat.description.trim() : "",
        ttsDuration: 0,
        availableDuration: window.duration,
        fitStatus: "pending",
        languageFlags: [],
        attempt: 0,
        rationale: placement
          ? beat.reason
          : "No nearby protected-audio-free placement exists. A human must resolve this beat.",
      });
    }
    await stage("draft");
    const manifest: ProcessingManifest = {
      source: project.mediaObjectPath,
      protectedIntervals,
      renders: {},
    };
    await stage("render");
    for (const candidate of candidates) {
      if (!candidate.text) continue;
      const window = windows.find(
        (item) => item.windowId === candidate.windowId,
      )!;
      for (let attempt = 1; attempt <= 3; attempt++) {
        const audio = await provider.synthesize(candidate.text);
        candidate.ttsDuration = parseWave(audio).duration;
        candidate.attempt = attempt;
        const fit = verifyRenderedFit({
          window,
          renderedDuration: candidate.ttsDuration,
        });
        await trace("narration_measured", {
          candidateId: candidate.candidateId,
          attempt,
          measuredSeconds: candidate.ttsDuration,
          availableSeconds: window.duration,
          fit: fit.status,
        });
        if (fit.status !== "pass" && attempt < 3) {
          const revised = await provider.shorten(
            candidate.text,
            Math.max(0, window.duration - 0.2),
          );
          if (revised) {
            candidate.text = revised;
            await trace("description_shortened", {
              candidateId: candidate.candidateId,
              attempt,
            });
            continue;
          }
        }
        const objectPath = await storage.savePrivateArtifact(
          audio,
          "audio/wav",
          project.ownerId,
        );
        generated.push(objectPath);
        manifest.renders[candidate.candidateId] = {
          objectPath,
          text: candidate.text,
          sha256: audioHash(audio),
        };
        break;
      }
    }

    await stage("verify");
    for (const candidate of candidates) {
      const window = windows.find(
        (item) => item.windowId === candidate.windowId,
      )!;
      const fit = verifyRenderedFit({
        window,
        renderedDuration: candidate.ttsDuration,
        protectedCollision:
          window.protectedCollision ||
          hasProtectedCollision(window, protectedIntervals),
      });
      candidate.fitStatus = fit.status === "pass" ? "pass" : "failed";
    }
    await stage("review");
    await db.transaction(async (tx) => {
      await tx
        .delete(semaReviewDecisionsTable)
        .where(eq(semaReviewDecisionsTable.projectId, projectId));
      await tx
        .delete(semaDescriptionCandidatesTable)
        .where(eq(semaDescriptionCandidatesTable.projectId, projectId));
      await tx
        .delete(semaVisualBeatsTable)
        .where(eq(semaVisualBeatsTable.projectId, projectId));
      await tx
        .delete(semaNarrationWindowsTable)
        .where(eq(semaNarrationWindowsTable.projectId, projectId));
      if (windows.length)
        await tx.insert(semaNarrationWindowsTable).values(windows);
      if (beats.length)
        await tx
          .insert(semaVisualBeatsTable)
          .values(beats.map(({ description, ...beat }) => beat));
      if (candidates.length)
        await tx.insert(semaDescriptionCandidatesTable).values(candidates);
      await tx
        .insert(semaProcessingTable)
        .values({ projectId, manifest })
        .onConflictDoUpdate({
          target: semaProcessingTable.projectId,
          set: { manifest },
        });
      await tx
        .update(semaProcessStagesTable)
        .set({ status: "complete" })
        .where(eq(semaProcessStagesTable.projectId, projectId));
      await tx
        .update(semaProjectsTable)
        .set({
          status: "needs_review",
          progress: 100,
          duration,
          updatedAt: new Date(),
        })
        .where(eq(semaProjectsTable.projectId, projectId));
    });
    committed = true;
    await trace("processing_completed", {
      beats: beats.length,
      verifiedCandidates: candidates.filter((item) => item.fitStatus === "pass")
        .length,
    }).catch(() => undefined);
  } catch {
    await trace("processing_failed").catch(() => undefined);
    // Do not log provider exceptions, media content, auth headers or secret values.
    logger.error(
      { projectId, stage: activeStage },
      "Project processing failed; check provider configuration and media requirements.",
    );
    await db
      .update(semaProcessStagesTable)
      .set({ status: "failed" })
      .where(
        and(
          eq(semaProcessStagesTable.projectId, projectId),
          eq(semaProcessStagesTable.name, activeStage),
        ),
      );
    await db
      .update(semaProjectsTable)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(semaProjectsTable.projectId, projectId));
  } finally {
    if (!committed)
      for (const path of generated) {
        try {
          await (await storage.getObjectEntityFile(path)).delete();
        } catch {
          /* Keep cleanup errors separate from job state. */
        }
      }
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}

export function startProcessingWorker() {
  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      const projects = await db
        .select({ projectId: semaProjectsTable.projectId })
        .from(semaProjectsTable)
        .where(
          and(
            eq(semaProjectsTable.status, "processing"),
            isNotNull(semaProjectsTable.mediaObjectPath),
          ),
        )
        .orderBy(
          asc(semaProjectsTable.progress),
          asc(semaProjectsTable.updatedAt),
        )
        .limit(2);
      await Promise.all(
        projects.map(async (project) => {
          try {
            await withProjectLock(project.projectId, () =>
              processProject(project.projectId),
            );
          } catch {
            logger.warn(
              { projectId: project.projectId },
              "Processing deferred; project lock or database unavailable.",
            );
          }
        }),
      );
    } catch {
      logger.error(
        "Processing queue unavailable. Check database schema and connectivity.",
      );
    } finally {
      running = false;
    }
  }
  const timer = setInterval(() => void tick(), 5000);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}

export class ExportValidationError extends Error {}

export async function verifiedExport(projectId: string) {
  const project = await getProjectById(projectId);
  if (!project || !["needs_review", "exported"].includes(project.status))
    throw new ExportValidationError("Project is not ready for export.");
  const [processing] = await db
    .select()
    .from(semaProcessingTable)
    .where(eq(semaProcessingTable.projectId, projectId));
  if (!processing || processing.manifest.source !== project.mediaObjectPath)
    throw new ExportValidationError(
      "Process the source video before exporting measured narration.",
    );
  const [beats, windows, candidates, decisions] = await Promise.all([
    db
      .select()
      .from(semaVisualBeatsTable)
      .where(eq(semaVisualBeatsTable.projectId, projectId)),
    db
      .select()
      .from(semaNarrationWindowsTable)
      .where(eq(semaNarrationWindowsTable.projectId, projectId)),
    db
      .select()
      .from(semaDescriptionCandidatesTable)
      .where(eq(semaDescriptionCandidatesTable.projectId, projectId)),
    db
      .select()
      .from(semaReviewDecisionsTable)
      .where(eq(semaReviewDecisionsTable.projectId, projectId)),
  ]);
  const entries = [];
  const cues: { start: number; audio: Buffer }[] = [];
  for (const beat of beats) {
    const matches = decisions.filter(
      (decision) => decision.beatId === beat.beatId,
    );
    if (matches.length !== 1)
      throw new ExportValidationError(
        "Resolve every visual beat before export.",
      );
    const decision = matches[0];
    if (
      ["reject", "left_undescribed", "no_safe_placement"].includes(
        decision.action,
      )
    )
      continue;
    if (
      !["approve", "human_edited_approve"].includes(decision.action) ||
      !decision.exportAuthorized
    )
      throw new ExportValidationError(
        "Every narration cue requires human authorization.",
      );
    const candidate = candidates.find(
      (item) =>
        item.candidateId === decision.candidateId &&
        item.beatId === beat.beatId,
    );
    const window = windows.find(
      (item) => item.windowId === candidate?.windowId,
    );
    const render =
      candidate && processing.manifest.renders[candidate.candidateId];
    if (
      !candidate ||
      !window ||
      !render ||
      candidate.fitStatus !== "pass" ||
      render.text !== decision.finalText ||
      candidate.text !== decision.finalText
    )
      throw new ExportValidationError(
        "The approved wording does not match verified narration.",
      );
    const [audio] = await (
      await storage.getObjectEntityFile(render.objectPath)
    ).download();
    if (audioHash(audio) !== render.sha256)
      throw new ExportValidationError(
        "Stored narration failed integrity verification.",
      );
    const measured = parseWave(audio).duration;
    const fit = verifyRenderedFit({
      window,
      renderedDuration: measured,
      protectedCollision:
        window.protectedCollision ||
        hasProtectedCollision(window, processing.manifest.protectedIntervals),
    });
    if (fit.status !== "pass" || window.end > project.duration)
      throw new ExportValidationError(
        "Stored narration no longer fits its protected window.",
      );
    entries.push({
      beatId: beat.beatId,
      text: decision.finalText,
      evidenceFrames: beat.evidenceFrames,
      start: window.start,
      end: window.start + measured,
      reviewer: decision.reviewer,
      action: decision.action,
      updatedAt: decision.updatedAt.toISOString(),
    });
    cues.push({ start: window.start, audio });
  }
  return {
    entries: entries.sort((a, b) => a.start - b.start),
    audio: narrationStem(project.duration, cues),
    decisions,
  };
}
