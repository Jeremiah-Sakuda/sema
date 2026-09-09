# Sema

Sema helps film editors create audio description with source evidence, measured narration timing, and human approval. Its central question is whether a visible action deserves a line—and whether that line can be spoken without covering the film's audio.

> The model proposes. Code constrains. The human authorizes.

[Open the current deployed app](https://sema-audio-description-editor--jsakuda.replit.app). The URL returned HTTP 200 on September 9, 2026; the changes in this checkout have not yet been verified on that deployment.

## The workflow

1. Sign in and upload an authorized English short film, up to 20 minutes.
2. Google Cloud Speech-to-Text supplies word timestamps; conservative audio detection also protects audible material. Gemini on Vertex AI proposes visual beats and descriptions from video clips.
3. ffmpeg extracts source frames. The server finds available narration intervals, synthesizes lines with Google Cloud Text-to-Speech, and measures the actual WAV duration. Overlong proposals can be shortened through Gemini, synthesized again, and measured before review.
4. An editor inspects evidence, listens, revises, renders again, and approves the specific verified candidate. Silence and intentional omission are valid editorial decisions.
5. Export the approved narration stem, timed script, WebVTT, and decision records. The stem is isolated narration for downstream mixing.

Processing jobs persist in PostgreSQL and run in the API process. Live Google execution requires credentials and a configured Replit environment; a successful build alone does not demonstrate a processed film. See the [submission evidence checklist](docs/submission.md) before making submission claims.

## Actual stack

| Layer | Implementation |
| --- | --- |
| Web app | React, TypeScript, Vite, Tailwind |
| API and orchestration | Express 5, Node.js 24, TypeScript |
| Persistence | PostgreSQL 16, Drizzle ORM |
| Google AI | Gemini on Vertex AI through `@google/genai`, Cloud Speech-to-Text, Cloud Text-to-Speech |
| Media | ffmpeg and ffprobe |
| Identity and private objects | Replit Auth and Replit App Storage |
| Hosting | Replit Reserved VM, one API process serving the built web app |

## Run on Replit

Import [this repository](https://github.com/Jeremiah-Sakuda/sema) into Replit. Add PostgreSQL, Replit Auth, and App Storage to the app. The storage integration must provide `PRIVATE_OBJECT_DIR`; authentication requires the platform-provided `REPL_ID`.

Put credentials in **Replit Secrets**, never `.env`, source files, shell commands, or GitHub. Link shared/account secrets to this app and verify their availability in the published environment. See [Replit Secrets documentation](https://docs.replit.com/core-concepts/project-editor/app-setup/secrets).

| Variable | Value or purpose |
| --- | --- |
| `GOOGLE_CLOUD_PROJECT_ID` | Your billed Google Cloud project ID |
| `GOOGLE_CLOUD_LOCATION` | `us-central1`, subject to model availability |
| `GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON` | Complete service-account JSON, entered directly in Secrets |
| `GOOGLE_CLOUD_VERTEX_MODEL` | Optional; defaults to `gemini-2.5-flash` |
| `DATABASE_URL` | Replit PostgreSQL connection string |
| `PRIVATE_OBJECT_DIR` | Private directory supplied by App Storage configuration |
| `REPL_ID` | Replit-provided app identity; needed by Replit Auth |
| `PORT` | `5000`; configured in `.replit` |
| `BASE_PATH` | `/`; configured in `.replit` for the frontend build |

Enable Vertex AI (`aiplatform.googleapis.com`), Speech-to-Text (`speech.googleapis.com`), and Text-to-Speech (`texttospeech.googleapis.com`) in the Google project, with billing and quota available. Grant the runtime service account Vertex AI User (`roles/aiplatform.user`), [Cloud Speech Client](https://docs.cloud.google.com/iam/docs/roles-permissions/speech) (`roles/speech.client`), and [Service Usage Consumer](https://docs.cloud.google.com/docs/authentication/rest) (`roles/serviceusage.serviceUsageConsumer`) on the billed project. The latter permits the quota-project header used by the provider. Synchronous [Text-to-Speech synthesis](https://docs.cloud.google.com/text-to-speech/docs/reference/rest/v1/text/synthesize) uses the enabled API and `cloud-platform` OAuth scope; do not invent a “Text-to-Speech User” role or grant broad Editor access for it. Check organization restrictions if requests return 403. Storage uses Replit's credentials, so no separate bucket in your Google project is required.

The provider reads JSON directly from the secret. `GOOGLE_APPLICATION_CREDENTIALS` is a credential-file path, not this JSON setting. AI Studio keys and the separately managed `AI_INTEGRATIONS_GEMINI_*` variables do not configure this Vertex flow.

In Replit Shell:

```sh
pnpm install --frozen-lockfile
pnpm --filter @workspace/db run push
pnpm run typecheck
PORT=5000 BASE_PATH=/ pnpm run build
NODE_ENV=production PORT=5000 pnpm --filter @workspace/api-server run start
```

Inspect the proposed database changes before accepting `drizzle-kit push`; use a fresh development database for first setup. The tracked **Project** Run workflow builds and starts the application. Open the preview on port 5000. `/api/healthz` checks that the HTTP server responds; upload, authentication, database, and provider smoke tests are separate.

For local code checks, install Node.js 24, pnpm, PostgreSQL 16, ffmpeg, and ffprobe. Supply environment variables through your process/secret manager. Run the same install, typecheck, and build commands. Full authentication and storage execution require Replit's platform services; this repository does not emulate them locally.

## Deploy

1. Apply the reviewed schema to the production PostgreSQL database and confirm production secrets and App Storage access.
2. Select **Reserved VM** in Replit Publishing. Use one running instance: the durable queue has an in-process worker and requires an always-on process.
3. Build with `PORT=5000 BASE_PATH=/ pnpm run build`; run with `NODE_ENV=production PORT=5000 pnpm --filter @workspace/api-server run start`. The tracked `.replit` supplies these settings and ffmpeg.
4. Verify sign-in, film upload, processing, evidence playback, re-render, approval, and all downloads from the published URL in a fresh browser session.
5. Record the real published URL and exact revision with the demo evidence. The existing URL is listed above; successful execution of this revision still needs verification.

See [Replit deployment types](https://docs.replit.com/features/publishing/deployment-types). Provision enough memory and temporary disk for the source film and ffmpeg; begin with a small original clip. Google processing consumes project quota and billed resources.

## Boundaries

Sema is an editorial prototype, not an accessibility certification or replacement for a professional describer. Recognition can miss dialogue, visual descriptions can be wrong, and conservative protection can leave no placement when music or ambience continues. Human review remains necessary. The export is not a final theatrical mix, and multilingual description is outside the current scope.

## Repository map

- `artifacts/sema-app`: review interface and upload workflow.
- `artifacts/api-server`: authenticated routes, processing, Google provider, timing, and media exports.
- `lib/db/src/schema/sema.ts`: project, beat, candidate, decision, and processing persistence.
- `lib/api-spec`: OpenAPI contract; regenerate with `pnpm --filter @workspace/api-spec run codegen` after contract changes.
- `docs/submission.md`: event requirements to verify before submitting.

Apache 2.0. See [LICENSE](LICENSE). Keep credentials, private source media, and generated artifacts out of version control.
