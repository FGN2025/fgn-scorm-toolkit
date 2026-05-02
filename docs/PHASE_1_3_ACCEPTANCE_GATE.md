# Phase 1.3 Acceptance Gate — runbook

The gate proves the FGN SCORM Toolkit works end-to-end against real infrastructure. Eleven steps, ~60-90 minutes if everything goes smoothly.

## Pass criteria

- [ ] **Code compiles** — `pnpm -r build` succeeds, no TypeScript errors
- [ ] **Migration applied** — `scorm_launch_tokens` table and `provision_fgn_scorm_toolkit_app()` function exist on fgn.academy
- [ ] **App key captured** — plaintext key in your env, hash in `authorized_apps` table
- [ ] **Edge function deployed** — `scorm-launch-status` runs on fgn.academy
- [ ] **Transformer works** — `fgn-scorm transform <real-challenge-id>` produces valid `course.json`
- [ ] **Packager works** — `fgn-scorm package course.json ...` produces a SCORM 1.2 ZIP
- [ ] **SCORM Cloud validation passes** — no errors, no warnings of substance
- [ ] **Moodle ingestion works** — package loads, navigates, completes
- [ ] **Native publish works** — `publishCourse()` writes to fgn.academy `courses` / `modules` / `lessons`
- [ ] **Bridge round-trips** — SCORM Player polls show completion after evidence submission on play.fgn.gg

---

## Step 1 — Install + build

```bash
cd fgn-scorm-toolkit
pnpm install
pnpm -r build
```

**Expect:** every package builds clean. If `@fgn/scorm-player` fails on missing logo SVGs, confirm the prebuild script ran (it copies `@fgn/brand-tokens/assets/*.svg` into `packages/scorm-player/public/assets/`).

If the build fails on `@fgn/scorm-player` because of `vite-plugin-singlefile`'s asset inlining behavior interacting with the static SVG path strings, that's expected — the Wordmark uses literal `./assets/...` paths that aren't bundled. The 333 KB + 392 KB SVG files stay external in the SCORM ZIP.

## Step 2 — Apply the migration

Two paths:

**A. Lovable + stratify-workforce repo (recommended)**
1. Open the stratify-workforce Lovable project
2. Drop `supabase/migrations/20260429120000_scorm_authoring_init.sql` into `supabase/migrations/` in the repo
3. Commit on a feature branch, push, let Lovable preview the migration
4. Verify the preview, then promote to main → applies to fgn.academy

**B. Direct via Supabase SQL editor**
1. Open `vfzjfkcwromssjnlrhoo` in the Supabase dashboard
2. SQL Editor → New query → paste migration → Run

**Verify:**
```sql
SELECT to_regclass('public.scorm_launch_tokens');             -- expect: scorm_launch_tokens
SELECT proname FROM pg_proc WHERE proname = 'provision_fgn_scorm_toolkit_app';
```

## Step 3 — Provision the API key

Run **once** in the SQL editor:
```sql
SELECT public.provision_fgn_scorm_toolkit_app();
```

Copy the returned hex string (64 chars). This is the only time the plaintext is visible. Save it as:

```bash
export FGN_ACADEMY_APP_KEY=<the-hex-string>
```

Also add it to:
- Lovable project secrets for the toolkit
- Any deployed scorm-launch-status edge function's secret store (Step 4)

## Step 4 — Deploy `scorm-launch-status` edge function

1. Open stratify-workforce in Lovable
2. Create a new edge function: `scorm-launch-status`
3. Paste the contents of `supabase/functions/scorm-launch-status/index.ts`
4. Commit, deploy
5. **Verify:**
```bash
curl -X POST https://vfzjfkcwromssjnlrhoo.supabase.co/functions/v1/scorm-launch-status/mint \
  -H "X-App-Key: $FGN_ACADEMY_APP_KEY" \
  -H "Content-Type: application/json" \
  -d '{"challengeId":"ff3ea57d-9e4a-48ae-b3ab-f261ac183ffe","scormStudentId":"darcy@fgn.gg"}'
```
**Expect:** `{ "token": "<64-hex-chars>", "expiresAt": "..." }`

## Step 5 — Transform a real challenge

Use the Gold Challenge as the gate fixture.

