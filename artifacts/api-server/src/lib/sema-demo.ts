import { and, asc, desc, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  db,
  semaDescriptionCandidatesTable,
  semaNarrationWindowsTable,
  semaProcessStagesTable,
  semaProjectsTable,
  semaReviewDecisionsTable,
  semaVisualBeatsTable,
  type SemaProject,
} from "@workspace/db";

export const DEMO_PROJECT_ID = "demo-project";

export const pipelineStages = [
  ["validate", "Validating media"],
  ["transcribe", "Transcribing speech"],
  ["segment", "Segmenting scenes"],
  ["beats", "Identifying visual beats"],
  ["speech", "Building protected speech intervals"],
  ["windows", "Building narration windows"],
  ["plan", "Planning description placements"],
  ["draft", "Drafting descriptions"],
  ["render", "Rendering candidate narration"],
  ["verify", "Verifying timing"],
  ["review", "Preparing review"],
] as const;

export async function ensureDemoProject(): Promise<void> {
  const existing = await db
    .select({ projectId: semaProjectsTable.projectId })
    .from(semaProjectsTable)
    .where(eq(semaProjectsTable.projectId, DEMO_PROJECT_ID))
    .limit(1);

  if (existing.length > 0) {
    // Keep the public fixture consistent with the same identity rule as live analysis.
    await db
      .update(semaVisualBeatsTable)
      .set({
        summary: sql`replace(${semaVisualBeatsTable.summary}, 'Mara', 'the woman in the red coat')`,
        characters: ["the woman in the red coat"],
      })
      .where(eq(semaVisualBeatsTable.projectId, DEMO_PROJECT_ID));
    await db
      .update(semaDescriptionCandidatesTable)
      .set({
        text: sql`replace(${semaDescriptionCandidatesTable.text}, 'Mara', 'The woman in the red coat')`,
      })
      .where(eq(semaDescriptionCandidatesTable.projectId, DEMO_PROJECT_ID));
    return;
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.insert(semaProjectsTable).values({
      projectId: DEMO_PROJECT_ID,
      title: "The Yellow Envelope",
      describerName: "Jeremiah Sakuda",
      duration: 247,
      status: "needs_review",
      progress: 100,
      createdAt: now,
      updatedAt: now,
    });

    await tx.insert(semaProcessStagesTable).values(
      pipelineStages.map(([name, label], position) => ({
        stageId: `${DEMO_PROJECT_ID}-${name}`,
        projectId: DEMO_PROJECT_ID,
        name,
        label,
        status: "complete",
        position,
      })),
    );

    await tx.insert(semaNarrationWindowsTable).values([
      {
        windowId: "window-envelope",
        projectId: DEMO_PROJECT_ID,
        start: 44.09,
        end: 46.69,
        duration: 2.6,
        protectedCollision: false,
        silenceRatio: 0.22,
      },
      {
        windowId: "window-door",
        projectId: DEMO_PROJECT_ID,
        start: 78.5,
        end: 80.55,
        duration: 2.05,
        protectedCollision: false,
        silenceRatio: 0.08,
      },
      {
        windowId: "window-pause",
        projectId: DEMO_PROJECT_ID,
        start: 111.2,
        end: 116.8,
        duration: 5.6,
        protectedCollision: false,
        silenceRatio: 0.18,
      },
      {
        windowId: "window-dialogue",
        projectId: DEMO_PROJECT_ID,
        start: 153.1,
        end: 153.18,
        duration: 0.08,
        protectedCollision: true,
        silenceRatio: 0,
      },
      {
        windowId: "window-continuity",
        projectId: DEMO_PROJECT_ID,
        start: 202.3,
        end: 204.4,
        duration: 2.1,
        protectedCollision: false,
        silenceRatio: 0.31,
      },
    ]);

    await tx.insert(semaVisualBeatsTable).values([
      {
        beatId: "beat-envelope",
        projectId: DEMO_PROJECT_ID,
        start: 43.12,
        end: 45.4,
        summary:
          "The woman in the red coat slips a yellow envelope beneath the apartment door.",
        importance: "high",
        reason:
          "The action is not conveyed by dialogue or a distinct sound cue.",
        characters: ["the woman in the red coat"],
        objects: ["yellow envelope", "apartment door"],
        evidenceFrames: ["envelope-01", "envelope-02", "envelope-03"],
        state: "needs_human",
      },
      {
        beatId: "beat-fit",
        projectId: DEMO_PROJECT_ID,
        start: 77.15,
        end: 80.1,
        summary:
          "The woman in the red coat slides the envelope under the door.",
        importance: "high",
        reason: "The visual action changes what the viewer knows.",
        characters: ["the woman in the red coat"],
        objects: ["yellow envelope", "apartment door"],
        evidenceFrames: ["fit-01", "fit-02", "fit-03"],
        state: "needs_human",
      },
      {
        beatId: "beat-quiet",
        projectId: DEMO_PROJECT_ID,
        start: 108.2,
        end: 115.4,
        summary: "The woman in the red coat waits beside the closed door.",
        importance: "low",
        reason: "The pause contains no visual change that requires narration.",
        characters: ["the woman in the red coat"],
        objects: ["apartment door"],
        evidenceFrames: ["quiet-01", "quiet-02", "quiet-03"],
        state: "left_undescribed",
      },
      {
        beatId: "beat-no-placement",
        projectId: DEMO_PROJECT_ID,
        start: 149.2,
        end: 155.1,
        summary:
          "The woman in the red coat places the photograph into her coat during continuous dialogue.",
        importance: "high",
        reason:
          "The action matters, but every nearby interval is protected speech.",
        characters: ["the woman in the red coat"],
        objects: ["photograph", "coat"],
        evidenceFrames: ["placement-01", "placement-02", "placement-03"],
        state: "no_safe_placement",
      },
      {
        beatId: "beat-name",
        projectId: DEMO_PROJECT_ID,
        start: 197.4,
        end: 203.9,
        summary:
          "The woman in the red coat turns toward the window; her name has not yet been established.",
        importance: "medium",
        reason:
          "The visual introduction needs a temporary identifier before the name is spoken.",
        characters: ["the woman in the red coat"],
        objects: ["window", "red coat"],
        evidenceFrames: ["continuity-01", "continuity-02", "continuity-03"],
        state: "needs_human",
      },
    ]);

    await tx.insert(semaDescriptionCandidatesTable).values([
      {
        candidateId: "candidate-envelope",
        projectId: DEMO_PROJECT_ID,
        beatId: "beat-envelope",
        windowId: "window-envelope",
        text: "The woman in the red coat slides a yellow envelope under the door.",
        ttsDuration: 1.84,
        availableDuration: 2.6,
        fitStatus: "pass",
        languageFlags: [],
        attempt: 2,
        rationale:
          "The action is not stated in dialogue and changes what the viewer knows.",
      },
      {
        candidateId: "candidate-fit",
        projectId: DEMO_PROJECT_ID,
        beatId: "beat-fit",
        windowId: "window-door",
        text: "The woman in the red coat quietly slips a yellow envelope beneath the apartment door.",
        ttsDuration: 2.41,
        availableDuration: 2.05,
        fitStatus: "failed",
        languageFlags: ["quietly"],
        attempt: 1,
        rationale:
          "The first draft exceeds the available window; Sema needs a shorter revision.",
      },
      {
        candidateId: "candidate-quiet",
        projectId: DEMO_PROJECT_ID,
        beatId: "beat-quiet",
        windowId: "window-pause",
        text: "",
        ttsDuration: 0,
        availableDuration: 5.6,
        fitStatus: "pass",
        languageFlags: [],
        attempt: 0,
        rationale:
          "A usable gap does not require narration when no meaningful visual information changes.",
      },
      {
        candidateId: "candidate-no-placement",
        projectId: DEMO_PROJECT_ID,
        beatId: "beat-no-placement",
        windowId: "window-dialogue",
        text: "",
        ttsDuration: 0,
        availableDuration: 0.08,
        fitStatus: "pending",
        languageFlags: [],
        attempt: 0,
        rationale:
          "No speech-free standard-AD window is close enough to the action.",
      },
      {
        candidateId: "candidate-name",
        projectId: DEMO_PROJECT_ID,
        beatId: "beat-name",
        windowId: "window-continuity",
        text: "The woman in the red coat turns toward the window.",
        ttsDuration: 1.68,
        availableDuration: 2.1,
        fitStatus: "pass",
        languageFlags: [],
        attempt: 1,
        rationale:
          "The temporary identifier preserves continuity until dialogue establishes her name.",
      },
    ]);
  });
}

