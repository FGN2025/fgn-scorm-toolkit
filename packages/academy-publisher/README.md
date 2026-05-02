# @fgn/academy-publisher

Native fgn.academy publish path. Takes a `CourseManifest` (produced by `@fgn/scorm-builder.transform()`) and POSTs it to the `scorm-publish` edge function on fgn.academy. The edge function — not this client — does the actual database writes using its auto-injected service role.

## Architecture

```
                                              ┌──────────────────────────────────┐
                                              │   fgn.academy Supabase project   │
                                              │                                  │
   CourseManifest                              │  scorm-publish edge function     │
        │                                      │   - X-App-Key authentication     │
        ▼                                      │   - service role auto-injected   │
  publishCourse(course, options)               │     by Supabase (never leaves)   │
        │                                      │                                  │
        │  POST /scorm-publish ───────────────►│   resolves work_orders           │
        │  X-App-Key: <fgn-scorm-toolkit>      │   inserts courses + modules +    │
        │  body: { course, options }           │   lessons rows                   │
        │                                      │                                  │
        │ ◄───  { courseId, moduleIds,         └──────────────────────────────────┘
        │       lessonIds, warnings }
        ▼
   PublishResult
```

## Why this shape

The previous (Phase 1.3.0) version of this package took a Supabase client directly and wrote rows from the client side. That meant whoever ran the publisher needed the service role key on their machine — a security anti-pattern. The current version (0.2.0) flips that: the service role key never exists outside the Supabase environment, and clients authenticate via an app-key validated by `verify_app_api_key`.

This also means:
- Phase 2 Course Builder UI can publish via plain HTTP — no secrets in browser
- Multiple admins / environments don't need their own service role keys
- All publishing flows through one auditable endpoint

## Usage

```ts
import { transform, createSupabaseFetcher } from '@fgn/scorm-builder';
import { publishCourse } from '@fgn/academy-publisher';
import { createClient } from '@supabase/supabase-js';

// 1. Read challenges from play.fgn.gg with anon key
const playClient = createClient(PLAY_URL, PLAY_ANON_KEY);
const fetcher = createSupabaseFetcher(playClient);

const { course, warnings: transformWarnings } = await transform({
  challengeIds: ['ff3ea57d-9e4a-48ae-b3ab-f261ac183ffe'],
  destination: 'fgn-academy',
}, fetcher);

// 2. Publish to fgn.academy via edge function (no service role on client)
const result = await publishCourse(course, {
  appKey: process.env.FGN_ACADEMY_APP_KEY!,
  // endpoint: defaults to https://vfzjfkcwromssjnlrhoo.supabase.co/functions/v1/scorm-publish
  tenantId: null,           // SCORM-derived courses are FGN-canonical
  isPublished: false,       // admin reviews in fgn.academy UI before publishing
  difficultyLevel: 'intermediate',
});

console.log(result.courseId);    // UUID of the new course
console.log(result.warnings);    // EXISTING_CE_LESSON_PRESENT, MISSING_WORK_ORDER, etc.
```

## CLI usage

```bash
# Transform a challenge first
fgn-scorm transform ff3ea57d-... --destination fgn-academy --out ./course.json

# Then publish
fgn-scorm publish ./course.json
# requires FGN_ACADEMY_APP_KEY in env
```

## Warnings emitted by the edge function

| Code | Level | When |
|---|---|---|
| `MISSING_WORK_ORDER` | warn | A challenge has no work_order on fgn.academy yet. Skipped. Admin must provision then re-publish. |
| `EXISTING_CE_LESSON_PRESENT` | info | Challenge is already in the curated Challenge Enhancer course. Publisher emits a parallel lesson; admin chooses whether to keep both. |
| `LESSON_INSERT_FAILED` | warn | A specific lesson insert failed but the course/module are usable. |

## Build

```bash
pnpm --filter @fgn/academy-publisher build
```

## Versioning

- 0.1.0 — initial direct-Supabase implementation (deprecated, never deployed)
- 0.2.0 — edge-function-mediated; clients only need an app key, never service role