```bash
export FGN_PLAY_SUPABASE_URL=https://yrhwzmkenjgiujhofucx.supabase.co
export FGN_PLAY_SUPABASE_ANON_KEY=<from Supabase dashboard for play.fgn.gg>

pnpm --filter @fgn/scorm-builder exec fgn-scorm transform \
  ff3ea57d-9e4a-48ae-b3ab-f261ac183ffe \
  --destination broadbandworkforce \
  --out ./acceptance/gold-challenge.json
```

**Expect:** `./acceptance/gold-challenge.json` exists with:
- `schemaVersion: 1`
- `title: "CS - Gold Challenge - Uncommon Rarity"`
- `brandMode: "enterprise"`
- `modules: [briefing, challenge, completion]` (no quiz — Construction Simulator doesn't trigger a knowledge gate by default)
- The challenge module's `tasks: []` array contains 3 tasks pulled from `challenge_tasks`

If the transformer errors with `ChallengeNotPublishedError`, the challenge has `is_active=false` on play.fgn.gg — publish it first.

## Step 6 — Package the SCORM ZIP

```bash
pnpm --filter @fgn/scorm-builder exec fgn-scorm package \
  ./acceptance/gold-challenge.json \
  --player ./packages/scorm-player/dist/index.html \
  --white-svg ./packages/brand-tokens/assets/logo-fgn-wordmark-white.svg \
  --ink-svg ./packages/brand-tokens/assets/logo-fgn-wordmark-ink.svg \
  --out ./acceptance/gold-challenge.zip
```

**Expect:** `./acceptance/gold-challenge.zip` (typically 1-2 MB given the unoptimized SVGs).

The script prints the file list. Verify it includes:
- `imsmanifest.xml`
- `index.html`
- `course.json`
- `assets/logo-fgn-wordmark-white.svg`
- `assets/logo-fgn-wordmark-ink.svg`

## Step 7 — Validate in SCORM Cloud

1. Sign in (free): https://cloud.scorm.com/sc/guest/SignInForm
2. Library → Add Content → Import a SCORM package
3. Upload `./acceptance/gold-challenge.zip`
4. Click "Launch" on the imported course

**Pass criteria:**
- Import succeeds with no validation errors
- Course launches without a blank screen
- Header renders the FGN wordmark (white logo on dark bg if Arcade, ink on light if Enterprise — in this case Enterprise → ink logo)
- TOC sidebar lists all modules
- Briefing slide renders with proper typography (Inter for Enterprise mode)
- Challenge module shows the 3 tasks
- "Launch challenge in play.fgn.gg" button opens a new tab to the live challenge URL
- After clicking "I've submitted evidence — continue", the SCO marks completed in SCORM Cloud's tracking

**Common failures and fixes:**
- "Manifest: invalid file reference" → The manifest's `<file href="...">` list doesn't match what's in the ZIP. Check `result.files` from `packageCourse` against the ZIP entries.
- "Course exited without committing" → SCORM API discovery failed. Open browser devtools, check console for `[scorm-stub]` logs (means LMS didn't inject `window.API`).
- Blank screen → `course.json` failed to load. Check Network tab for 404; the manifest might be missing a `<file>` entry.

## Step 8 — Validate in Moodle

Easiest path: use the Moodle Sandbox (free, throwaway): https://sandbox.moodledemo.net (resets every hour)

1. Sign in as `admin` / `sandbox24`
2. Site administration → Plugins → Activity modules → SCORM package
3. Course → Add an activity → SCORM package → Upload your ZIP
4. Save and view

**Pass criteria:** same as SCORM Cloud. Note that Moodle's SCORM player is more permissive than SCORM Cloud — passing in SCORM Cloud means it'll pass in Moodle too.

## Step 9 — Native fgn.academy publish

Write a tiny Node script (or use `tsx` for TS):

```ts
// acceptance/publish-test.ts
import { createClient } from '@supabase/supabase-js';
import { transform, createSupabaseFetcher } from '@fgn/scorm-builder';
import { publishCourse } from '@fgn/academy-publisher';
import { readFileSync } from 'node:fs';

const playClient = createClient(
  process.env.FGN_PLAY_SUPABASE_URL!,
  process.env.FGN_PLAY_SUPABASE_ANON_KEY!,
);
const academyClient = createClient(
  'https://vfzjfkcwromssjnlrhoo.supabase.co',
  process.env.FGN_ACADEMY_SERVICE_ROLE_KEY!,
);

const { course, warnings } = await transform({
  challengeIds: ['ff3ea57d-9e4a-48ae-b3ab-f261ac183ffe'],
  destination: 'fgn-academy',
}, createSupabaseFetcher(playClient as any));

console.log('Transform warnings:', warnings);

const result = await publishCourse(course, academyClient as any, {
  tenantId: null,
  isPublished: false,
});

console.log('Published:', result);
```

Run it:
```bash
node --import tsx acceptance/publish-test.ts
```

**Expect:**
- `result.courseId` is a UUID
- `result.lessonIds.length === 3` (briefing, challenge, completion)
- A new `courses` row exists on fgn.academy with `is_published=false` (verify in dashboard)
- The challenge lesson links to a real `work_orders.id` via `work_order_id`
- `result.warnings` may include `MISSING_WORK_ORDER` if no one has completed the challenge yet on play.fgn.gg — provision a work_order first by completing once or have the team add the row directly

## Step 10 — Bridge end-to-end

This is the most involved test. Two browser tabs:

**Tab A:** SCORM Cloud, with the package launched.
**Tab B:** play.fgn.gg, signed in as a real user (e.g. `claude-tester` per the platform-constants memory).

Sequence:
1. In Tab A, advance to the challenge module
2. Click "Launch challenge in play.fgn.gg"
3. New tab opens at `https://play.fgn.gg/challenges/ff3ea57d-...?fgnLaunchToken=<token>` — confirm the token is in the URL
4. In Tab B, complete the challenge: enroll, complete tasks, submit evidence
5. Wait for an admin to verify evidence (or self-verify if you have admin role) — this triggers `challenge_completions` insert which fires `sync-to-academy`
6. Return to Tab A
7. Click "I've submitted evidence — continue" OR wait for the Player's poll
8. The Player calls `scorm-launch-status?token=...`, which correlates to `user_work_order_completions`
9. Module marks completed, score reported back

**Verify in Supabase:**
```sql
-- On fgn.academy:
SELECT * FROM scorm_launch_tokens
WHERE scorm_student_id = 'claude-tester@fgn.gg'
ORDER BY created_at DESC LIMIT 1;
-- Expect: status='completed', preliminary_score is set
```

## Step 11 — Sign off

Update the toolkit's root [README.md](../README.md) status section to reflect Phase 1.3 acceptance:

```
## Status

Phase 1.3 — accepted on YYYY-MM-DD by Darcy.
   - SCORM Cloud: validated against Gold Challenge package
   - Moodle 4.x: validated
   - fgn.academy native publish: validated
   - Launch-token bridge: end-to-end round-trip confirmed
```

Then move on to Phase 2 (Course Builder admin UI in fgn.academy).

---

## What to do if a step blocks

| Block | Likely cause | Fix |
|---|---|---|
| Migration won't apply | `digest()` from `pgcrypto` extension not enabled | `CREATE EXTENSION IF NOT EXISTS pgcrypto;` then retry |
| `verify_app_api_key` returns 0 rows | Hash algorithm mismatch | Check stratify-workforce for the actual `verify_app_api_key` SQL — adjust the digest call in `provision_fgn_scorm_toolkit_app()` to match |
| `MISSING_WORK_ORDER` blocks publish test | The challenge has never been completed on fgn.academy | Have anyone (real user, claude-tester) complete the challenge once on play.fgn.gg, OR insert a `work_orders` row directly with `source_challenge_id = <gold-challenge-id>` |
| SCORM Cloud says "Bad XML" | The course title or description contains characters not escaped in the manifest | Check `manifest-xml.ts`'s `escapeXml` — file an issue with a repro |
| Player runs but `cmi.core.lesson_status` never moves to "completed" | The completion module's auto-mark logic in `App.tsx` isn't firing | Check the dev console for SCORM API errors; verify all modules' `completedModuleIds` have populated |

## Performance benchmarks (informational)

| Step | Target | Actual |
|---|---|---|
| `transform()` of 1 challenge | < 2s (network bound) | ___ |
| `packageCourse()` | < 1s | ___ |
| `publishCourse()` | < 3s | ___ |
| SCORM Cloud import | < 30s | ___ |
| Bridge round-trip latency (evidence submit → SCORM Player detects) | < 15s on next poll | ___ |

Fill these in during the gate run for future regression baselines.
