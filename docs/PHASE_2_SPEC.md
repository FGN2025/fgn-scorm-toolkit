# Phase 2 — Course Builder + native fgn.academy SCORM hosting

**Status:** scope locked, design ready for Lovable + future Claude sessions to implement.

**Scope:** admin-facing UI in `stratify-workforce` (fgn.academy) that lets a non-CLI admin produce a SCORM 1.2 course from any active fgn.academy Work Order. For the `fgn-academy` destination, the resulting course is **stored on fgn.academy and attached as a Learning Resource on the source Work Order** so end users see it on the Work Order page and launch it directly. For external destinations, the course is delivered as a downloadable ZIP only.

**Audience:** future Claude sessions implementing this; Lovable's React/Supabase developers; FGN brand reviewers.

**Supersedes:** the v0 design draft from earlier in the same doc series. Earlier draft missed the Learning Resource attachment requirement, which turns out to be the primary consumption path for `fgn-academy` destination courses, not a deferrable "v0.3 native publishing" feature.

---

## Locked decisions

| # | Decision | Resolution |
|---|---|---|
| 1 | **Where does the toolkit run?** | Option A — new edge function `scorm-build` on stratify-workforce that runs transform → optional enhance → package, persists artifacts, and returns the row. |
| 2 | **Scope** | v0 as listed below; multi-challenge bundling, lesson reordering, manual text override deferred to v0.1+. |
| 3 | **UI location** | Two entry points: (a) standalone page at `Admin Dashboard → Course Builder`, (b) button on the Work Order admin section that pre-fills source Work Order. |
| 4 | **Visibility** | Visible to all admins (`user_roles.role IN ('admin', 'super_admin')`). No feature flag. |
| 5 | **Edge function auth** | Session-based — admin's logged-in Supabase JWT, validated via `supabase.auth.getUser()` + `user_roles` admin check. |
| 6 | **Source unit** | **Work Order** (fgn.academy), not the underlying challenge directly. Work Orders are the FGN.academy unit of consumption; they wrap challenges via `source_challenge_id`. Course Builder operates Work-Order-first. |
| 7 | **Multiplicity** | **One SCORM course per (Work Order, destination).** Same Work Order can have up to 4 variants (fgn-academy, broadband-workforce, simu-cdl-path, external-lms). Re-generating within a destination replaces the existing row. UNIQUE constraint on `(work_order_id, destination)`. |
| 8 | **External destinations** | `broadband-workforce`, `simu-cdl-path`, `external-lms` are **download-only**. Admin downloads the ZIP and uploads it to those platforms manually. Only `fgn-academy` triggers Learning Resource attachment. |
| 9 | **SCORM Player hosting** | Hosted directly inside the stratify-workforce Vite app at `/scorm-player/:courseId/launch` (vendored from `@fgn/scorm-player` source). |
| 10 | **v0 progress tracking** | Native fgn.academy player runs in **preview mode** — content displays, but lesson-level progress is NOT yet persisted to fgn.academy's progress tables. Full progress tracking is v0.3 (contract LOCKED 2026-05-02 — see "v0.3 coordination contract" section below). External-LMS ZIPs use standard SCORM 1.2 API as already implemented. |

---

## Phase 2 v0 — what an admin can do

### From the Work Order page (most common entry)

1. Admin opens any Work Order detail page in admin mode (e.g., `/work-orders/4d58c766-…`)
2. Sees an "Admin Details" section already on the page (per the screenshot you shared)
3. New action button: **Generate SCORM Course**
4. Click → opens Course Builder modal/page with source Work Order pre-selected
5. Picks destination, brand mode, optional AI toggles
6. Click Generate → progress display → success state
7. **For `fgn-academy`:** course is stored, the Work Order page now shows a new Learning Resource card. Admin sees a "View on Work Order" link.
8. **For external destinations:** download ZIP button, no Learning Resource attachment.

### From the standalone admin page (power user / multi-step)

1. Admin opens `Admin Dashboard → Course Builder`
2. Searches or picks a Work Order from a dropdown of all active Work Orders
3. Same fields and flow as the Work Order entry

Both entry points hit the same `scorm-build` edge function with the same payload shape.

### What the end user sees

On any Work Order page, the "Learning Resources" section now renders **two kinds of cards**:

1. **Existing `sim_resources` cards** — game-wide promotional links (e.g., "Tech Certification → broadbandworkforce.com" for all Fiber-Tech Work Orders). Unchanged from today.
2. **New `scorm_courses` cards** — Work-Order-specific SCORM courses with `is_published = true` AND `destination = 'fgn-academy'`. Card title, description, and cover image come from the row. "Launch Course" button → opens `/scorm-player/{id}/launch`.

Cards from both sources render with the same visual treatment.

---

## What's IN v0

- Single-challenge → single SCORM course (one Work Order at a time)
- Default cover passthrough from play.fgn.gg's `cover_image_url` (Phase 1.4.5.1)
- Optional AI text rewrite (Phase 1.4)
- Optional AI cover regeneration (Phase 1.4.5)
- Cover hosting on fgn.academy media library (Phase 1.4.6)
- Storage of full course manifest + bundled assets in fgn.academy storage
- Native rendering of the SCORM Player at `/scorm-player/:courseId/launch`
- Learning Resource card on Work Order page (only for `fgn-academy` destination)
- ZIP download (all destinations)
- "Regenerate" replaces existing row within a (Work Order, destination) tuple
- Standalone admin page + Work Order admin button, both entry points

## What's explicitly OUT of v0

- Multi-challenge bundling (one challenge per course)
- Lesson reordering UI
- Manual text override (preview AI output but no edit-before-generate)
- Native progress tracking on fgn.academy player (preview mode only — see Decision 10)
- Per-tenant white-labeling
- Bulk operations
- Background jobs (synchronous within edge function timeout)
- Course versioning history (regenerate replaces; no audit log of prior versions in v0)

---

## Architecture

```
                      Admin (browser)
                             │
            ┌────────────────┴────────────────┐
            │ Entry A: Admin > Course Builder │
            │ Entry B: WO admin button        │
            ▼
         Course Builder UI (stratify-workforce React)
            │
            │ POST /functions/v1/scorm-build
            │ Authorization: Bearer <admin JWT>
            ▼
         scorm-build edge function (Deno)
            │
            ├─► play.fgn.gg Supabase  (anon read of challenge + tasks + game)
            │
            ├─► transform()           [vendored toolkit code]
            ├─► fetch cover_image     [Phase 1.4.5.1 passthrough]
            ├─► enhance() text        [Phase 1.4, if enableTextEnhance]
            ├─► enhance() cover       [Phase 1.4.5, if enableCoverEnhance]
            │
            ├─► fgn.academy Storage   (write course.json + assets/* unzipped)
            ├─► fgn.academy Storage   (write the full ZIP for download)
            ├─► fgn.academy DB        (insert/update scorm_courses row)
            │
            ▼
         Returns { courseId, manifestUrl, zipUrl, warnings, learningResourceVisibleAt }
            │
            ▼
         Course Builder UI shows success state
            │
            ├─► For fgn-academy: link to Work Order page
            └─► For external: download button on zipUrl


────────────  later, when end user opens the Work Order  ────────────

         End user (browser, anonymous or logged-in)
            │
            │ GET /work-orders/<id>
            ▼
         Work Order detail page (stratify-workforce React)
            │
            ├─► query sim_resources by game_title  (existing — game-wide cards)
            └─► query scorm_courses by work_order_id, is_published=true
                                                   (new — per-WO cards)
                Renders both lists in Learning Resources section
            │
            │ User clicks "Launch Course" on a scorm_courses card
            │ → /scorm-player/<courseId>/launch
            ▼
         SCORM Player route (stratify-workforce React)
            │
            ├─► query scorm_courses, fetch manifestUrl
            └─► render <iframe src="<player-bundle-url>?manifest=<manifestUrl>">
                                       [vendored from @fgn/scorm-player]
            │
            │ Player loads course.json + assets, runs course content
            ▼
         End user sees course content
            (v0 = preview mode; no progress tracked yet)
```

