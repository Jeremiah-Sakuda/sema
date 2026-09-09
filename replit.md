# Sema

Sema is a film audio-description editor: source evidence, protected audio intervals, measured narration, and approval of the exact rendered revision.

## Run and operate

Use the Project Run workflow after installing packages and applying the database schema. It builds React and the Express API, then starts one server on port 5000. Production uses Reserved VM because the PostgreSQL processing queue is consumed by a worker in the API process.

- Install: `pnpm install --frozen-lockfile`
- Schema: `pnpm --filter @workspace/db run push` (review changes first)
- Typecheck: `pnpm run typecheck`
- Build: `PORT=5000 BASE_PATH=/ pnpm run build`
- Start: `NODE_ENV=production PORT=5000 pnpm --filter @workspace/api-server run start`
- API generation: `pnpm --filter @workspace/api-spec run codegen`

## Environment

Keep credentials only in Replit Secrets. Required Google variables: `GOOGLE_CLOUD_PROJECT_ID`, `GOOGLE_CLOUD_LOCATION`, `GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON`. Optional model variable: `GOOGLE_CLOUD_VERTEX_MODEL`. Configure `DATABASE_URL`, Replit Auth (`REPL_ID`), and App Storage (`PRIVATE_OBJECT_DIR`). Never print secret values or put credential JSON in files. Google project credentials are separate from the Replit storage identity.

## Implementation

React/Vite frontend: `artifacts/sema-app`. Express/TypeScript API: `artifacts/api-server`. PostgreSQL/Drizzle schema: `lib/db/src/schema/sema.ts`. Google provider, ffmpeg tools, deterministic timing, and queue live in the API's `src/lib`. OpenAPI lives in `lib/api-spec`. Vertex analysis and shortening invoke the official `@google/genai` SDK with service-account credentials; speech recognition and synthesis use authenticated Google REST APIs. Cloud execution remains a separate verification step.

## Editorial invariants

Bind each approval to its project, beat, candidate, text, and measured audio. Re-render edited text before approval. Recheck fit on export. Derive reviewer identity from the authenticated session and enforce project ownership. Preserve omitted and rejected decisions in the ledger. Treat missing narration placement as a valid result. Never present fixture data as a live model run.

## Release evidence

Use `docs/submission.md` for event requirements. Demo scripts are kept outside this repository. A build is not evidence of cloud execution, deployment, audience validation, or competition eligibility. The README documents actual setup and limitations.
