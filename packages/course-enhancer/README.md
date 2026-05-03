# @fgn/course-enhancer

Optional AI rewrite pass between `transform()` and `package()`. Takes a `CourseManifest` produced by `@fgn/scorm-builder` and returns a copy with rewritten course description, briefing HTML, and quiz questions, leaving everything else untouched.

## Status

**Phase 1.4.6 v0.** Text enhancement (description, briefing HTML, quiz questions) via Anthropic Claude — Phase 1.4. Opt-in cover image generation via OpenAI `gpt-image-2` — Phase 1.4.5. Default cover passthrough from play.fgn.gg's `cover_image_url` — Phase 1.4.5.1. Optional server-side upload of AI-generated covers to fgn.academy's media library — Phase 1.4.6.

## Why this is its own package

Enhancement is **opt-in** and **side-effecting** — it costs Anthropic tokens and produces non-deterministic output. Keeping it in a separate package means the core build pipeline (`transform → package`) remains pure, free of the Anthropic SDK as a runtime dep, and runnable in environments without an API key (CI smoke tests, edge functions that just re-package an already-enhanced manifest, etc.).

## Design rules

1. **Additive.** The enhancer never deletes or replaces a field it can't successfully regenerate. On per-slot failure it keeps the template-derived original and emits a `CourseWarning`.
2. **Idempotent-ish.** Identical input + identical model + identical prompt = identical output (via a content-hash cache). Re-running on a manifest that already carries `aiEnhanced` is a no-op against the cache; only the slots whose input has changed will hit the API.
3. **Stamped.** Every enhanced output carries `course.aiEnhanced.{model, enhancedAt, inputHash, enhancedFields}` so reviewers and downstream tooling can tell what happened and roll back precisely.
4. **Graceful.** A missing API key, transport error, or schema-validation failure becomes a warning, not a crash. The function returns the best manifest it could produce.

## Defaults

### Text slots (Anthropic)

Following the `claude-api` skill's house defaults:

- **Model:** `claude-opus-4-7` (override via `options.model` or CLI `--model`)
- **Thinking:** adaptive — the only on-mode for Opus 4.7
- **Streaming:** all calls stream and `await stream.finalMessage()` so we never hit transport timeouts on long outputs
- **Prompt cache:** the FGN style guide is pinned as a stable system block with a `cache_control` breakpoint, so an N-challenge bundle only pays full ingest cost on the first call
- **Effort:** API default (`high`). Override to `xhigh` on Opus 4.7 for the best cost/quality tradeoff in production

### Image slot (OpenAI)

- **Model:** `gpt-image-2` (April 2026 release, state-of-the-art). Override via `options.openai.model` or CLI `--image-model`.
- **Quality:** `medium` (~$0.04/image, the production sweet spot). `low` (~$0.01) for prototyping, `high` (~$0.17) for hero pages.
- **Size:** `1024x1024` square by default. Pass `--image-size 1536x1024` for cinematic landscape covers (recommended for hero-tile catalog grids).
- **Style:** game-flavored cinematic illustration with FGN brand chrome — arcade or enterprise mode based on `course.brandMode`. Low-angle hero shot, mid-action implication, atmospheric haze, **no text/logos/faces in the frame**. See `src/prompts/cover-image.ts`.
- **Org-verification gate:** OpenAI requires organization verification (one-time ID check) before `gpt-image-2` becomes available. If you hit `403 Your organization must be verified`, complete verification at https://platform.openai.com/settings/organization/general — propagation takes up to 15 min. Until then, fall back to `--image-model gpt-image-1-mini` (8× cheaper, no verification required, slightly less rigid prompt adherence).

## Slots

| Slot              | What it produces                                                  | Output kind   | Default? |
| ----------------- | ----------------------------------------------------------------- | ------------- | -------- |
| `description`     | `course.description` (catalog blurb, ≤ 280 chars)                 | plain text    | ✅ on    |
| `briefingHtml`    | `BriefingModule.html` for every briefing in the course            | sanitized HTML | ✅ on    |
| `quizQuestions`   | `QuizModule.questions` for every quiz in the course               | structured JSON | ✅ on    |
| `coverImage`      | `assets/cover.png` next to course.json + `course.coverImageUrl`   | PNG bytes     | ⛔ opt-in |

Quiz output is constrained at decode time via `output_config.format = json_schema` and validated a second time at runtime. A failed validation falls back to the placeholder questions.

**The `coverImage` slot is opt-in.** It requires an OpenAI key (separate from Anthropic), costs ~$0.04/image at default `medium` quality, and writes a binary PNG to disk. Enable explicitly:

```ts
slots: ['description', 'briefingHtml', 'quizQuestions', 'coverImage']
```

