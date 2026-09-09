// Deliberately small in-memory boundaries for testing the real export verifier.
// Rows model a single project; route authorization is outside this fixture.
export const state: { project: any; rows: Record<string, any[]>; audio: Buffer } = { project: null, rows: {}, audio: Buffer.alloc(0) };
export const semaProjectsTable = "projects";
export const semaProcessStagesTable = "stages";
export const semaReviewDecisionsTable = "decisions";
export const semaVisualBeatsTable = "beats";
export const semaNarrationWindowsTable = "windows";
export const semaDescriptionCandidatesTable = "candidates";
export const semaProcessingTable = "processing";
export const semaExecutionEventsTable = "events";
export const semaUploadsTable = "uploads";
export const eq = (...values: unknown[]) => values;
export const and = (...values: unknown[]) => values;
export const or = and;
export const asc = (value: unknown) => value;
export const desc = asc;
export const isNotNull = (value: unknown) => value;
export const db = { select: () => ({ from: (table: string) => ({ where: () => Object.assign(Promise.resolve(state.rows[table] ?? []), { limit: async () => state.rows[table] ?? [] }) }) }) };
export const pool = { connect: async () => ({ query: async () => ({ rows: [{ locked: true }] }), release() {} }) };
export const pipelineStages = [];
export const getProjectById = async () => state.project;
export const ensureDemoProject = async () => {};
export const createDecisionId = () => "decision-test";
export const createProjectId = () => "project-test";
export const getProjectReviewData = async () => ({});
export const isExportAuthorized = () => false;
export const serializeDecision = (value: unknown) => value;
export const serializeProject = serializeDecision;
export const routes: { method: string; path: string; handler: (...args: any[]) => any }[] = [];
export function Router() {
  return Object.fromEntries(["use", "get", "post", "patch"].map(method => [method, (path: string, handler: (...args: any[]) => any) => { routes.push({ method, path, handler }); }]));
}
export const logger = { error() {}, warn() {} };
export class ObjectStorageService {
  async getObjectEntityFile() { return { download: async () => [state.audio] }; }
}
export const sdk: { configuration: any; calls: any[]; generate: () => Promise<any> } = { configuration: null, calls: [], generate: async () => ({}) };
export const Type = { OBJECT: "OBJECT", ARRAY: "ARRAY", STRING: "STRING", NUMBER: "NUMBER" };
export class GoogleGenAI {
  constructor(configuration: any) { sdk.configuration = configuration; }
  models = { generateContent: async (input: any) => { sdk.calls.push(input); return sdk.generate(); } };
}
