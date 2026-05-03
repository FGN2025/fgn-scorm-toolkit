# Phase 1.4.5 — Corpus Review

**Goal:** validate the AI enhancement pipeline (text + cover image) against a representative slice of the real FGN catalog before building more on top of it.

We've validated on 2 fixtures so far, both Construction Simulator Gold Challenge variants. We have **no data** on quality for ATS, Farming Sim, Mechanic Sim, Roadcraft, or Fiber Tech. This review closes that gap.

## Slice — one challenge per game

Run the toolkit (transform → enhance with all 4 slots) against one published challenge per supported game. IDs pulled from play.fgn.gg's `challenges` table on 2026-05-03:

| Game | Challenge ID | Name | Status |
|---|---|---|---|
| Construction_Sim | `ff3ea57d-9e4a-48ae-b3ab-f261ac183ffe` | CS Gold Challenge — Uncommon Rarity | ✅ Already validated |
| ATS | `558f290c-ea41-4e2f-8fb6-1c3c1c36e341` | ATS Gold Challenge — Uncommon Rarity | Pending |
| Farming_Sim | `7ed705a0-1765-46f7-95c0-46fa9875bab8` | FS25 Gold Challenge — Uncommon Rarity | Pending |
| Roadcraft | `48b739d9-a8bb-47d3-9b8f-722861f9cc86` | RC Site: Flood Damage Assessment and Priority Triage | Pending |
| Roadcraft (optional, Fiber recovery scene) | `e18786a7-043f-4900-8a07-c892c36af1b9` | RC Fiber: Site Assessment and Route Survey | Pending |
| Mechanic_Sim | — | No active challenges on play.fgn.gg yet | ⏸ Skip until catalog lands |
| Fiber_Tech (OpTIC Path) | — | **Lives on broadbandworkforce.com, not play.fgn.gg.** No play.fgn.gg challenges feed this directly. | ⏸ Architecture-level — see note below |

### Note on fiber-aligned content

OpTIC Path / Fiber Tech is a separate broadbandworkforce.com curriculum. It does NOT have its own simulation game on play.fgn.gg. Instead, the FGN team curates fiber-relevant challenges inside Construction Simulator and Roadcraft, marked by name prefix:

- `CS Fiber: <name>` — Construction Simulator challenge, curated for fiber-construction relevance
- `RC Fiber: <name>` — Roadcraft challenge, curated for fiber-emergency-recovery relevance

This is a **continuous curatorial judgment** — which sim tasks actually align with real fiber trade skills — and is content work, not toolkit work.

**Toolkit gap surfaced by this:** the cover-image prompt currently picks per `GameTitle` (CS or RC), so a `RC Fiber:` challenge gets a post-disaster recovery scene, not a fiber-context scene. This is a bug to address in prompt v5 (name-prefix detection → fiber scene override) and in Phase 2 admin UI (`cover_image_prompt` per-challenge override).

The **`e18786a7-...` Roadcraft Fiber row** in the slice above will visually demonstrate this drift — that's the value of including it in the corpus review.

## How to run for each challenge

Make sure your `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `FGN_PLAY_SUPABASE_URL`, and `FGN_PLAY_SUPABASE_ANON_KEY` are set in the current PowerShell session. The `set-keys.ps1` helper handles the AI keys.

For each challenge:

```powershell
$id = "<challenge-id>"
$slug = ($id -split '-')[0]   # short hash for naming

# 1. Transform: pull from play.fgn.gg, write course.json
node packages\scorm-builder\dist\cli.js transform $id `
  --destination fgn-academy `
  --out ".\acceptance\corpus\$slug\course.json"

# 2. Enhance: text + cover image, full pipeline
node packages\scorm-builder\dist\cli.js enhance `
  ".\acceptance\corpus\$slug\course.json" `
  --out ".\acceptance\corpus\$slug\course.enhanced.json" `
  --slots description,briefingHtml,quizQuestions,coverImage `
  --image-quality medium `
  --image-size 1536x1024 `
  --cache-dir .\.enhancer-cache