---

## Database changes — new `scorm_courses` table

This is the only new table for v0. No changes to existing tables.

```sql
create table public.scorm_courses (
  id uuid primary key default gen_random_uuid(),

  -- Source Work Order (required, FK)
  work_order_id uuid not null references public.work_orders(id) on delete cascade,

  -- Destination determines distribution path. UNIQUE per (work_order_id, destination)
  -- enforces the locked multiplicity decision (#7).
  destination text not null check (destination in (
    'fgn-academy', 'broadband-workforce', 'simu-cdl-path', 'external-lms'
  )),

  -- Display metadata (drives the Learning Resource card on the Work Order page)
  title text not null,
  description text,
  cover_image_url text,   -- public URL, typically media-assets/scorm-covers/...

  -- SCORM build artifacts
  scorm_version text not null default '1.2'
    check (scorm_version in ('1.2', 'cmi5')),
  manifest_url text not null,    -- public URL to course.json in storage
  zip_url text,                  -- public URL to the full ZIP for download
  bundle_id text not null,       -- matches CourseManifest.id at the toolkit level

  -- Publish state — only published rows render as Learning Resource cards.
  -- v0 default is true (admins usually want immediate publish); admins can
  -- flip to false for staging via the admin UI.
  is_published boolean not null default true,
  published_at timestamptz default now(),

  -- Build provenance (debugging, audit, future regen UX)
  generated_by uuid references auth.users(id),
  source_challenge_id uuid,      -- play.fgn.gg challenge id (cross-database, no FK)
  ai_enhanced jsonb,             -- mirrors CourseManifest.aiEnhanced shape

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (work_order_id, destination)
);

create index scorm_courses_work_order_idx on public.scorm_courses(work_order_id);
create index scorm_courses_published_idx on public.scorm_courses(is_published)
  where is_published;

-- updated_at trigger — uses the existing update_updated_at_column() helper
-- (the dominant pattern in stratify-workforce; do NOT redeclare).
create trigger scorm_courses_updated_at
before update on public.scorm_courses
for each row execute function public.update_updated_at_column();

-- RLS — uses the has_role() helper (dominant convention in stratify-workforce;
-- super_admin is implicitly covered by the admin role check, but keeping both
-- explicit is harmless and matches existing policies elsewhere in the project).
alter table public.scorm_courses enable row level security;

create policy "anyone can read published scorm courses"
on public.scorm_courses for select
to public
using (is_published = true);

create policy "admins can read all scorm courses"
on public.scorm_courses for select
to authenticated
using (
  has_role(auth.uid(), 'admin')
  or has_role(auth.uid(), 'super_admin')
);

create policy "admins can manage scorm courses"
on public.scorm_courses for all
to authenticated
using (
  has_role(auth.uid(), 'admin')
  or has_role(auth.uid(), 'super_admin')
)
with check (
  has_role(auth.uid(), 'admin')
  or has_role(auth.uid(), 'super_admin')
);
```

> **Status:** applied to FGN2025/stratify-workforce on 2026-05-02. See `supabase/migrations/20260504120000_scorm_courses_table.sql` for the canonical, applied form.

### Why a new table instead of extending existing `courses`/`modules`/`lessons`

The existing `courses`/`modules`/`lessons` system on fgn.academy models native authored content as a tree of typed lessons (currently `lesson_type IN ('quiz', 'reading')`). SCORM is not a list of typed lessons — it's a self-contained iframe-launchable bundle with its own internal structure governed by the SCORM 1.2 spec.

Trying to fit SCORM into `courses` → `modules` → `lessons` would either:
- Add a new `lesson_type = 'scorm'` whose `content` JSONB is "the entire SCORM manifest" — defeats the purpose of normalization, and lessons aren't iframe-launchable anyway
- Force admins to author lesson-by-lesson in fgn.academy and ALSO have a SCORM bundle — duplicate work

A separate `scorm_courses` table is the right boundary because SCORM courses have a fundamentally different lifecycle (built atomically by the toolkit, launched as a unit) than native authored courses (assembled lesson-by-lesson by admins).

If at some future point fgn.academy unifies the experience (e.g., a Learning Resource card can launch either a native course OR a SCORM course), a polymorphic linking table can sit on top of both `courses` and `scorm_courses`. v0 doesn't need that.

---

## Storage layout

All in the existing `media-assets` bucket (already public, already used for cover images via Phase 1.4.6):

```
media-assets/
  scorm-covers/          ← already populated by media-upload (Phase 1.4.6)
    bundle-XXXX-YYYY.png
    smoke-test-431ced69.png
    ...
  scorm-courses/         ← NEW — unzipped course content for native player
    {scorm_courses.id}/
      course.json
      assets/
        cover.jpg          ← passthrough from play.fgn.gg
        cover.png          ← OR AI-regenerated
      index.html           ← compiled @fgn/scorm-player (might also be served from app)
  scorm-bundles/         ← NEW — full ZIPs for external download
    {scorm_courses.id}.zip
```

The unzipped layout under `scorm-courses/{id}/` mirrors what's inside the ZIP. The native player route reads `course.json` from this path; relative URLs in the manifest (e.g., `assets/cover.jpg`) resolve correctly against the same directory.

For external destinations, only the ZIP at `scorm-bundles/` is needed — admin downloads it and uploads to whichever platform.

The SCORM Player HTML can be served two ways (decision deferrable):
- **A. Bundled into stratify-workforce as a Vite route** — `fgn.academy/scorm-player/index.html`, manifest URL passed via query param
- **B. Stored alongside each course** — `media-assets/scorm-courses/{id}/index.html`

Recommendation: **A.** One canonical Player URL per stratify-workforce release; manifest URL is the variable. Keeps the Player a single source of truth and one update path.

---

## Edge function: `scorm-build`

**Endpoint:** `POST https://vfzjfkcwromssjnlrhoo.supabase.co/functions/v1/scorm-build`

**Auth chain:**

1. `Authorization: Bearer <jwt>` → 401 if missing
2. `supabase.auth.getUser(jwt)` → 401 if invalid/expired
3. `user_roles.role IN ('admin', 'super_admin')` → 403 if not admin
4. `work_orders.id = req.workOrderId AND is_active = true` → 404 if missing/inactive
5. `work_orders.source_challenge_id` resolved → if null, 400 ("Work Order has no source challenge to transform")

**Request body:**

```jsonc
{
  "workOrderId": "4d58c766-74a0-48c7-8756-b08000e26974",  // required
  "destination": "fgn-academy",                            // required (one of 4 enums)
  "brandMode": "arcade",                                   // required (arcade | enterprise)
  "scormVersion": "1.2",                                   // optional, default '1.2'
  "title": "...",                                          // optional override of WO title
  "description": "...",                                    // optional override

  "enhanceText": false,                                    // toggle text slots
  "enhanceCover": false,                                   // toggle coverImage slot
  "imageQuality": "medium",                                // when enhanceCover=true
  "imageSize": "1536x1024",                                // when enhanceCover=true
  "imageModel": "gpt-image-2",                             // optional override
  "uploadCoverToAcademy": true                             // when enhanceCover=true; default true
}
```

**Server-side flow:**

