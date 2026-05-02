# reference-package

A hand-built SCORM 1.2 package wrapping one real FGN challenge — **CS Fiber: Underground Utility Trench Excavation** (TIRAP UUIT framework). Validates the `@fgn/scorm-player` + manifest pipeline end-to-end against SCORM Cloud and Moodle before `@fgn/scorm-builder` automates the packaging.

## Status

**Phase 1.2 — shell complete.** Manifest, sample course.json, and a manual build script are in place. Builds depend on `@fgn/scorm-player` being compiled first.

## Files

| File | Purpose |
|---|---|
| `imsmanifest.xml` | SCORM 1.2 manifest with IMS LOM metadata |
| `course.json` | The five-module course consumed by the Player at runtime |
| `build.mjs` | Combines the Player bundle + course.json + manifest into a ZIP |

## Build

```bash
pnpm --filter @fgn/scorm-player build
pnpm --filter @fgn/reference-package build
# -> dist/fgn-cs-fiber-trench.zip
```

The script relies on `zip` (Unix) or PowerShell `Compress-Archive` (Windows) being available.

## Validate

1. Upload `dist/fgn-cs-fiber-trench.zip` to [SCORM Cloud](https://cloud.scorm.com/sc/guest/SignInForm) (free account)
2. Launch the package — verify all five modules render, brand mode is Enterprise (light), and progress persists across reloads
3. Repeat in Moodle 4.x (download a free Moodle Sandbox image)

## Course structure

Five modules covering pre-work briefing, regulatory locate-and-protect content, the deep-link to the live play.fgn.gg challenge, a five-question OSHA 1926 Subpart P knowledge gate (80% pass), and a completion screen.

## Acceptance criteria for Phase 1.2 sign-off

- [ ] Validates clean in SCORM Cloud (no errors, no warnings of substance)
- [ ] Loads and runs in Moodle 4.x
- [ ] Quiz scoring writes to `cmi.core.score.raw` correctly
- [ ] Progress persists across session reloads (suspend_data round-trip)
- [ ] Course completes and marks `cmi.core.lesson_status = completed`

The launch-token bridge integration with play.fgn.gg lands in Phase 1.3 — for v0, the challenge module opens the URL with a synthetic token and the "I've submitted evidence — continue" button advances the learner.
