import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  integer,
  jsonb,
  real,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const semaProjectsTable = pgTable("sema_projects", {
  projectId: text("project_id").primaryKey(),
  title: text("title").notNull(),
  ownerId: text("owner_id"),
  describerName: text("describer_name").notNull(),
  mediaObjectPath: text("media_object_path"),
  mediaFileName: text("media_file_name"),
  mediaContentType: text("media_content_type"),
  duration: real("duration").notNull().default(0),
  status: text("status").notNull().default("ready"),
  progress: integer("progress").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const semaVisualBeatsTable = pgTable("sema_visual_beats", {
  beatId: text("beat_id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => semaProjectsTable.projectId, { onDelete: "cascade" }),
  start: real("start").notNull(),
  end: real("end").notNull(),
  summary: text("summary").notNull(),
  importance: text("importance").notNull(),
  reason: text("reason").notNull(),
  characters: jsonb("characters").$type<string[]>().notNull().default([]),
  objects: jsonb("objects").$type<string[]>().notNull().default([]),
  evidenceFrames: jsonb("evidence_frames")
    .$type<string[]>()
    .notNull()
    .default([]),
  state: text("state").notNull().default("draft"),
});

export const semaNarrationWindowsTable = pgTable("sema_narration_windows", {
  windowId: text("window_id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => semaProjectsTable.projectId, { onDelete: "cascade" }),
  start: real("start").notNull(),
  end: real("end").notNull(),
  duration: real("duration").notNull(),
  protectedCollision: boolean("protected_collision").notNull().default(false),
  silenceRatio: real("silence_ratio").notNull().default(0),
});

export const semaDescriptionCandidatesTable = pgTable(
  "sema_description_candidates",
  {
    candidateId: text("candidate_id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => semaProjectsTable.projectId, { onDelete: "cascade" }),
    beatId: text("beat_id")
      .notNull()
      .references(() => semaVisualBeatsTable.beatId, { onDelete: "cascade" }),
    windowId: text("window_id")
      .notNull()
      .references(() => semaNarrationWindowsTable.windowId, {
        onDelete: "cascade",
      }),
    text: text("text").notNull(),
    ttsDuration: real("tts_duration").notNull(),
    availableDuration: real("available_duration").notNull(),
    fitStatus: text("fit_status").notNull(),
    languageFlags: jsonb("language_flags")
      .$type<string[]>()
      .notNull()
      .default([]),
    attempt: integer("attempt").notNull().default(1),
    rationale: text("rationale").notNull(),
  },
);

export const semaReviewDecisionsTable = pgTable("sema_review_decisions", {
  decisionId: text("decision_id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => semaProjectsTable.projectId, { onDelete: "cascade" }),
  beatId: text("beat_id")
    .notNull()
    .references(() => semaVisualBeatsTable.beatId, { onDelete: "cascade" }),
  candidateId: text("candidate_id").notNull(),
  action: text("action").notNull(),
  finalText: text("final_text").notNull().default(""),
  reviewer: text("reviewer").notNull(),
  exportAuthorized: boolean("export_authorized").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const semaProcessStagesTable = pgTable("sema_process_stages", {
  stageId: text("stage_id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => semaProjectsTable.projectId, { onDelete: "cascade" }),
  name: text("name").notNull(),
  label: text("label").notNull(),
  status: text("status").notNull().default("pending"),
  position: integer("position").notNull(),
});

export const insertSemaProjectSchema = createInsertSchema(
  semaProjectsTable,
).omit({
  createdAt: true,
  updatedAt: true,
});
export const insertSemaVisualBeatSchema =
  createInsertSchema(semaVisualBeatsTable);
export const insertSemaNarrationWindowSchema = createInsertSchema(
  semaNarrationWindowsTable,
);
export const insertSemaDescriptionCandidateSchema = createInsertSchema(
  semaDescriptionCandidatesTable,
);
export const insertSemaReviewDecisionSchema = createInsertSchema(
  semaReviewDecisionsTable,
);
export const insertSemaProcessStageSchema = createInsertSchema(
  semaProcessStagesTable,
);

export type SemaProject = typeof semaProjectsTable.$inferSelect;
export type SemaVisualBeat = typeof semaVisualBeatsTable.$inferSelect;
export type SemaNarrationWindow = typeof semaNarrationWindowsTable.$inferSelect;
export type SemaDescriptionCandidate =
  typeof semaDescriptionCandidatesTable.$inferSelect;
export type SemaReviewDecision = typeof semaReviewDecisionsTable.$inferSelect;
export type SemaProcessStage = typeof semaProcessStagesTable.$inferSelect;
export type InsertSemaProject = z.infer<typeof insertSemaProjectSchema>;

export const semaUploadsTable = pgTable("sema_uploads", {
  objectPath: text("object_path").primaryKey(),
  ownerId: text("owner_id").notNull(),
});

export type ProcessingManifest = {
  source: string;
  protectedIntervals: { start: number; end: number }[];
  renders: Record<string, { objectPath: string; text: string; sha256: string }>;
};
export const semaProcessingTable = pgTable("sema_processing", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => semaProjectsTable.projectId, { onDelete: "cascade" }),
  manifest: jsonb("manifest").$type<ProcessingManifest>().notNull(),
});

export const semaExecutionEventsTable = pgTable("sema_execution_events", {
  eventId: text("event_id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => semaProjectsTable.projectId, { onDelete: "cascade" }),
  runId: text("run_id").notNull(),
  stage: text("stage").notNull(),
  event: text("event").notNull(),
  details: jsonb("details")
    .$type<Record<string, string | number | boolean>>()
    .notNull()
    .default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