1. Validate auth + work order
2. Resolve `source_challenge_id` → fetch challenge from play.fgn.gg via anon key
3. Run `transform()` → CourseManifest + assets[] (cover passthrough)
4. If `enhanceText` → run `enhance()` text slots (Anthropic)
5. If `enhanceCover` → run `enhance()` coverImage slot (OpenAI gpt-image-2)
6. Optionally upload regenerated cover via existing `media-upload` flow (Phase 1.4.6)
7. Run `packageCourse()` → SCORM ZIP bytes
8. Upload unzipped contents to `media-assets/scorm-courses/<new-id>/`
9. Upload full ZIP to `media-assets/scorm-bundles/<new-id>.zip`
10. UPSERT into `scorm_courses` (matching on `(work_order_id, destination)`):
    - On conflict: update existing row, replace storage paths, increment internal version-tag
    - On insert: new row, `is_published = true` by default for v0 (admin can flip later)
    - **Regenerate UX:** the Course Builder UI shows a confirmation modal before triggering a build that would replace an existing row ("This will replace the existing course at this Work Order + destination. Continue?"). Spec decision — preserves admin agency without adding the full draft/publish workflow that v0.6 versioning will eventually introduce.
11. Return success payload

**Response (success — 200, JSON):**

```jsonc
{
  "courseId": "uuid-of-the-scorm-courses-row",
  "manifestUrl": "https://vfzj.../media-assets/scorm-courses/<id>/course.json",
  "zipUrl": "https://vfzj.../media-assets/scorm-bundles/<id>.zip",
  "playerUrl": "https://fgn.academy/scorm-player/<id>/launch",   // null for external destinations
  "workOrderUrl": "https://fgn.academy/work-orders/<work-order-id>", // for "view on Work Order" link
  "warnings": [/* CourseWarning[] from toolkit */],
  "isReplacement": false  // true if a row already existed at (work_order_id, destination)
}
```

**Response shape choice — JSON, not binary ZIP:**

Original v0 spec returned binary ZIP bytes. Now that storage persistence is part of v0, JSON-with-URLs is cleaner. Browser downloads via `window.location.assign(zipUrl)` or anchor click on the URL — same UX, simpler edge function.

**Required env vars (Supabase function secrets):**

| Var | Purpose |
|---|---|
| `SUPABASE_URL` | auto-provided |
| `SUPABASE_SERVICE_ROLE_KEY` | auto-provided (storage writes, scorm_courses upsert) |
| `FGN_PLAY_SUPABASE_URL` | `https://yrhwzmkenjgiujhofucx.supabase.co` |
| `FGN_PLAY_SUPABASE_ANON_KEY` | for play.fgn.gg challenge reads |
| `ANTHROPIC_API_KEY` | text slots only |
| `OPENAI_API_KEY` | cover slot only |
| `FGN_ACADEMY_APP_KEY` | only if calling existing `media-upload` (could also write directly via service role; cleaner to skip the inter-function call) |

For v0, write directly to storage via service role. Skip the `media-upload` round-trip from inside `scorm-build` — that function is still useful for standalone "upload cover" calls but isn't needed inside the build pipeline.

**Timeouts:**

Lovable Cloud (managed Supabase, used by stratify-workforce) limits, tier-independent for wall-clock:

- Edge function wall-clock: **150 seconds** — the hard request timeout
- CPU time: 2s (Pro-equivalent)
- Background tasks via `EdgeRuntime.waitUntil()`: up to **400 seconds** total

Estimated wall-clock per build:

| Operation set | Estimated time |
|---|---|
| Pure passthrough (no AI) | 10–30s (challenge fetch, cover passthrough, package, storage uploads) |
| + Text enhancement | + 30–60s |
| + Cover regeneration | + 30–90s |
| Both AI slots | 90–150s — at the timeout edge |

v0 stays synchronous within 150s. **Escape hatch for AI-heavy bundles:** wrap the long tail (post-validation work — AI calls + storage uploads) in `EdgeRuntime.waitUntil()` and return immediately with the row id, then poll. This is a deferred-implementation pattern available without queuing infrastructure. Use only if the synchronous path actually hits 150s in production. v0.5 (full background jobs with a `scorm_build_jobs` table) is the long-term answer if frequent.

---

## Toolkit code reuse strategy

Same approach as Phase 1.4.6 / `scorm-publish`: **vendor toolkit source** into `supabase/functions/scorm-build/_lib/`. Copy `packages/course-types/src/*.ts`, `packages/scorm-builder/src/*.ts`, `packages/course-enhancer/src/*.ts`. Adjust workspace imports (`@fgn/...` → relative paths).

Trade-offs vs. published packages:
- **Pro:** zero dep management, runs in Deno without npm/jsr publish flow
- **Con:** keeping vendored copy in sync with toolkit — manual rebundle on toolkit changes

For v0, this is fine. Phase 2.x can publish the toolkit packages to jsr or npm if the duplication becomes painful.

---

## SCORM Player as a stratify-workforce route

Vendor `packages/scorm-player/src/*` from the toolkit into `stratify-workforce/src/scorm-player/`. The Player is itself a Vite/React app — ports cleanly into stratify-workforce as a sub-route.

**Route:** `/scorm-player/:courseId/launch`

**Component flow:**

1. Read `:courseId` URL param
2. Fetch `scorm_courses` row by id
3. If `is_published = false` and viewer is not admin → 404
4. Construct manifest URL from row's `manifest_url` field
5. Render the existing PlayerShell from the toolkit's player package
6. Player loads `course.json` from manifest URL, runs course content

**v0 progress-tracking caveat:**

The toolkit's `@fgn/scorm-player` is built around the SCORM 1.2 API (`window.API.LMSGetValue`, `window.API.LMSSetValue`, etc.) which expects a parent LMS frame to provide the API. When running natively on fgn.academy, no LMS frame is present.

For v0:
- The Player runs in **preview mode** — content displays, but no progress is persisted server-side.
- The route component exposes a `reportProgress(state)` callsite that is a **no-op in v0** but is the integration point for v0.3. Wiring this hook is part of Step 7 so v0.3 can ship without re-plumbing the Player.
- Display banner: "Preview mode — progress sync ships in v0.3."

For v0.3 — **contract LOCKED 2026-05-02** (see "v0.3 coordination contract" section below):
- Lovable's Migration #1 ships the `scorm_course_progress` table + `skill_credentials` enrichment + partial unique index.
- Lovable's edge function `scorm-session-complete` accepts the locked inbound shape and performs the locked outbound writes.
- Toolkit-side: replace v0's no-op `reportProgress(state)` with a real `useFgnAcademyProgress(courseId)` hook that POSTs to `scorm-session-complete`. Schema is stable from day one — no breaking changes between v0 hook stub and v0.3 wiring.

---

## Course Builder UI

### Sidebar entry (Entry Point A)

Add new item under Admin Dashboard in stratify-workforce's admin nav (matches the screenshot's left sidebar):

```
Admin Dashboard
  ├─ Users
  ├─ Events
  ├─ Work Orders
  ├─ Evidence Review
  ├─ SIM Games
  ├─ SIM Resources
  ├─ Media Library
  ├─ Registration Codes
  ├─ Skills Paths
  ├─ Challenge Registry
  └─ Course Builder    ← new
```

Suggested icon: 📦 file-archive / box-package / similar to "produce a SCORM file" intent.

### Work Order admin section (Entry Point B)

The Work Order detail page already has an "Admin Details" expandable section visible in the screenshot. Add a button there:

```
[ Admin Details ▼ ]
  ...
  ┌─────────────────────────────────┐
  │ ▶ Generate SCORM Course          │
  └─────────────────────────────────┘
```

Click → opens Course Builder (modal or new page) with `workOrderId` pre-filled.

If a `scorm_courses` row already exists for any destination, show the existing variants:

