# @fgn/scorm-builder

Two responsibilities, one package:

1. **Challenge -> course.json transformer.** Takes a play.fgn.gg challenge ID, fetches the challenge + its tasks + applicable knowledge-gate quiz, and produces a default `course.json` manifest. This is what makes "any FGN challenge -> SCORM course" a one-click operation rather than a hand-authoring exercise.
2. **course.json -> SCORM ZIP packager.** Takes a manifest and produces a SCORM 1.2 ZIP (and, by Phase 4, a parallel cmi5 / xAPI ZIP).

Designed to run inside a Supabase edge function as a stateless library, but also runnable from a CLI for local testing and for the Phase 1.3 acceptance gate.

## Status

**Phase 1.3 (next).** Stubbed — implementation begins after Phase 1.2 review is signed off.

## Why a transformer

Every FGN challenge has a consistent structure: name, description, credential framework, game, 1-N tasks (each with description + Evidence: spec + mechanic type), and an optional linked knowledge-gate quiz. The structure is identical across CS / FS25 / ATS / RC; only the content varies.

That means the mapping from a challenge to a SCORM course is mechanical:

```
play.fgn.gg challenge          ->  scorm-builder transform  ->  course.json
  - name, description                                            modules: [
  - game (cs/fs25/ats/rc)                                          - briefing (auto-generated from description)
  - credential_framework                                           - briefing (game-specific intro template)
  - challenge_tasks[]                                              - challenge (snapshotted tasks embedded)
    - title, description                                           - quiz (knowledge gate if linked)
    - mechanic (in-game | annotation)                              - completion (auto-generated)
    - evidence_spec                                              ]
  - knowledge_gate_quiz_id (optional)
```

The transformer ships **game-specific content templates** for the briefing and completion modules — Construction Simulator briefings reference OSHA standards and bucket sizing, Farming Simulator briefings reference USDA practices and equipment safety, ATS briefings reference FMCSA HOS and weight limits. Templates are data-driven (a JSON template per game per credential framework), so adding a new game or framework is a content edit, not a code change.

The output `course.json` is a starting point, not a final product. The Course Builder admin UI (Phase 3) lets the admin reorder modules, add custom briefings, attach sim clips from the media library, override the brand pillar, set tenant white-label tokens, etc. All of those edits write back to the `scorm_course_modules` rows. The final export reads from those rows, not from the original challenge — so admin customizations are preserved.

## Responsibilities

### Transformer

- Fetch challenge + tasks from play.fgn.gg (cross-Supabase RPC or direct read with appropriate creds)
- Apply the credential-framework-aware briefing template
- Snapshot the 1-N tasks into a single `challenge` module's `tasks[]` array
- Resolve the brand mode and pillar from the destination + framework
- Stub a completion module
- Optionally embed a linked quiz lesson from fgn.academy
- Write the result to `scorm_courses` + `scorm_course_modules`

### Packager

- Validate the `course.json` schema (`schemaVersion: 1`)
- Generate `imsmanifest.xml` per SCORM 1.2 spec, with IMS LOM metadata
- Inline the compiled `@fgn/scorm-player` runtime into a single `index.html`
- Bundle attached media from `course_media` (sim clips, screenshots, images) into `media/`
- Inject brand tokens for the destination (Arcade vs Enterprise) into the bundled CSS
- Inject tenant white-label overrides if present
- Produce a zipped SCORM 1.2 package
- (Phase 4) Produce parallel cmi5 packages with xAPI statement scaffolding
- Hash and record every export in `scorm_exports` for audit and rebuild

## Output

A single ZIP file. Contents:

- `imsmanifest.xml` — SCORM 1.2 manifest with IMS LOM metadata
- `index.html` — the inlined `@fgn/scorm-player` bundle
- `course.json` — the manifest the player consumes at runtime
- `media/` — bundled clips and screenshots referenced by media_ids

## Tested against

Phase 1.3 acceptance gate: at least three challenges across at least two games (e.g. one CS, one FS25, one ATS) successfully transformed -> packaged -> validated in SCORM Cloud -> run in Moodle 4.x. Subsequent phases add Cornerstone, SAP SuccessFactors, Workday Learning, and at least one direct employer LMS.

## Consumes

- `@fgn/brand-tokens` — for token injection at build time
- `@fgn/scorm-player` — bundled into every package
- play.fgn.gg Supabase (`yrhwzmkenjgiujhofucx`) — to read challenges + tasks
- fgn.academy Supabase (`vfzjfkcwromssjnlrhoo`) — to read/write course state and write export records
