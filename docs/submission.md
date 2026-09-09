# Submission readiness

Requirements checked September 9, 2026 against the [official Agentic Cinema rules](https://agentic-cinema.devpost.com/rules). This is a preparation checklist, not an eligibility determination.

The published deadline is **September 9, 2026, 2:00 p.m. Pacific / 5:00 p.m. Eastern**. The rules restrict changes to submitted materials after the deadline. Verify your submission state directly in the event portal.

- [ ] Confirm individual/team eligibility and that the project was created during the event period.
- [ ] Retain genuine Replit Agent development evidence and deploy on a `replit.app` or `replit.dev` URL.
- [ ] Demonstrate actual Google AI runtime calls. Confirm the accepted SDK and Agent Builder wording with organizers if the implementation differs.
- [ ] Review the restriction to Google Cloud AI and the selected partner's built-in AI features. Ask organizers about any uncertain development tooling; describe development history truthfully.
- [ ] Make source public with the root license and runnable instructions.
- [ ] Provide the working hosted URL, features, technologies, data provenance, and learnings.
- [ ] Publish a functioning demonstration on YouTube or Vimeo, in English or with English subtitles. Only the first three minutes are evaluated.
- [ ] Use original demonstration material and verify all rights.

The four equally weighted criteria are technological implementation, design, potential impact, and quality of the idea. Evidence of a completed real workflow matters more than planned features.

## Outstanding implementation evidence

The current provider imports the official Google Gen AI JavaScript SDK (`@google/genai`) and calls Vertex AI for visual analysis and narration shortening. The runtime code is wired; a successful cloud call on an actual film is still unverified. The rules list the Gen AI SDK using its Python package name (`google-genai`); confirm language-equivalent package acceptance with organizers if needed. Google Cloud Agent Builder is not integrated and must not be claimed. Seek organizer clarification on whether this architecture satisfies that separate requirement. The existing [Replit deployment](https://sema-audio-description-editor--jsakuda.replit.app) returned HTTP 200 on September 9, 2026, but this does not establish that the current checkout is deployed or that processing works. No source film, successful Google run, or public demonstration video has been verified for this revision.