```
SCORM Courses
  ┌────────────────────────────────────────┐
  │ fgn-academy   • Published 2026-05-04   │
  │ View | Regenerate | Unpublish | Delete │
  └────────────────────────────────────────┘
  ┌────────────────────────────────────────┐
  │ + Generate for another destination     │
  └────────────────────────────────────────┘
```

### Page layout (single-page form, both entry points reuse)

```
┌─────────────────────────────────────────────────────────┐
│  Course Builder                                         │
│  Create a SCORM 1.2 course from a Work Order.           │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Source Work Order *                                    │
│  ┌───────────────────────────────────────────────────┐ │
│  │ [search…]            ▼                            │ │
│  └───────────────────────────────────────────────────┘ │
│  Game: <auto-filled from WO>                            │
│  Source challenge: <auto-filled from WO>                │
│                                                         │
│  Destination *           Brand mode *                   │
│  ┌─────────────────┐    ┌─────────────────────┐        │
│  │ fgn-academy   ▼ │    │ arcade           ▼  │        │
│  └─────────────────┘    └─────────────────────┘        │
│                                                         │
│  ─── AI Enhancement (optional, costs API credits) ───   │
│                                                         │
│  ☐ Rewrite text via Claude  (~$0.05–0.15 per course)    │
│  ☐ Regenerate cover image via gpt-image-2 (~$0.04)      │
│      [Quality ▼] [Size ▼]                              │
│                                                         │
│  ┌───────────────────┐  ┌───────────────────┐          │
│  │  Generate SCORM   │  │  Cancel           │          │
│  └───────────────────┘  └───────────────────┘          │
│                                                         │
│  (If a course already exists for this WO + destination, │
│   show "This will replace the existing course." banner) │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### States

- **Idle** — form, ready to fill
- **Validating** — fast, server-side check that source challenge exists; ~1s
- **Generating** — disabled form, progress spinner, status text:
  - "Fetching challenge from play.fgn.gg…"
  - "Rewriting text…" (only if enhanceText)
  - "Generating cover image…" (only if enhanceCover)
  - "Packaging SCORM ZIP…"
  - "Uploading to fgn.academy…"
- **Success — fgn-academy:**
  - Banner: "Course published"
  - Action 1: "View on Work Order →" (links to `/work-orders/<id>`)
  - Action 2: "Download ZIP" (zipUrl from response)
  - Action 3: "Generate another" (resets form)
  - Warnings list (collapsible)
- **Success — external destination:**
  - Banner: "ZIP ready for download"
  - Action 1: "Download ZIP" (zipUrl)
  - Action 2: "Generate another"
- **Error** — error banner with detail, "Try again" button

### Component breakdown (Lovable refines specifics)

```
src/pages/admin/CourseBuilder.tsx
src/components/admin/CourseBuilder/
  ├─ WorkOrderPicker.tsx           ← searchable dropdown, queries work_orders
  ├─ DestinationSelect.tsx
  ├─ BrandModeSelect.tsx
  ├─ TextEnhanceToggle.tsx
  ├─ CoverEnhanceToggle.tsx        ← checkbox + nested options
  ├─ ExistingCoursesPanel.tsx      ← if scorm_courses rows exist for this WO
  ├─ GenerateButton.tsx
  ├─ SuccessPanel.tsx              ← branches on destination
  └─ useScormBuild.ts              ← React Query mutation
src/components/work-orders/admin/
  └─ ScormCoursesAdmin.tsx         ← Entry Point B: shows existing variants + button
src/scorm-player/                  ← vendored from @fgn/scorm-player
  ├─ App.tsx
  ├─ ...
  └─ index.tsx
src/pages/scorm-player/
  └─ Launch.tsx                    ← /scorm-player/:courseId/launch
```

### Learning Resources card on Work Order page (end-user view)

Update the existing component that renders Learning Resources to query both data sources:

```tsx
// existing
const { data: simResources } = useSimResources(workOrder.game_title);

// new
const { data: scormCourses } = useScormCourses({
  workOrderId: workOrder.id,
  publishedOnly: true,
});