export async function getProjectById(
  projectId: string,
): Promise<SemaProject | undefined> {
  const [project] = await db
    .select()
    .from(semaProjectsTable)
    .where(eq(semaProjectsTable.projectId, projectId))
    .limit(1);
  return project;
}

export async function getProjectReviewData(projectId: string) {
  const [project, beats, windows, candidates, decisions, stages] =
    await Promise.all([
      getProjectById(projectId),
      db
        .select()
        .from(semaVisualBeatsTable)
        .where(eq(semaVisualBeatsTable.projectId, projectId))
        .orderBy(asc(semaVisualBeatsTable.start)),
      db
        .select()
        .from(semaNarrationWindowsTable)
        .where(eq(semaNarrationWindowsTable.projectId, projectId))
        .orderBy(asc(semaNarrationWindowsTable.start)),
      db
        .select()
        .from(semaDescriptionCandidatesTable)
        .where(eq(semaDescriptionCandidatesTable.projectId, projectId)),
      db
        .select()
        .from(semaReviewDecisionsTable)
        .where(eq(semaReviewDecisionsTable.projectId, projectId))
        .orderBy(desc(semaReviewDecisionsTable.updatedAt)),
      db
        .select()
        .from(semaProcessStagesTable)
        .where(eq(semaProcessStagesTable.projectId, projectId))
        .orderBy(asc(semaProcessStagesTable.position)),
    ]);

  if (!project) {
    return undefined;
  }

  const visibleStages = project.mediaObjectPath
    ? stages
    : stages.map((stage) => ({ ...stage, status: "pending" }));
  const activeStage = visibleStages.find((stage) => stage.status === "active");
  const failedStage = visibleStages.find((stage) => stage.status === "failed");

  return {
    project: serializeProject(project),
    beats,
    windows,
    candidates,
    decisions: decisions.map(serializeDecision),
    process: {
      status: failedStage ? "failed" : activeStage ? "active" : "complete",
      currentStage:
        failedStage?.name ?? activeStage?.name ?? visibleStages[0]?.name ?? "review",
      stages: visibleStages.map(({ name, label, status }) => ({
        name,
        label,
        status,
      })),
    },
  };
}

export function serializeProject(project: SemaProject) {
  return {
    ...project,
    status:
      !project.mediaObjectPath && project.status === "processing"
        ? "ready"
        : project.status,
    duration: Number(project.duration),
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

export function serializeDecision(
  decision: typeof semaReviewDecisionsTable.$inferSelect,
) {
  return {
    ...decision,
    updatedAt: decision.updatedAt.toISOString(),
  };
}

export function createProjectId(): string {
  return `project-${randomUUID().slice(0, 8)}`;
}

export function createDecisionId(): string {
  return `decision-${randomUUID().slice(0, 8)}`;
}

export function isExportAuthorized(action: string, fitStatus: string): boolean {
  return (
    (action === "approve" || action === "human_edited_approve") &&
    fitStatus === "pass"
  );
}