The image is generated as a game-flavored cinematic illustration with FGN brand chrome (arcade vs enterprise mode based on `course.brandMode`), with **no text in the image** — titles and wordmarks are rendered as HTML overlay by the player / catalog UI. Saves us from AI typography failure modes.

`enhanceCourse(...)` returns a new `assets[]` array containing `{ path, bytes, mimeType }`. The CLI writes these to disk next to `course.json`; the SCORM packager later picks them up by following `course.coverImageUrl` (relative path).

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

### CLI — text only (default)

```bash
export ANTHROPIC_API_KEY=sk-ant-…
fgn-scorm enhance ./course.json \
  --out ./course.enhanced.json \
  --cache-dir ./.enhancer-cache \
  --effort xhigh
```

### CLI — text + cover image (gpt-image-2 default)

```bash
export ANTHROPIC_API_KEY=sk-ant-…
export OPENAI_API_KEY=sk-…
fgn-scorm enhance ./course.json \
  --out ./course.enhanced.json \
  --slots description,briefingHtml,quizQuestions,coverImage \
  --image-quality medium \
  --image-size 1536x1024 \
  --cache-dir ./.enhancer-cache
```

This writes both `./course.enhanced.json` AND `./assets/cover.png`. The packager later picks up the PNG and bundles it into the SCORM ZIP at the same relative path.

### CLI — cover image only on a budget (gpt-image-1-mini fallback)

If your OpenAI org isn't verified yet, or you're doing bulk corpus regeneration where ~$0.04/image adds up:

```bash
fgn-scorm enhance ./course.json \
  --slots coverImage \
  --image-model gpt-image-1-mini \
  --image-quality medium \
  --image-size 1536x1024 \
  --cache-dir ./.enhancer-cache
```

Mini gives you a recognizable cinematic illustration at $0.005/image. Less rigid prompt adherence than `gpt-image-2` (we observed slight color-grade drift toward warm rim light vs strict arcade cyan), but production-acceptable.

### CLI — cover image + upload to fgn.academy media library (Phase 1.4.6)

When you regenerate a cover for a different endpoint context (e.g., broadbandworkforce.com vs fgn.academy generic), you usually want the new bytes hosted on fgn.academy's media library so the catalog/admin UI can reference a stable URL. Add `--upload-to-academy`:

```bash
export ANTHROPIC_API_KEY=sk-ant-…
export OPENAI_API_KEY=sk-…
export FGN_ACADEMY_APP_KEY=<provisioned via provision_fgn_scorm_toolkit_app()>
fgn-scorm enhance ./course.json \
  --slots coverImage \
  --image-quality medium \
  --image-size 1536x1024 \
  --upload-to-academy \
  --cache-dir ./.enhancer-cache
```

The toolkit will:
1. Generate the cover via OpenAI as usual
2. Write `assets/cover.png` next to course.json (for SCORM ZIP bundling)
3. POST the bytes to fgn.academy's `media-upload` edge function
4. Stamp the returned public URL on `course.coverImageRemoteUrl`

**Default-passthrough flow doesn't trigger upload.** When the toolkit uses an existing play.fgn.gg cover (Phase 1.4.5.1), `coverImageRemoteUrl` is already set to the original Supabase URL — no re-upload needed. `--upload-to-academy` only matters when you're generating new bytes that would otherwise have nowhere to live except inside the SCORM ZIP.

Upload failure is non-fatal — the local `cover.png` still gets bundled into the SCORM ZIP. You'll see an `ENHANCER_UPLOAD_FAILED` warning and the manifest just won't have `coverImageRemoteUrl` stamped.

`--dry-run` skips ALL APIs (text + image) and emits a single `ENHANCER_DISABLED` warning, useful for CI dry-runs that exercise the rest of the pipeline without spending tokens.

## What this is not

- **Not a translator.** US English in, US English out.
- **Not a fact-checker.** It will not invent CFR citations or standard numbers. It will use the framework label that's already on the manifest.
- **Not a sanitizer.** Briefing HTML is restricted to a small allowlist (`<p>`, `<strong>`, `<em>`, `<h3>`, `<ul>`, `<li>`) at prompt time, but the player should still apply its own sanitization.
- **Not a thumbnail pipeline.** v0 generates a single 1024×1024 cover. Smaller catalog-grid thumbnails are deferred to Phase 1.4.7 if Phase 2 admin UI needs them.
- **Not a media-library uploader.** v0 only embeds the image inside the SCORM ZIP. Phase 1.4.6 adds `--upload-to-academy` for fgn.academy media library hosting.
- **Not a typesetter.** The image is generated WITHOUT text in it — course titles and wordmarks are rendered as HTML overlay by the player / catalog UI to avoid AI typography failure modes.