return (
  <LearningResourcesSection>
    {simResources?.map((r) => <SimResourceCard {...r} />)}
    {scormCourses?.map((c) => <ScormCourseCard
      key={c.id}
      title={c.title}
      description={c.description}
      coverImageUrl={c.cover_image_url}
      launchUrl={`/scorm-player/${c.id}/launch`}
    />)}
  </LearningResourcesSection>
);
```

Both card types render with the same visual treatment.

---

## Authentication & authorization summary

| Action | Auth |
|---|---|
| Open Course Builder admin page | session JWT + admin role |
| POST `/scorm-build` | session JWT + admin role |
| GET `scorm_courses` (published only) | anonymous (RLS allows) |
| GET `scorm_courses` (unpublished) | session JWT + admin role |
| INSERT/UPDATE/DELETE `scorm_courses` | session JWT + admin role (RLS) |
| GET `media-assets/scorm-courses/{id}/...` | anonymous (bucket public) |
| GET `media-assets/scorm-bundles/{id}.zip` | anonymous (bucket public) — ZIPs are not security-sensitive; SCORM courses are designed to be redistributable |
| Open `/scorm-player/:courseId/launch` | anonymous if course is_published; session JWT + admin if not |

Note: making the ZIP URL anonymous-readable is intentional. SCORM courses are designed to be redistributable artifacts; we already host the unzipped contents publicly for the native player, so making the ZIP also public is consistent. Lock down via storage policies if a specific course needs gating later.

---

## Implementation order for v0

Each step is independently testable. Steps 1–6 are edge function / DB work; 7–11 are React/UI. Can parallelize after step 4.

1. **Database migration** — `scorm_courses` table + RLS policies
2. **Vendor toolkit source** into `supabase/functions/scorm-build/_lib/`
3. **Skeleton edge function** — auth + admin check + 404 work-order check, returns stub response
4. **Wire transform → package (passthrough only)** — no AI, returns real artifacts in storage, real DB row
5. **Wire enhanceText** — feature flag, returns enhanced text in stored artifacts
6. **Wire enhanceCover** — feature flag, returns enhanced cover
7. **Vendor SCORM Player** into stratify-workforce as a route. Includes a `reportProgress(state)` no-op stub on the route component matching the v0.3 contract's inbound shape — v0 calls it but does nothing; v0.3 wires it to `scorm-session-complete`
8. **Course Builder admin page** (Entry Point A) — form, mutation hook, success state
9. **Sidebar nav entry**
10. **Work Order admin section** (Entry Point B) — existing variants list + "Generate" button + opens form
11. **Learning Resources card** — query `scorm_courses` alongside `sim_resources`, render both card types

### Acceptance gate for v0 → ship

- [ ] `scorm_courses` migration applied without affecting existing tables
- [ ] Edge function passes manual tests for all 4 destinations
- [ ] AI text + AI cover both work end-to-end
- [ ] Course Builder page renders correctly in admin theme (matches existing sidebar visual)
- [ ] Work Order admin button entry point works
- [ ] Learning Resource card appears on Work Order page after `fgn-academy` publish
- [ ] SCORM Player launch URL renders the Player and loads course content
- [ ] ZIP download works for all destinations
- [ ] Regenerate replaces (no duplicate rows)
- [ ] Brand reviewer signs off on a sample of generated covers (per Brand Guide v2 §8.6)

---

## Slicing roadmap (post-v0)

| Slice | What | Effort |
|---|---|---|
| **v0.1** Manual text override | Preview AI text output, edit before generate | 2-3 days |
| **v0.2** Multi-challenge bundling | Pick N challenges → one course | 3-5 days |
| **v0.3** Native progress tracking | `scorm_course_progress` table + `scorm-session-complete` edge fn + `useFgnAcademyProgress` hook. **Contract LOCKED 2026-05-02 — see "v0.3 coordination contract" section.** Lovable Migration #1 ships the table and `skill_credentials` enrichment alongside; toolkit-side wires the Player hook to the live endpoint. | 3-5 days (toolkit-side; Lovable scoped separately) |
| **v0.4** Lesson reordering | Drag-and-drop within a multi-challenge bundle | 2 days |
| **v0.5** Background jobs | Builds >150s queue async; status polling | 1 week |
| **v0.6** Course versioning | Audit history of regenerations; rollback | 3-4 days |
| **v0.7** Bulk operations | Generate covers for N challenges; batch publish a Skills Path | 1 week |
| **v0.8** Per-tenant white-labeling | Tenant-aware brand overrides on course covers | 5-7 days |

Reorder based on real production needs once v0 ships.

---

## v0.3 coordination contract — `scorm-session-complete`

**Status:** LOCKED 2026-05-02 between toolkit (Claude/Darcy) and stratify-workforce (Lovable). Both sides build to this shape; v0.3 ships when toolkit Step 7 hook is live and Lovable's Migration #1 + edge function are deployed.

**Why this section exists:** v0 ships with the SCORM Player in preview mode (no progress sync). v0.3 is the unlock that makes the native player a first-class learning surface — it persists resume state, awards XP on first pass, and writes Skill Passport credentials. The contract below is what both sides agreed to before either started building, so v0 step 7 can stub the hook against the final shape with zero rework when v0.3 lands.

### Ownership split

| Side | Owns |
|---|---|
| **Lovable (stratify-workforce)** | Migration #1 (`skill_credentials` enrichment + `scorm_course_progress` table + partial unique index); the `scorm-session-complete` edge function; the `user_points` first-pass guard. |
| **Toolkit (this repo)** | The `useFgnAcademyProgress(courseId)` hook in the vendored Player; the `reportProgress(state)` callsite in the Step 7 route component (v0 stub, v0.3 wires it). |

### Lovable Migration #1 — schema additions

Lands in stratify-workforce as a single migration alongside this v0 work:

1. **`skill_credentials` enrichment** — add nullable columns:
   - `course_id uuid` (references `scorm_courses.id`)
   - `module_id uuid`, `lesson_id uuid` (forward-compat for native course progress; nullable for SCORM session credentials)
   - `source text` (enum-like: `'challenge_completion' | 'scorm_session' | ...`)
   - `xp_earned integer`, `attempts integer default 1`, `duration_seconds integer`
2. **Partial unique index** — `skill_credentials_scorm_session_unique ON skill_credentials (passport_id, course_id) WHERE source = 'scorm_session'`. Enforces one credential row per (learner, SCORM course) regardless of attempt count.
3. **New `scorm_course_progress` table** — keyed on `(user_id, course_id)`:
   - `suspend_data text` (SCORM 1.2 cmi.suspend_data; up to 4096 bytes per spec)
   - `lesson_status text` (`'not attempted' | 'incomplete' | 'completed' | 'passed' | 'failed' | 'browsed'`)
   - `lesson_location text` (resume bookmark)
   - `score_raw numeric` (0–100)
   - `total_time_seconds integer` (cumulative across attempts)
   - `attempts integer default 0`
   - `last_session_id uuid`
   - `created_at`, `updated_at` standard

### Inbound contract — what the Player hook POSTs

> **Wire format refinement, 2026-05-06:** payload keys use `snake_case` to match Lovable's `scorm_course_progress` column names (one-to-one for `session_id` ↔ `last_session_id`, `scorm_suspend_data` ↔ `suspend_data`, etc.). The original camelCase example below was the conceptual contract; the on-the-wire shape is snake_case per Lovable's locked anchors. Toolkit Player exposes camelCase `ProgressState` to TS consumers; the host's `useFgnAcademyProgress` hook handles the casing translation in one place.

```jsonc
POST /functions/v1/scorm-session-complete
Authorization: Bearer <user JWT>
Content-Type: application/json

