# Sema

Sema is a constraint-governed audio-description editor for short films. It uses an agent to identify visual information a blind viewer may otherwise miss, proposes where that information can be spoken, measures the actual synthesized narration, and keeps a human describer in control of approval and export.

> The model proposes. Code constrains. The human authorizes.

## Why Sema

Generating a sentence is easy. Knowing whether it deserves to be spoken, finding a safe moment, proving the rendered audio fits, preserving continuity, and requiring human authorization are separate editorial problems. Sema is built around those constraints rather than treating every pause as an instruction to narrate.

## Current status

This repository is being built for the Replit Agentic Cinema hackathon. The active scope and acceptance criteria are in [SPRINTS.md](SPRINTS.md).

The first release targets short English films under 20 minutes and prioritizes:

- visual-beat extraction with source evidence,
- protected speech intervals,
- deterministic narration windows,
- actual TTS-duration fit verification,
- human review and approval,
- timed script and isolated narration exports.

## Product boundary

Sema does not replace professional describers, certify accessibility compliance, perform final theatrical mixing, correct captions, support multilingual AD, or publish autonomously. Empty windows, omitted beats, and no-safe-placement decisions are valid outcomes.

## Planned stack

- Frontend: React
- Backend and orchestration: Python with Google ADK
- Visual reasoning and drafting: Gemini
- Speech timing: Google Cloud Speech-to-Text / Chirp
- Narration: Google Cloud Text-to-Speech
- Storage: Google Cloud Storage
- Media tooling: ffmpeg
- Hosting: Replit
- UI system: UI UX Pro Max, applied as an accessible cinematic editorial workspace

## Development principles

- Model-backed judgment is separated from deterministic guarantees.
- No approved narration may overlap protected speech.
- Actual synthesized duration, not word count alone, determines fit.
- No generated line can authorize itself or enter the export bundle without human approval.
- Every exported line points back to a source visual beat and interval.
- Commits stay small and focused on one acceptance slice.

## Local development

Setup instructions will be added as the application scaffold lands. Never commit credentials, service-account files, source media, generated narration, or export artifacts.

## License

Apache 2.0. See [LICENSE](LICENSE).