```

Total cost per challenge: ~$0.10 (text) + $0.04 (image) = **~$0.14**. Five new challenges = **~$0.70**.

## Review template

For each challenge, fill in the table below. Mark each slot:
- ✅ — production-quality, ship it
- ⚠️ — usable but needs prompt tightening
- ❌ — broken, prompt needs significant rework

### Challenge: Construction_Sim — `ff3ea57d` (already validated)

| Slot | Verdict | Notes |
|---|---|---|
| Description | ✅ | Validated Phase 1.4.5 |
| Briefing HTML | ✅ | Validated Phase 1.4.5 |
| Quiz questions | n/a | No quiz module on this challenge |
| Cover image | ✅ | v4 photoreal prompt, golden-hour excavator with worker in PPE |

### Challenge: ATS — `<paste id>`

| Slot | Verdict | Notes |
|---|---|---|
| Description | | |
| Briefing HTML | | |
| Quiz questions | | |
| Cover image | | |

### Challenge: Farming_Sim — `<paste id>`

| Slot | Verdict | Notes |
|---|---|---|
| Description | | |
| Briefing HTML | | |
| Quiz questions | | |
| Cover image | | |

### Challenge: Mechanic_Sim — `<paste id>`

| Slot | Verdict | Notes |
|---|---|---|
| Description | | |
| Briefing HTML | | |
| Quiz questions | | |
| Cover image | | |

### Challenge: Roadcraft — `<paste id>`

| Slot | Verdict | Notes |
|---|---|---|
| Description | | |
| Briefing HTML | | |
| Quiz questions | | |
| Cover image | | |

### Challenge: Fiber_Tech — `<paste id>`

| Slot | Verdict | Notes |
|---|---|---|
| Description | | |
| Briefing HTML | | |
| Quiz questions | | |
| Cover image | | |

## Aggregate findings

After all 6 are reviewed, summarize the recurring patterns here:

### Cover image issues (per-game and cross-cutting)

- _e.g., FS25 cover lost the GPS HUD overlay despite the prompt allowing it_
- _e.g., Roadcraft cover read as "post-apocalyptic" rather than "infrastructure recovery"_

### Briefing HTML issues

- _e.g., past-tense framing slipped on Mechanic_Sim because the challenge tasks are written as future-tense imperatives_

### Quiz issues

- _e.g., Fiber Tech quiz invented a TIA-568 sub-clause that doesn't exist_

### Description issues

- _e.g., descriptions for Roadcraft consistently exceed the 280-char target_

## Punch list for prompt v5 / scene-library v2

Based on findings above, what to change in `packages/course-enhancer/src/prompts/`:

### Already known (pre-loaded from earlier conversation)

- [ ] **Add name-prefix detection** — `CS Fiber:` → fiber-construction scene (utility poles, conduit, splicing equipment in a CS-construction worksite context); `RC Fiber:` → fiber-emergency-recovery scene (downed cables, restoration work in storm-cleared landscape with fiber infrastructure focus). Affects `buildCoverImagePrompt` in `cover-image.ts`.
- [ ] **Read `cover_image_prompt` field from the challenge row** if populated — per-challenge admin override beats game default. Requires update to `transform.ts` to plumb the field through, and `enhance.ts` to honor it.
- [ ] **Drop or rework the `Fiber_Tech` GameTitle** — there is no Fiber_Tech sim on play.fgn.gg. The enum entry is currently a misnomer. Options: (a) keep as a virtual scene routed only via name-prefix, (b) rename to `OpTIC_Path` and reserve for hand-authored broadbandworkforce.com content.

### To be discovered during the corpus review

- [ ] _Specific edit from FS25 review_
- [ ] _Specific edit from ATS review_
- [ ] _Specific edit from Roadcraft review_

## What this review does NOT block

- Phase 1.4.6 (server-side cover upload) can proceed in parallel — its design doesn't depend on prompt quality.
- Phase 2 design discussions can reference these findings for "what does the admin UI need to surface."