{
  "course_id": "<scorm_courses.id>",
  "session_id": "<UUID v4 generated client-side per Player mount>",
  "lesson_status": "passed",         // SCORM 1.2 cmi.core.lesson_status (CHECK-constrained server-side)
  "lesson_location": "3",            // SCORM 1.2 cmi.core.lesson_location (we use module position as string)
  "score_raw": 87,                   // 0-100; null if no quiz in course
  "passing_threshold": 80,           // from QuizModule.passThreshold; null if no quiz
  "session_time_seconds": 1240,      // monotonic seconds since Player mount
  "scorm_suspend_data": "{\"v\":1,...}",  // serialized ScormSuspendDataV1, ≤ 4096 bytes
  "passed": true,                    // derived: scoreRaw >= passingThreshold (or true if no quiz)
  "flush": true                      // OPTIONAL — terminal-event marker; client-side debounce skip; server ignores
}
```

**Locked anchors (2026-05-06, refined 2026-05-07; Lovable confirmation):**

| Field | Behavior |
|---|---|
| `session_id` | Client-generated UUID v4, stable per Player mount. Server stores in `scorm_course_progress.last_session_id`. No server-issued session handshake. |
| `session_time_seconds` | **Delta since last successful flush**, never cumulative-since-mount. Server upsert is `total_time_seconds = total_time_seconds + EXCLUDED.session_time_seconds`, period — keeps the server stateless on time math. Server CHECK-constrains `>= 0` (rejects negatives with 400) and caps a single-flush delta at **3600 seconds** (rejects above as clock-skew/bug rather than silently inflating totals). Backfills > 1 hour go through a separate admin path, not the learner sync. |
| `scorm_suspend_data` | Stored as opaque text. Server 413s on > 4096 bytes. Position-keyed envelope (see `ScormSuspendDataV1` below) for ~10x density vs UUIDs. |
| `lesson_status` | One of `not attempted | incomplete | completed | passed | failed | browsed`. CHECK-constrained server-side; non-conforming values return 400. **No-regress-from-passed guard:** once `lesson_status` flips to `passed`, subsequent payloads may update `score_raw` upward but cannot flip status back to `incomplete` or `failed`. Matches SCORM 1.2 spirit and prevents a late-arriving stale flush from un-passing a course. (Client derivation already converges to `passed` once thresholds are met, so this is server defense-in-depth.) |
| `score_raw` | Last-write-wins with the no-regress guard above. Server takes whatever client sends; the credential write uses max-of (kept on UPSERT conflict). |
| `flush` | Client-side debounce-bypass signal for terminal events (course completion). Server ignores the field; treats the call identically to a debounced one. |

**4xx response shape (locked 2026-05-07):**

All 4xx responses follow a stable JSON shape so the hook can branch on a machine-readable code rather than string-matching the human message:

```jsonc
{
  "error": "human-readable description",
  "code": "STABLE_ERROR_CODE"   // optional but preferred
}
```

The full `code` enum is documented in the curl-matrix PR body alongside Lovable's matrix output (TBD when the edge function lands). The committed 4xx scenarios are:

| Scenario | Status | Notes |
|---|---|---|
| `session_time_seconds < 0` | 400 | "session_time_seconds must be >= 0" |
| `session_time_seconds > 3600` | 400 | "session_time_seconds exceeds 3600s single-flush cap"; backfills > 1 hour go out-of-band |
| `lesson_status` not in the 6-value enum | 400 | CHECK constraint surfacing as structured error |
| Missing `session_id` | 400 | required field |
| Valid payload but `passport_id` lookup fails (orphaned user) | 404 | distinct from 400; signal to client that auth is fine but the learner has no passport row yet (create-if-missing covers this on the happy path; 404 is the edge case where create itself fails) |

The hook should retry on 5xx (transient) and surface 4xx to the host without retry (the request is malformed; retrying with the same body won't help). 401 and 403 also bypass retry — re-auth is the user's problem, not the hook's.

**Hook-side retry semantics (locked 2026-05-07):**

The hook tracks `lastFlushedTimeSeconds: number` in a ref. On every flush:

1. Compute `delta = sessionTimeSeconds - lastFlushedTimeSeconds`.
2. POST with `session_time_seconds: delta`.
3. **Only advance the ref on a 2xx response.** Non-2xx → leave the ref where it is, retry on next state change with the same delta + any new accumulated time.
4. The completion-bypass `flush: true` payload uses the same code path; whatever delta has accumulated since the last successful flush gets sent, server treats it identically to a debounced call.

This makes double-fires impossible from the contract: only client-side bugs (advancing the ref before the response confirms success) can cause double-counting. Server stays naive; client owns the at-least-once-but-not-double semantics.

**Suspend-data envelope (`ScormSuspendDataV1`):**

```jsonc
{
  "v": 1,
  "currentPosition": 3,              // module.position (1-based) of the current module
  "completedPositions": [1, 2, 3],   // sorted list of completed module positions
  "quizScores": {
    "5": { "score": 87, "passed": true }   // keyed by quiz module position as string
  }
}
```

Position-keyed (vs UUID-keyed) because (a) ~10x byte density inside the 4KB cap and (b) survives course regenerate — module UUIDs may shift between rebuilds while positions are stable within a manifest version. The Player's restore-on-mount intersects positions against the freshly fetched manifest; positions not present (regen dropped a module) are silently dropped.

**Client-side debounce policy:**

The hook fires on every meaningful state change (lesson complete, quiz submitted, suspend on unload). To collapse bursty quiz-answer churn, the hook debounces at **2 seconds, trailing edge** by default. Terminal events (course completion, suspend on unload) bypass the debounce by sending `flush: true` so the credential write isn't gated on a trailing timer. The server is fully idempotent (UPSERT on `(user_id, course_id)` for progress; partial unique index gating the credential write; first-pass guard on `user_points`) but every call still costs auth verify + 2-3 RLS-checked writes — debounce trims wasteful traffic without affecting correctness.

### Outbound contract — what `scorm-session-complete` writes

Lovable's edge function performs **two writes always, one write conditionally**:

1. **`scorm_course_progress` UPSERT (always)** — keyed on `(user_id, course_id)`. Stores resume state, latest lesson_status, latest lesson_location, max(score_raw), sum(total_time_seconds across attempts), incremented attempts counter, last_session_id. This is the resume-state target the Player reads on mount.

2. **`skill_credentials` UPSERT (only when `passed === true && scoreRaw >= passingThreshold`)** — relies on the partial unique index `(passport_id, course_id) WHERE source = 'scorm_session'`. On conflict: keep best-of `xp_earned` and `score_raw`, increment `attempts`, do NOT re-award XP. On insert: create new credential row, set `source = 'scorm_session'`.

3. **`user_points` insert (guarded, first-pass only)** — only on the INSERT branch of #2 (i.e., the learner's first passing attempt). Prevents XP re-award on subsequent re-attempts. Amount comes from the xp walk-back: `lessons.xp_reward → work_orders.xp_reward → 100` default.

### Resolved questions (the five that were open)

| # | Question | Resolution |
|---|---|---|
| 1 | How does the function find `passport_id` from `userId`? | **Create-if-missing** pattern, matching the existing `sync-challenge-completion` edge function. Function looks up `skill_passports.user_id`; if absent, INSERT with default values, then proceed. |
| 2 | How is `skills_verified` derived for the credential? | **Function-side rollup via SQL JOIN** through `scorm_courses → work_orders → lessons` to collect skills tagged on the source content. No new column on `scorm_courses`; the rollup happens at write time. |
| 3 | Where does `xp_earned` come from? | **Walk-back chain:** `lessons.xp_reward → work_orders.xp_reward → 100` default. First non-null wins. Same pattern as challenge completion. |
| 4 | How is multi-attempt idempotency enforced? | **Partial unique index** `(passport_id, course_id) WHERE source = 'scorm_session'` + UPSERT semantics. Best-of score, attempts++, no XP re-award. One credential row per (learner, course) regardless of attempts. |
| 5 | Where does `scormSuspendData` go? | **`scorm_course_progress` table** (new, in Migration #1). Keyed on `(user_id, course_id)`. The Player reads this on mount to restore resume state and writes it on suspend/state-change. |

### Toolkit-side commitments

When v0.3 lands, the toolkit-side work is bounded:

1. Replace the `reportProgress(state)` no-op stub on the Step 7 route component with a real `useFgnAcademyProgress(courseId)` hook.
2. Hook POSTs the inbound shape above to `/functions/v1/scorm-session-complete` with the user's session JWT.
3. Hook reads `scorm_course_progress` on mount to restore resume state into the Player (cmi.suspend_data, cmi.core.lesson_location).
4. No changes to the toolkit's `transform()` / `enhance()` / `pack()` — the contract is purely in the Player layer.

This means v0 Step 7 can ship the route with the `reportProgress` callsite already in the right place, and v0.3 is a contained ~3-5-day swap of the no-op for the real hook.

---

## v0.1 coordination contract — manual text override

**Status:** DRAFT 2026-05-07 by toolkit (Claude/Darcy); pending Lovable line-level review and lock. v0.3 has shipped — toolkit is unblocked to start v0.1 implementation as soon as this contract locks. Both sides build to this shape once locked.

**Why this section exists:** v0 admins have a binary "regenerate or publish" choice when AI text isn't quite right — there's no preview-and-edit step between `enhanceText: true` and a written-to-storage manifest. v0.1 unlocks that loop: admin sees the AI output, edits inline, then publishes the edited version. Adds admin trust in AI text without unlocking the full v0.6 draft/publish workflow.

### Ownership split

| Side | Owns |
|---|---|
| **Lovable (stratify-workforce)** | Course Builder UI: split "Build" into "Generate Preview" + "Publish" steps; preview pane rendering description + briefing HTMLs + quiz questions; inline editors for each (textarea/rich-text for HTML, per-question editor for quizzes); state management for admin edits across the preview-publish cycle; loading state during preview (Anthropic latency 15-30s). |
| **Toolkit (this repo)** | `scorm-build` edge function additions: `dryRun` flag, `briefingHtml` + `quizQuestions` override fields, override-wins-over-enhance per-slot logic, preview response shape, override validation. No DB schema change; no new edge function. |

### Toolkit additions to `BuildRequest`

Three new optional fields, all backwards-compatible (omitting any of them = current v0 behavior):

```ts
interface BuildRequest {
  // ... existing fields (workOrderId, destination, brandMode, scormVersion,
  // title?, description?, enhanceText?, enhanceCover?, imageQuality?,
  // imageSize?, imageModel?, uploadCoverToAcademy?) ...

  /**
   * If true, run transform + enhance and return the resulting CourseManifest
   * in the response without writing to storage / scorm_courses / ZIP. Used
   * by the Course Builder UI to show admin a preview before publish.
   * Default: false.
   */
  dryRun?: boolean;

  /**
   * Per-module HTML overrides for briefing modules. Keyed by module id
   * (e.g. "c-{prefix}-briefing"). When provided for a module, that
   * module's briefing.html is set to the override BEFORE the enhance
   * step, and that slot is skipped during enhance (override wins).
   * Server validates: < 8000 chars per module, DOMPurify-sanitizable
   * (no script/iframe), non-empty.
   */
  briefingHtml?: Record<string, string>;

