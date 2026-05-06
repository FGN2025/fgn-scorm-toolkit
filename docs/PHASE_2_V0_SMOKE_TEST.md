# Phase 2 v0 — End-to-end smoke test results

**Date:** 2026-05-06
**Tested by:** Darcy (admin browser session) + Claude (driver/triage)
**Build under test:**
- Toolkit at HEAD `58264bc` (Phase 2 v0 steps 1–4.5 + spec lock)
- stratify-workforce live with Migration #1 + Lovable steps 7–11 + trigger polish
- Test course: `41ef18d1-f9ae-4ab5-9135-34479b6cfcf3` ("CS Fiber: Conduit Placement and Backfill")

**Outcome: v0 spine validated end-to-end across all three paths.** Six items remain to ship gate; none are structural.

---

## Paths tested

### Path A — Admin sidebar entry → Course Builder → Player ✅

1. `/admin/course-builder` rendered with form
2. Picked CS Fiber WO → Build SCORM Course → success state with Course ID, Manifest, ZIP, Open in Player
3. Open in Player landed at `/scorm-player/<id>/launch`
4. **Cover banner displays correctly at top of Player chrome** (Lovable Step 7 fix from earlier in session — `new URL(coverImageUrl, manifestUrl).href` resolution working)
5. Briefing → completion modules render
6. **Finish overlay appears** (Trophy + "Course Complete") with primary "Return to Work Order" CTA + secondary "Review Modules" dismiss
7. Return-to-Work-Order link navigates to source WO page correctly

### Path B — Work Order admin button entry → pre-filled Course Builder ✅ (with UX caveat)

1. Navigated to a WO admin detail page (`/work-orders/d9f48aac-...`)
2. Expanded Admin Details panel
3. Clicked "Build SCORM course from this Work Order" entry
4. Landed at `/admin/course-builder` with the source WO **pre-selected in the picker** (plumbing works)

**UX issue noted:** the entry point is rendered as a flat row inside Admin Details, not as a recognizable button. Easy to miss. Functional plumbing is correct; visual treatment needs Lovable polish.

### Path C — Public WO page → Learning Resources card → Player ✅

1. Navigated to `/work-orders/<id>` for the WO with the published SCORM course
2. **Learning Resources section shows the new SCORM card** with title, cover image, SCORM 1.2 badge, "Launch Course" CTA, "SCORM ZIP" link
3. Click Launch Course → opened the Player route → cover banner + course content loaded as in Path A

This is the highest-value path because it is the **end-user consumption flow**. Anonymous-readable launch URL works (RLS public read on `is_published = true` rows).

---

## Toolkit-side bug surfaced during testing

**`inferFramework()` misclassifies TIRAP-aligned challenges as CDL.**

Smoking-gun evidence is in the `41ef18d1` manifest:

```jsonc
{
  "credentialFramework": "CDL",   // ← inferFramework() output
  "modules": [
    { "type": "briefing", "html": "...Standard reference: TIRAP UUIT, FOA OSP Outside Plant Construction, OSHA 29 CFR 1926 Subpart P..." },
    { "type": "completion", "html": "..." }
  ]
}
```

The briefing template — which inspects the same source data — explicitly identifies this as TIRAP UUIT-aligned. But `inferFramework()` returned CDL. Because CDL is not in the default `knowledgeGateFrameworks` list (`['OSHA', 'TIRAP', 'OpTIC Path']`), the toolkit correctly skipped emitting a quiz module — so the manifest only has briefing + completion (2 modules) instead of briefing + quiz + completion (3 modules).

This isn't a Lovable Player bug (the Player rendered exactly what the manifest contained); it's an upstream data-classification bug in `_lib/scorm-builder/pathway-validators.ts`. Likely cause: the function looks at a different field than the briefing template uses. Estimated fix: 30 min once the source-of-truth field is identified.

**Impact while unfixed:**
- Misclassified courses ship with incorrect `credentialFramework` metadata
- Quiz modules don't emit for affected courses
- `QUIZ_PLACEHOLDER_NEEDS_AUTHORING` warning doesn't fire (not displayed in Course Builder result panel)
- v0.3 Skill Passport credentials would be issued under the wrong framework

Doesn't block v0 ship (no real-world consequence in v0 since credentials aren't yet issued — that's v0.3), but should be fixed before brand-reviewer signoff so shipped courses have correct metadata.

---

## Lovable-side polish items (sent in consolidated message)

None block v0 ship. All collected during smoke testing for batch fix:

1. **Step 10 UX — entry point doesn't look like a button.** The "Build SCORM course from this Work Order" element on the WO admin page renders as a flat row inside Admin Details with no CTA affordance (no border, fill, chevron, or hover treatment). Should match the visual weight of the "Launch Challenge" button at top-right.

2. **Step 8 navigation — `/admin/course-builder` is an orphan page.** No admin sidebar, no breadcrumb, no back-to-admin link. Once an admin lands here (especially via Step 10 deep-link with `?workOrderId=`), the only escape is browser back. Add the standard admin sidebar or at minimum a "← Admin Dashboard" breadcrumb.

