# Sema Sprint Plan

Sema is built as a constraint-governed audio-description editor: the model proposes, code constrains, and the human authorizes.

This plan is optimized for the September 9, 2026 hackathon submission. Each sprint ends with a visible, runnable milestone and a focused commit. We will prefer a seeded demo path over unfinished breadth.

## Working cadence

- One focused commit per completed acceptance slice.
- Keep commits small enough to review or revert independently.
- Do not mix visual polish, pipeline logic, and infrastructure changes in one commit.
- Every sprint ends with a short manual verification note in the commit body or README.
- Never commit media, credentials, service-account JSON, generated TTS, or other secrets.

## Sprint 0 — Repository and design foundation

Goal: establish the project shape and visual direction.

- Add Apache 2.0 license, ignore rules, README, and this plan.
- Create the React frontend / Python backend layout.
- Apply UI UX Pro Max to generate Sema's accessible cinematic editorial design system.
- Define core domain types: Project, VisualBeat, NarrationWindow, DescriptionCandidate, ReviewDecision.
- Add a seeded demo fixture matching the five required demo cases.

Exit condition: the app shell loads, the repository is documented, and the seeded review data is visible.

Expected commits: docs: add sprint plan; chore: add Apache license and repository hygiene; feat: scaffold Sema application shell; feat: add accessible editorial design system; test: add seeded review fixtures.

## Sprint 1 — Review workspace before real processing

Goal: make the product's primary interface real before wiring expensive AI services.

- Build the video-first review workspace.
- Add a timeline with source interval, protected speech, and narration-window markers.
- Add a review queue with evidence frames, draft text, rendered duration, fit state, and decision state.
- Implement approve, reject, leave undescribed, and no-safe-placement actions against persisted state.
- Make failed-fit, empty-window, and no-placement states first-class.
- Add keyboard navigation for approve, next, previous, and play context.

Exit condition: a judge can understand and complete the review flow using seeded data without an agent console.

Expected commits: 5–8 focused UI/state commits.

## Sprint 2 — Media ingest and deterministic timing core

Goal: establish the guarantees that AI cannot override.

- Add MP4/MOV validation for extension, MIME, size, duration, audio, and video streams.
- Add project creation and persistent stage state.
- Add GCS storage-prefix abstraction and signed upload/download URL boundaries.
- Parse transcript word timestamps.
- Build protected speech intervals with configurable guard margins.
- Build narration windows from protected intervals; silence is metadata, not the validity rule.
- Add deterministic placement collision checks and unit fixtures.

Exit condition: seeded timing tests demonstrate zero approved narration/dialogue collisions.

Expected commits: 6–10 focused backend/domain commits.

## Sprint 3 — Agent analysis and evidence

Goal: connect Gemini/Google ADK to the review model without giving it authority over constraints.

- Add Google ADK orchestration with stage-level progress and persistence.
- Add Speech-to-Text / Chirp transcript adapter.
- Add Gemini scene segmentation and visual-beat extraction.
- Extract first, middle, and last evidence frames per beat.
- Add deterministic beat/window pairing validation.
- Add persistent story state for character names, aliases, location, objects, and recent events.
- Add retry from the failed stage rather than restarting the project.

Exit condition: an uploaded or seeded film produces inspectable visual beats, evidence, windows, and story state.

Expected commits: 7–12 focused integration and persistence commits.

## Sprint 4 — Drafting, TTS fit, and revision loop

Goal: prove Sema's hero technical claim.

- Add Gemini description drafting with the Sema style guide.
- Add a cheap word-count heuristic as a cost-saving pre-check.
- Add a Google Cloud TTS adapter with one neutral voice.
- Measure actual WAV duration.
- Enforce rendered duration plus safety margin less than or equal to window duration in deterministic code.
- Add up to three automatic shortening attempts with measured-duration feedback.
- Re-synthesize and re-verify human edits.
- Add lexical language checks for interpretive wording.

Exit condition: a deliberately overlong draft visibly fails, Gemini revises it, and the shorter rendered WAV passes.

Expected commits: 6–10 focused pipeline commits.

## Sprint 5 — Authorization and export integrity

Goal: make human authority enforceable at the data and artifact boundary.

- Separate generated, fitting, failed, needs-human, rejected, undescribed, no-safe-placement, approved, and human-edited-approved states.
- Prevent model tools from mutating records into an approved state.
- Allow export only from human-authorized records.
- Generate timed AD WebVTT, a plain-text script, an isolated narration WAV, decision/provenance JSON, and a production summary.
- Add export-integrity tests for unapproved and failed-fit candidates.

Exit condition: attempting to export an unapproved line fails, while an approved line appears in every expected artifact.

Expected commits: 6–9 focused authorization/export commits.

## Sprint 6 — Demo hardening and submission polish

Goal: make the full three-minute story reliable and judgeable.

- Seed a complete demo project covering important silent action, fit failure, irrelevant quiet pause, wall-to-wall dialogue, and naming continuity.
- Add stage-level progress and retry UI.
- Add browser-reload persistence verification.
- Add production logging for stage, tool, duration, failure, model, and retry count.
- Record actual demo latency and Google Cloud cost where practical.
- Add deployment configuration for Replit.
- Complete README setup instructions and the architecture diagram.
- Confirm public repository, Apache 2.0 license, authorized demo footage, and hosted URL.
- Run the definition-of-done checklist and capture the final demo path.

Exit condition: the hosted seeded demo can be shown end-to-end without relying on a live upload succeeding.

Expected commits: 8–12 small hardening, documentation, and deployment commits.

## Explicit cuts before submission

Do not spend P0/P1 time on feature-length media, multilingual AD, multiple voices, caption correction, full audio mixing/mastering, team accounts, billing, dashboards, analytics, collaboration comments, automatic publishing, accessibility certification, manual beat creation, or alternate-window selection unless the core demo is already reliable.

## Definition of done

- No exported narration overlaps protected speech.
- Every exported narration clip passes rendered-duration verification.
- Unapproved records cannot enter the export bundle.
- Quiet irrelevant intervals can remain empty.
- Wall-to-wall dialogue can produce no-safe-placement.
- Character naming persists after introduction.
- Browser reload preserves review state.
- A failed stage can retry without restarting the whole workflow.
- The hosted demo shows the product's central division of responsibility.