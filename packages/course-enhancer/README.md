# @fgn/course-enhancer

Optional AI rewrite pass between `transform()` and `package()`. Takes a `CourseManifest` produced by `@fgn/scorm-builder` and returns a copy with rewritten course description, briefing HTML, and quiz questions, leaving everything else untouched.

## Status

**Phase 1.4 v0.** Text-only enhancement using Anthropic Claude. Cover image generation is deferred to Phase 1.4.5.

## Why this is its own package

Enhancement is **opt-in** and **side-effecting** — it costs Anthropic tokens and produces non-deterministic output. Keeping it in a separate package means the core build pipeline (`transform → package`) remains pure, free of the Anthropic SDK as a runtime dep, and runnable in environments without an API key (CI smoke tests, edge functions that just re-package an already-enhanced manifest, etc.).

## Design rules

1. **Additive.** The enhancer never deletes or replaces a field it can't successfully regenerate. On per-slot failure it keeps the template-derived original and emits a `CourseWarning`.
2. **Idempotent-ish.** Identical input + identical model + identical prompt = identical output (via a content-hash cache). Re-running on a manifest that already carries `aiEnhanced` is a no-op against the cache; only the slots whose input has changed will hit the API.
3. **Stamped.** Every enhanced output carries `course.aiEnhanced.{model, enhancedAt, inputHash, enhancedFields}` so reviewers and downstream tooling can tell what happened and roll back precisely.
4. **Graceful.** A missing API key, transport error, or schema-validation failure becomes a warning, not a crash. The function returns the best manifest it could produce.

## Defaults

Following the `claude-api` skill's house defaults:

- **Model:** `claude-opus-4-7` (override via `options.model`)
- **Thinking:** adaptive — the only on-mode for Opus 4.7
- **Streaming:** all calls stream and `await stream.finalMessage()` so we never hit transport timeouts on long outputs
- **Prompt cache:** the FGN style guide is pinned as a stable system block with a `cache_control` breakpoint, so an N-challenge bundle only pays full ingest cost on the first call
- **Effort:** API default (`high`). Override to `xhigh` on Opus 4.7 for the best cost/quality tradeoff in production

## Slots

| Slot              | What it rewrites                                        | Output kind   |
| ----------------- | ------------------------------------------------------- | ------------- |
| `description`     | `course.description` (catalog blurb, ≤ 280 chars)       | plain text    |
| `briefingHtml`    | `BriefingModule.html` for every briefing in the course  | sanitized HTML |
| `quizQuestions`   | `QuizModule.questions` for every quiz in the course     | structured JSON |

Quiz output is constrained at decode time via `output_config.format = json_schema` and validated a second time at runtime. A failed validation falls back to the placeholder questions.

## Usage

### Programmatic

```ts
import { enhanceCourse } from '@fgn/course-enhancer';

const { course: enhanced, warnings, stats } = await enhanceCourse(course, {
  // ANTHROPIC_API_KEY env var is read automatically
  effort: 'xhigh',
  cache: { persistDir: './.enhancer-cache' },
});
```

### CLI

```bash
export ANTHROPIC_API_KEY=sk-ant-…
fgn-scorm enhance ./course.json \
  --out ./course.enhanced.json \
  --cache-dir ./.enhancer-cache \
  --effort xhigh
```

`--dry-run` skips the API entirely and emits a single `ENHANCER_DISABLED` warning, useful for CI dry-runs that exercise the rest of the pipeline without spending tokens.

## What this is not

- **Not a translator.** US English in, US English out.
- **Not a fact-checker.** It will not invent CFR citations or standard numbers. It will use the framework label that's already on the manifest.
- **Not a sanitizer.** Briefing HTML is restricted to a small allowlist (`<p>`, `<strong>`, `<em>`, `<h3>`, `<ul>`, `<li>`) at prompt time, but the player should still apply its own sanitization.
- **Not a media pipeline.** Cover image generation lands in 1.4.5; the `coverImageUrl` and `thumbnailUrl` fields are reserved on `CourseManifest` for that pass.