3. **Step 11 — possible spec divergence on Learning Resources merge.** On the WO with a published SCORM course, the Learning Resources section showed only the SCORM card (no `sim_resources` "Tech Certification" card visible alongside). Spec says BOTH sources should render side-by-side. Worth Lovable confirming whether the query filters `sim_resources` differently than expected for that specific WO, or whether Step 11 is replacing rather than UNION-ing.

4. **Trigger answer — keep current INSERT-OR-UPDATE behavior.** Lovable proposed switching `trg_course_completion_credential` and `trg_module_milestone_credential` to INSERT-only. Recommendation declined: native fgn.academy course flow requires UPDATE branch (rows go INSERT(completed_at=null) → UPDATE(completed_at=now())). Existing guards (`IF TG_OP='UPDATE' AND OLD.completed_at IS NOT NULL THEN RETURN`) make the trigger idempotent for both flows. The optional symmetry-cleanup polish to `handle_module_milestone_credential` was applied.

---

## v0 ship-gate status

| Item | State |
|---|---|
| Migration applied | ✅ |
| Edge function — `fgn-academy` destination | ✅ end-to-end |
| Edge function — other 3 destinations | ⚪ untested (recommend a quick `external-lms` smoke before ship) |
| AI text + AI cover | ⚪ Steps 5/6 pending (toolkit) |
| Course Builder page | ✅ |
| Sidebar nav entry | ✅ |
| WO admin button entry | ✅ (UX polish pending) |
| Learning Resource card on WO page | ✅ (sim_resources merge confirmation pending) |
| SCORM Player loads + renders | ✅ |
| ZIP download | ✅ |
| Regenerate replaces | ✅ |
| Brand reviewer signoff (5–10 covers) | ⏳ blocked on Step 6 (cover regeneration) |
| `inferFramework()` TIRAP bug | ⏳ toolkit fix |

**Six items left to v0 ship.** Three toolkit-side (Steps 5, 6, framework fix), two Lovable polish (button styling, sidebar), one Brand Reviewer pass.

---

## Recommended next-session order

1. **Toolkit Step 5** — wire Anthropic SDK + `enhanceText` flag plumbing, smoke test rewritten text in stored manifest
2. **Toolkit Step 6** — wire OpenAI gpt-image-2 + `enhanceCover` flag plumbing, smoke test generated cover in manifest + ZIP
3. **Toolkit `inferFramework()` fix** — investigate `_lib/scorm-builder/pathway-validators.ts`, identify why CS Fiber maps to CDL, fix and re-run smoke
4. **End-to-end smoke with full AI enhancement** — produces real generated covers for Brand Reviewer pass
5. **Brand Reviewer signoff** — Darcy reviews first 5-10 covers per Brand Guide v2 §8.6
6. **v0 ships** → coordinate v0.3 kickoff with Lovable on `scorm-session-complete`

---

## v0.3 contract status

LOCKED 2026-05-02; captured in `PHASE_2_SPEC.md` § "v0.3 coordination contract". Ready to start as soon as v0 ships. Lovable's Migration #1 already includes the schema (skill_credentials enrichment + scorm_course_progress table + partial unique index), so toolkit-side step 7 hook stub is pointing at a stable target. v0.3 work is contained to:
- Lovable building `scorm-session-complete` edge function (3-5 days)
- Toolkit replacing `reportProgress(state)` no-op stub with real `useFgnAcademyProgress(courseId)` hook (1-2 days)

— End of smoke-test session log —

---

## Addendum — Step 5+6 prep (2026-05-06, same day)

After the session log above closed, three updates landed: a coordination check with Lovable, two toolkit fixes, and a clean-baseline tag.

### Coordination check — Lovable confirmed clean baseline

Migration #1, `scorm_courses` schema, edge function, and `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` env all stable since `0b1a460`. Lovable also smoke-tested the three previously-untested destinations against WO `82352214…`:

| destination | build 1 | build 2 | manifest | zip | warnings |
|---|---|---|---|---|---|
| external-lms | 200, isReplacement=false | 200, isReplacement=true (same `df369795`) | 200 / 2707b | 200 / 3.30 MB | none |
| broadband-workforce | 200, isReplacement=false | 200, isReplacement=true (same `dee15e1e`) | 200 / 2685b | 200 / 3.30 MB | none |
| simu-cdl-path | 200, isReplacement=false | 200, isReplacement=true (same `67011de8`) | 200 / 2679b | 200 / 3.30 MB | none |

Replacement semantics confirmed: same `courseId` reused on rebuild, in-place overwrite of manifest + zip, `isReplacement` flag flips correctly on call 2. No edge-log noise, no warnings array entries. Lovable's bisect commitment: if Step 5 regresses any destination post-deploy, the bisect target is `enhanceText` wiring in `_lib/course-enhancer/enhance.ts`, **not** the destination router.

### Toolkit commits landed

