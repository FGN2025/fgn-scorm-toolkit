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