  /**
   * Per-module quiz question overrides. Keyed by quiz module id (e.g.
   * "c-{prefix}-quiz"). When provided, that module's `questions` array
   * is replaced with the override BEFORE enhance, and the quiz slot is
   * skipped during enhance for that module. Each override array must be
   * a complete replacement (not a partial patch). Server validates: each
   * question has at least one correct choice; question type matches
   * choice cardinality (single-choice = 1 correct; multi-choice = 1+).
   */
  quizQuestions?: Record<string, QuizQuestion[]>;
}
```

`title?` and `description?` are existing override fields that already work; v0.1 reuses them as-is for the course-level overrides. `briefingHtml` and `quizQuestions` are the new module-level keyed overrides.

**All override fields (`title`, `description`, `briefingHtml`, `quizQuestions`) work identically on `dryRun: true` and `dryRun: false`** — they're applied to the manifest before enhance runs in both phases. Preview = same processing as publish, minus the persist phase. This lets admins iterate (preview → edit → re-preview-with-edits-applied → edit → publish) without contract surprises between the two states.

### Inbound contract — preview phase (initial, no overrides)

First admin click on "Generate Preview" — pure AI run, no edits yet.

```jsonc
POST /functions/v1/scorm-build
Authorization: Bearer <admin JWT>

{
  "workOrderId": "<work_orders.id>",
  "destination": "fgn-academy",
  "brandMode": "arcade",
  "enhanceText": true,            // run AI text rewrite
  "dryRun": true                  // return manifest without persisting
}
```

**Preview response (200):**

```jsonc
{
  "status": "preview",            // distinguishes from "ok"
  "manifest": <CourseManifest>,   // full course.json shape
  "warnings": [...]               // transform + enhance warnings
}
```

No `courseId`, no `manifestUrl`, no `zipUrl`, no `playerUrl` — nothing was persisted. The UI renders `manifest.description`, each briefing module's `html`, and each quiz module's `questions[]` into editable fields.

### Inbound contract — preview phase (iterative, with admin edits applied)

After admin edits one or more slots, they re-preview to see the merged result before publishing. Overrides are applied per-slot; non-overridden slots regenerate via enhance (cache-friendly per §"Resolved questions #5").

```jsonc
POST /functions/v1/scorm-build
Authorization: Bearer <admin JWT>

{
  "workOrderId": "<work_orders.id>",
  "destination": "fgn-academy",
  "brandMode": "arcade",
  "enhanceText": true,            // still on, for non-overridden slots
  "dryRun": true,

  // Admin's edits so far:
  "description": "edited description",
  "briefingHtml": {
    "c-abc123-briefing": "<p>edited briefing #1</p>"
    // briefing #2 NOT keyed here -> regenerates via enhance
  }
  // No quizQuestions key -> all quiz modules regenerate via enhance
}
```

**Response shape identical to initial preview** (`{status: "preview", manifest, warnings}`) — but `manifest.description` and the briefing #1 HTML reflect admin's edits, while briefing #2 and all quizzes show the latest AI-rewritten output. Single coherent manifest, no flag indicating "this slot was overridden vs. enhanced" — Lovable tracks that client-side via the edit state.

### Inbound contract — publish phase (after admin edits)

```jsonc
POST /functions/v1/scorm-build
Authorization: Bearer <admin JWT>

