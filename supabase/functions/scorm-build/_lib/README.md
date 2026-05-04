# scorm-build / _lib — vendored toolkit source

This directory contains a Deno-runnable copy of the relevant source from
the `@fgn/course-types`, `@fgn/scorm-builder`, `@fgn/course-enhancer`,
and (a minimal subset of) `@fgn/brand-tokens` packages from the
fgn-scorm-toolkit monorepo.

**Why vendor instead of import?** The toolkit packages are not published
to npm or jsr — they live as workspace packages in the toolkit repo.
For Deno edge functions to use them, we copy the relevant source here
and rewrite imports to relative paths.

**Source of truth:** `fgn-scorm-toolkit/packages/{course-types, scorm-
builder, course-enhancer}/src/`. When the toolkit changes, vendored
copies are re-synced.

**Differences from the toolkit source:**

1. `brand-tokens.ts` is a minimal shim — only the build-time exports
   (`BrandMode`, `ScormDestination`, `destinationToMode`,
   `credentialFrameworkToPillar`). The original module has DOM-aware
   helpers (`detectMode`, `applyMode`, `applyTenantOverrides`,
   `localStorage` calls) that don't run in Deno.

2. Imports rewritten:
   - `'@fgn/course-types'` → `'../course-types.ts'` or relative
   - `'@fgn/brand-tokens'` → `'../brand-tokens.ts'` or relative
   - Cross-package imports become folder-relative

3. Files NOT vendored:
   - `cli.ts` — Node-specific CLI shell
   - `academy-uploader.ts` — calls the media-upload edge function
     externally; the scorm-build edge function writes to storage
     directly via service role
   - `cache.ts` — disk cache. In-memory only is fine for an edge
     function; if a cache is wanted, it can be re-introduced as a
     simple Map.

4. SDK imports (`@anthropic-ai/sdk`, `openai`, `jszip`) load via
   `https://esm.sh/...` URLs in the entry file (`../index.ts`) and
   are propagated through whatever import shape the original uses
   (default export from `Anthropic from '@anthropic-ai/sdk'`).

## Layout

```
_lib/
  course-types.ts                 ← from packages/course-types/src/index.ts
  brand-tokens.ts                 ← shim (build-time exports only)
  scorm-builder/
    transform.ts
    builder.ts
    fetcher.ts
    pack.ts
    manifest-xml.ts
    play-types.ts
    pathway-validators.ts
    briefing-templates.ts
    lesson-map.ts                 ← if needed
  course-enhancer/
    enhance.ts
    anthropic-client.ts
    openai-client.ts
    prompts/
      style-guide.ts
      description.ts
      briefing.ts
      quiz.ts
      cover-image.ts
```
