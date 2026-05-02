# @fgn/scorm-player

The React runtime that ships inside every SCORM package. Single compiled bundle, identical for every export, parameterised by the `course.json` manifest at the package root.

## Status

**Phase 1.2 — v0 implemented.** Builds to a single inlined HTML file. Five module types (briefing, challenge, quiz, media, completion). SCORM 1.2 API wrapper with stub fallback for local preview. Brand mode auto-applies per course manifest.

## What v0 includes

- SCORM 1.2 API discovery + adapter (walks parent window chain, falls back to console-logging stub for local dev)
- `course.json` schema (`schemaVersion: 1`) loaded from alongside `index.html`
- Brand mode application via `@fgn/brand-tokens` (Arcade or Enterprise, frozen at build time)
- Tenant white-label override application (`primary` / `secondary` / `logoUrl` only)
- Player shell: header (logo + course title), TOC sidebar, content pane, footer (progress + nav)
- Five module types:
  - **briefing** — sanitized HTML rich-text content with "Mark as read" advance
  - **challenge** — deep-link launcher to play.fgn.gg with launch-token bridge (token endpoint stubbed for v0; real bridge in Phase 1.3)
  - **quiz** — knowledge-gate, scenario-style, configurable pass threshold, unlimited retakes
  - **media** — sim clip / screenshot viewer
  - **completion** — final summary + preliminary score
- Progress persistence via `cmi.suspend_data` (with 4KB warning per SCORM 1.2 spec)
- Auto-marks `cmi.core.lesson_status = completed` and writes preliminary score when all modules complete

## What v0 does NOT include yet

- xAPI / cmi5 statement emission — Phase 4
- Async final-score writeback after rubric review — Phase 5
- Real launch-token edge function on play.fgn.gg — Phase 1.3
- Captions / accessibility audit — Phase 6
- Tenant-level logo SVG file — drop into `@fgn/brand-tokens/assets/` per its README

## Boundaries

- Does NOT host the challenge itself — that lives on play.fgn.gg
- Does NOT handle evidence upload — that happens on play.fgn.gg
- Does NOT do WYSIWYG slide authoring — Course Builder's job (Phase 3)

## Build

```bash
pnpm --filter @fgn/scorm-player build
```

Output: `dist/index.html` — single self-contained file (HTML + inlined JS + inlined CSS) that `@fgn/scorm-builder` drops into every SCORM ZIP alongside `course.json` and bundled media.

## Local preview

```bash
pnpm --filter @fgn/scorm-player dev
```

Place a `course.json` next to the dev server's served `index.html` (or fetch from a fixture). Without a SCORM API in scope, the Player runs in console-logging stub mode and behaves identically — just without writing back to a real LMS.

## Bundle size

Target: under 500 KB gzipped. Verified at build time. If the budget is exceeded, audit dependencies first — `react` + `react-dom` is ~140 KB minified. Avoid adding rich-text editors or quiz frameworks; the runtime's job is to render, not to author.

## File map

```
src/
  main.tsx              — bootstrap: load course.json, apply mode, mount App
  App.tsx               — top-level state: progress, current module, SCORM session
  types.ts              — CourseManifest, module types, ProgressState
  styles.css            — Tailwind layers + prose overrides
  scorm/
    api.ts              — ScormSession class: discover API, get/set/commit
  components/
    PlayerShell.tsx     — header / sidebar / footer / progress bar
    Wordmark.tsx        — image-or-text FGN logo
    RichText.tsx        — sanitized HTML renderer
  modules/
    BriefingModule.tsx
    ChallengeModule.tsx
    QuizModule.tsx
    MediaModule.tsx
    CompletionModule.tsx
```

## Consumes

- `@fgn/brand-tokens` (workspace) — design tokens, mode helpers, Tailwind preset