{
  "workOrderId": "<work_orders.id>",
  "destination": "fgn-academy",
  "brandMode": "arcade",
  "enhanceText": false,           // skip enhance — admin provided final text
  "dryRun": false,                // OR omit (default false)

  // Course-level overrides (existing fields):
  "title": "edited course title (optional)",
  "description": "edited course description",

  // Module-level overrides (new in v0.1):
  "briefingHtml": {
    "c-abc123-briefing": "<p>edited briefing HTML…</p>"
  },
  "quizQuestions": {
    "c-abc123-quiz": [
      {
        "id": "q1",
        "prompt": "What is the proper conduit depth?",
        "type": "single-choice",
        "choices": [
          { "id": "a", "label": "12 inches", "correct": false },
          { "id": "b", "label": "24 inches", "correct": true },
          { "id": "c", "label": "36 inches", "correct": false }
        ]
      }
    ]
  }
}
```

**Publish response (200):** same shape as v0 — `{status: "ok", courseId, manifestUrl, zipUrl, playerUrl, workOrderUrl, coverImageUrl, title, isReplacement, warnings}`.

### Override-vs-enhance precedence

For each slot (description, briefingHtml, quizQuestions), per module where applicable:

1. **Override provided (regardless of `enhanceText` flag)** → use override; that slot skips enhance entirely. Equivalent to setting `enhanceText: false` for that one slot.
2. **Override NOT provided AND `enhanceText: true`** → run enhance for this slot.
3. **Override NOT provided AND `enhanceText: false`** → use template-derived output (existing v0 behavior).

This means admin can mix-and-match: edit the description, accept the AI-rewritten briefing, override one quiz module's questions while letting another regenerate. Per-slot, per-module granularity. No "all-or-nothing" lock-in.

### Cover image in v0.1

**Out of scope; cover regen is publish-only, not preview.** v0.1 is text-only. `enhanceCover: true` continues to work as in v0 — gpt-image-2 regenerates the cover and writes it to storage during the **publish** phase. **`dryRun: true` does NOT trigger `enhanceCover`** even when both flags are set; the regen runs once on publish if requested. Rationale: gpt-image-2 is expensive (~$0.04-0.08/image, 30-60s latency) and admins iterating through preview cycles would burn tokens fast for no UX benefit (the cover doesn't depend on the text edits anyway). When admin clicks Publish, enhanceCover (if requested) runs and the regenerated cover lands in `media-assets/scorm-courses/<id>/assets/cover.png` as part of the persist phase. UI should show "Your cover will be regenerated when you publish" rather than a preview thumbnail. Manual cover upload is a separate feature path; defer to v0.x or beyond.

### Server-side validation rules

- `briefingHtml[moduleId]` — must reference a module that exists in the manifest with `type: 'briefing'`; ≤ 8000 chars; DOMPurify-sanitizable (no `<script>`, `<iframe>`); non-empty after sanitization. 400 on violation.
- `quizQuestions[moduleId]` — must reference a module with `type: 'quiz'`; non-empty array; each question has `id`, `prompt`, `type` ∈ {single-choice, multi-choice, true-false}, `choices` array with ≥ 2 entries; `single-choice` exactly one `correct: true`; `multi-choice` ≥ 1 `correct: true`; **`true-false` exactly 2 choices, exactly 1 correct**. 400 on violation.
- Unknown `moduleId` keys in either override map → 400 (better to fail loudly than silently ignore).

**All override-field validation errors aggregate into a single 400 response** so the UI can highlight every malformed field at once instead of fix-one-discover-next. Body shape extends the locked 4xx contract from v0.3 with an optional `issues` array:

```jsonc
{
  "error": "override validation failed",
  "code": "OVERRIDE_VALIDATION",
  "issues": [
    { "path": "briefingHtml.c-abc-briefing", "message": "exceeds 8000 char cap (got 9420)" },
    { "path": "quizQuestions.c-xyz-quiz[2].choices", "message": "single-choice requires exactly 1 correct, got 0" }
  ]
}
```

Other 4xx errors (auth, missing fields, etc.) keep the simpler `{error, code?}` shape; only `OVERRIDE_VALIDATION` carries `issues`.

### Resolved questions

| # | Question | Resolution |
|---|---|---|
| 1 | Where do admin edits persist between preview and publish? | **UI-side React state only.** No DB-side draft state in v0.1 — that's v0.6 versioning. Admin must complete preview → edit → publish in one session. Refresh = lose edits. UI may add a "do you want to discard your changes?" guard on navigation. |
| 2 | Can admin re-preview after editing? | **Yes.** Preview is idempotent + cacheable (enhance.ts content-hash cache hits if input unchanged). Admin can preview → edit → preview-with-edits → publish. Edits-applied previews skip enhance for overridden slots, so re-preview is fast for the unchanged slots. |
| 3 | What happens if admin sends `enhanceText: true` AND overrides? | **Override wins per-slot.** Enhance runs for non-overridden slots; overridden slots are pinned to admin's text. No "all-or-nothing" toggle. |
| 4 | What happens if admin sends `dryRun: true` AND overrides? | **Allowed and useful.** Lets admin preview their edits before publishing. The preview applies overrides + runs enhance for non-overridden slots; admin sees the final manifest pre-persist. |
| 5 | Cost implications of multiple previews? | **Each preview triggers Anthropic for non-overridden slots only.** Cache hits if the input is identical (transform output is deterministic; first preview populates cache; subsequent unchanged previews hit). If admin edits a slot, that slot's override skips enhance entirely on next preview. Net: re-preview cost is roughly proportional to the number of slots admin DIDN'T edit. |

### Toolkit-side commitments

When v0.1 lands, the toolkit-side work is bounded:

1. Add `dryRun?: boolean`, `briefingHtml?: Record<string, string>`, `quizQuestions?: Record<string, QuizQuestion[]>` to `BuildRequest` interface in `scorm-build/index.ts`.
2. After `transform()` + before `enhanceCourse()`: apply briefingHtml/quizQuestions overrides to the manifest (mutate the matching `BriefingModule.html` / `QuizModule.questions`).
3. Add a `skipModuleIds?: Set<string>` option to `enhanceCourse()` so overridden modules don't get re-enhanced **at the per-module level**. The existing `slots: EnhancedField[]` filter is course-level coarse-grained — setting `slots: ['briefingHtml']` runs the loop for ALL briefing modules; we need per-module skipping inside `runBriefingSlot` / `runQuizSlot`. The course-level `description` slot already has the right granularity via the existing `slots` filter (skip the slot entirely when overridden). ~5 lines per per-module slot-runner. Mirror to `_lib/course-enhancer/enhance.ts`.
4. Add validation for the new override fields before the transform call. Return 400 with the aggregated `OVERRIDE_VALIDATION` shape (see §"Server-side validation rules") — accumulate ALL violations and emit one structured error response, never short-circuit on first failure.
5. If `dryRun: true`: run transform + enhance (skipping overridden modules per #3) and return `{status: "preview", manifest, warnings}`. Skip all storage uploads, scorm_courses upsert, ZIP packaging. **Also skip enhanceCover entirely on dryRun** even when `enhanceCover: true` — gpt-image-2 only runs on publish.
6. Mirror all changes to vendored `_lib/` copies.
7. Smoke matrix additions to `PHASE_2_V0_SMOKE_TEST.md`: preview→publish happy path, iterative preview-with-edits, partial override, full override (no enhance run at all for text), `dryRun + enhanceCover` (cover does NOT regenerate), invalid override (aggregated 400 with multiple `issues`).

Toolkit estimate: 2-3 days including smoke + doc updates. No `_lib/` parity changes beyond the new override-validation logic and the `skipModuleIds` option.

### Lovable-side commitments

1. Course Builder UI splits the "Build" action into "Generate Preview" and "Publish" steps. Preview triggers `dryRun: true`; publish triggers `dryRun: false` with override fields populated from the edit pane.
2. Preview pane renders `manifest.description`, each `BriefingModule.html` (one per briefing), each `QuizModule.questions[]` (one block per quiz module) as editable fields.
3. Inline editors:
   - Description: textarea or rich-text input.
   - Briefing HTML: rich-text editor preferred (DOMPurify-allowed tag set); textarea fallback acceptable.
   - Quiz: per-question editor — prompt textarea, type dropdown, choices list with label inputs and `correct: boolean` checkboxes; add/remove choice buttons; add/remove question buttons.
4. State management: admin edits live in React state; "Publish" button assembles the override fields from state and POSTs.
5. Loading states: spinner during preview (Anthropic 15-30s). Optional: surface progress text ("Rewriting description…", "Rewriting briefing 1 of 3…") via per-slot enhancement events if toolkit exposes them. Stretch goal; not required for v0.1 lock.
6. Navigation guard: if admin has unsaved edits and clicks away, prompt "Discard your edits?" — standard pattern.

### Sequencing

Following the same playbook as v0.3 (locked, not lockstep):

1. **Toolkit ships** the `dryRun` + override fields + validation in `scorm-build` edge function. Curl-testable in isolation against existing UI which still uses the v0 single-build flow. No regression to v0 behavior — the new fields are additive.
2. **Lovable ships** the Course Builder preview-edit-publish UI against the curl-tested edge function. Validates preview round-trips, edit-publish round-trips, validation 400s for malformed overrides.
3. **Cross-test:** end-to-end preview → edit → publish against a real WO; smoke the v0 flow stayed green (regression check); brand-reviewer pass on a course where description was admin-edited (does the manifest still meet brand?).

Toolkit can start as soon as v0.3 ships; Lovable's UI work can run in parallel once the edge function is curl-green.

---

## Open questions — RESOLVED 2026-05-03

All five blocked-on-decisions resolved before Phase 2 implementation kicks off:

1. **Edge function timeout** — ✅ resolved. Lovable Cloud runs on Pro-equivalent: 150s wall-clock, 2s CPU. `EdgeRuntime.waitUntil()` available for up to 400s background tasks if needed. v0 stays synchronous; waitUntil() is the escape hatch if AI-heavy bundles brush the 150s ceiling. v0.5 still scopes proper background jobs for frequent long-runs.
2. **Brand reviewer for v0** — ✅ resolved. **Darcy reviews directly.** Apply Brand Guide v2 §8.6 checklist to the first 5–10 covers when v0 lands; sign off before opening the Course Builder to other admins.
3. **SCORM Player vendoring vs. publishing** — ✅ resolved. v0 vendors. Note as engineering-backlog item; revisit at Phase 2.x or v1 if duplication starts to bite.
4. **Regenerate UX** — ✅ resolved. **Confirmation modal** before a build that would replace an existing `(work_order_id, destination)` row. Modal text: "This will replace the existing course at this Work Order + destination. Continue?" Full draft/publish workflow deferred to v0.6 versioning.
5. **Cross-Work-Order course reuse** — ✅ resolved. **Duplication is acceptable.** Per-WO rows even when two WOs share `source_challenge_id`. Admin curates per-WO context (different titles, framing, brand mode).

Phase 2 v0 is fully scoped and unblocked.

---

## How v0 connects to what's already shipped

```
                    ┌──────────────────────────────────────────────┐
                    │  Phase 2 v0: scorm-build edge fn             │
                    │   + Course Builder admin UI (2 entry points) │
                    │   + scorm_courses table                      │
                    │   + SCORM Player route                       │
                    │   + Learning Resource card on WO page        │
                    └─────────────────────┬────────────────────────┘
                                          │
                ┌──────────┬──────────────┼──────────────┬──────────┐
                ▼          ▼              ▼              ▼          ▼
         transform()   enhance()    media-upload    pack()    scorm-launch-status
         Phase 1.4.5.1 Phase 1.4   Phase 1.4.6     Phase 1.3 Phase 1.5
         passthrough   AI text+img upload          ZIP build  bridge
                                                              (existing)
```

All toolkit primitives shipped, validated, committed. v0 is the cockpit + storage + UI integration that makes them usable without the CLI.

---

— End of Phase 2 v0 spec —