- **`d447fe4`** — backport of Lovable's `fgn_origin_challenge_id ?? source_challenge_id` preference fix to `supabase/functions/scorm-build/index.ts` (lines 318, 393). Lovable shipped this in `stratify-workforce` to fix "challenge not found" 502s on Work Orders where the local `source_challenge_id` and the canonical `play.fgn.gg` challenge UUID diverge. Backport keeps toolkit and live runtime in sync — without it, the next deploy from toolkit HEAD would regress the fix. `fgn_origin_challenge_id` is text-nullable in `work_orders`, added by stratify migration `20260406042607` and backfilled from `source_challenge_id`. Always prefer `fgn_origin_challenge_id` when constructing `play.fgn.gg` URLs or API calls.

- **`701bf20`** — `inferFramework()` precedence fix in both `packages/scorm-builder/src/pathway-validators.ts` and `supabase/functions/scorm-build/_lib/scorm-builder/pathway-validators.ts`. Resolves the TIRAP-misclassified-as-CDL bug surfaced in the session log above. Name prefixes ("CS Fiber:", "RC Fiber:", "FS", "agskill", "farming", "optic", "nccer", "osha") now win over `cdl_domain` / `cfr_reference` field-presence checks. Surfaces in the `MIXED_FRAMEWORKS` warning emission and in `manifest.credentialFramework` — multi-Fiber bundles with stray `cdl_domain` rows no longer show false 'CDL/TIRAP mixed framework' warnings, and Fiber courses correctly emit quiz modules (since TIRAP is in the default `knowledgeGateFrameworks` list).

### Clean-baseline tag

`phase-2-v0-baseline-clean` annotated tag at `d447fe4`. One-command revert point if Step 5/6 wiring regresses anything. Toolkit now four commits ahead of `origin/main`: `0b1a460` → `58264bc` → `d447fe4` → `701bf20`.

### Canonical Step 5+6 smoke target

**Primary target:** WO `82352214…` — *RC Site: Flood Damage Assessment* (Roadcraft).

Chosen because:
- Has a valid `fgn_origin_challenge_id` (implicitly validates the `d447fe4` backport — pre-fix this WO would have hit "challenge not found" if its two challenge ids diverged).
- Lovable's clean-baseline runs proved all four destinations green against this WO at toolkit `0b1a460` (equivalent to `d447fe4` modulo the 2-line backport that doesn't touch this code path). Any post-Step-5 regression is therefore attributable to enhance wiring, not router or transform.
- Replacement semantics already exercised — second build returns `isReplacement=true` against the same `courseId`.

**Secondary target (inferFramework regression check):** WO whose challenge name starts with "CS Fiber:" or "RC Fiber:" — e.g. challenge `41ef18d1-f9ae-4ab5-9135-34479b6cfcf3` ("CS Fiber: Conduit Placement and Backfill") from the session log above. Pre-`701bf20` this was misclassified as CDL and the manifest emitted only briefing + completion (no quiz) because CDL is not in `knowledgeGateFrameworks`. Post-`701bf20` it should classify as TIRAP and emit briefing + quiz + completion (3 modules). Verifies the `_lib/` copy of the fix is live.

Note: the primary target ("RC Site:", Roadcraft game) does not start with "rc fiber" so it does not exercise the RC Fiber prefix branch — it's a general functional smoke target, not a precedence-fix regression check. Use both WOs to cover both surfaces.

### Step 5+6 smoke matrix

For each target WO, run four builds and record outcomes:

| `enhanceText` | `enhanceCover` | What it validates |
|---|---|---|
| `false` | `false` | Regression check — must match Lovable's clean baseline exactly (same manifest size, no `aiEnhanced` field, no enhance warnings) |
| `true` | `false` | Step 5 — `aiEnhanced.enhancedFields` includes description, briefingHtml, quizQuestions; manifest text differs from baseline; no asset additions |
| `false` | `true` | Step 6 — `aiEnhanced.enhancedFields` includes coverImage; `cover.png` written to `media-assets/scorm-courses/<id>/assets/`; absolute `cover_image_url` in DB row points to the AI-generated image |
| `true` | `true` | Combined — single `aiEnhanced` stamp listing all four fields; both text and cover update in one call |

Eyeball one Step-6 build's gpt-image-2 cover → kicks off Brand Reviewer pass.

### Resolved ship-gate items

Items implicitly resolved by this addendum (status table above is from session-log time and stays as-is for historical accuracy):

- ✅ **Edge function — other 3 destinations** (was ⚪ untested) — all three smoke-clean at toolkit baseline.
- ✅ **`inferFramework()` TIRAP bug** (was ⏳ toolkit fix) — landed in `701bf20`, mirrored to `_lib/`, awaiting deploy + post-deploy verification on the secondary smoke target.

Three items still open before v0 ships: Steps 5+6 wiring (this section's plan), Brand Reviewer signoff (gated on Step 6), and the post-deploy verification of `701bf20` against a CS Fiber WO.

— End of addendum —
