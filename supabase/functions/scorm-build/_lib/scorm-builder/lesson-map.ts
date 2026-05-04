/**
 * Awareness of pre-existing fgn.academy lessons that are already curated
 * and tied to specific play.fgn.gg challenges.
 *
 * The hard-coded map below mirrors `CHALLENGE_LESSON_MAP` in
 * stratify-workforce/supabase/functions/sync-challenge-completion/index.ts.
 * When a challenge in this map is included in a SCORM bundle, the
 * publisher should PREFER the existing lesson rather than auto-generate
 * a new one — otherwise learners get duplicate "knowledge check available"
 * notifications on completion.
 *
 * The transformer surfaces an `EXISTING_LESSON_MAPPED` info-level warning
 * for each affected challenge so the admin can decide consciously.
 *
 * IMPORTANT: this is a snapshot. The canonical list lives in fgn.academy.
 * If you add new mappings on fgn.academy, mirror them here OR (better)
 * have the publisher fetch the live map at run time. Drift between this
 * file and the live map is the most likely failure mode for duplicate
 * lessons being generated. Audit periodically.
 */

/**
 * Challenge IDs already wired into the Challenge Enhancer (CE) course
 * on fgn.academy.
 *
 * CE_COURSE_ID = 'dab09852-eeb2-431f-b2f4-b881c6b4aa7f'
 */
export const CHALLENGE_LESSON_MAP: Record<string, string> = {
  // CE-01: CS Fiber — Underground Conduit Systems and Bedding Standards
  '034e8cf3-8832-4c05-a572-67af46dc9971': '2eb52508-7822-429c-b95f-be65d63bfb2d',
  // CE-02: RC Fiber — Aerial Route Assessment and Pole Line Evaluation
  'c8298ef1-d359-4536-958f-533e66f7ee4a': 'e4332a97-b389-4486-a8f0-304185c7dd52',
  // CE-03: CS Fiber — Pre-Construction Safety and 811 Compliance
  '5e9ace81-fcc3-49f9-9013-5321d2e04d56': '529bb1c4-ff45-4641-840c-edce7a97c39b',
  // CE-05: CS Fiber — Directional Bore Planning and HDD Site Operations
  'd8b601c3-ff40-46c6-aa4b-55da7711c8ce': 'fb955601-7957-4d05-a748-fe4c4e64d88d',
  // CE-06 CS: CS Fiber — OSP Handoff
  '57da5f29-5a4e-4148-a738-319e7a33252c': '0e1a2041-ca0b-4c49-8d07-73fe1fd51d1b',
  // CE-06 RC: RC Fiber — Cable Run Documentation
  '4ce440c1-be75-4700-a8fa-4a80f6d1fbde': '0e1a2041-ca0b-4c49-8d07-73fe1fd51d1b',
};

export const CE_COURSE_ID = 'dab09852-eeb2-431f-b2f4-b881c6b4aa7f';

/**
 * Track 3: OSHA Safety Overlay. Special gating logic on fgn.academy —
 * the OSHA Focus Four credential only fires when ALL FOUR challenges
 * complete. Bundles with fewer than these four still work but won't
 * trigger the credential.
 */
export const TRACK3_CHALLENGES: readonly string[] = [
  'bcb4a446-d0b7-4432-bedb-4f7ce42ff557',
  '452f8199-9e08-484c-bf8c-887cb24ad3ce',
  '7c7ae072-81a1-4dac-8307-268266a786e6',
  'd098fcac-09a6-41b3-b196-97b98e4435e1',
];

export const TRACK3_LESSON_ID = 'a1b2c3d4-0003-4000-8000-000000000001';

/**
 * Track 4: Fiber Optics Construction. Per-challenge knowledge gates —
 * each challenge fires its own knowledge check on completion. No bundle-
 * level gating, but admins should be aware of the existing CE lessons
 * (see CHALLENGE_LESSON_MAP) for any of these challenges.
 */
export const TRACK4_CHALLENGES: readonly string[] = [
  '02481a75-383c-485a-bdff-f0a4dd2b9121',
  '1c899b1a-a527-4023-aeb4-43d387993578',
  '260d4700-7f7a-431f-9768-097284293cd6',
  'e18786a7-043f-4900-8a07-c892c36af1b9',
  'ae4c4228-f107-4f31-ae3d-ec819b0b6863',
  '2a7c0a85-8f05-4c15-965b-e94f72f3672f',
  '858d2e0d-6d78-4d7f-8377-0dc40ab269dd',
  '034e8cf3-8832-4c05-a572-67af46dc9971',
  'c8298ef1-d359-4536-958f-533e66f7ee4a',
  '5e9ace81-fcc3-49f9-9013-5321d2e04d56',
  'd8b601c3-ff40-46c6-aa4b-55da7711c8ce',
  '57da5f29-5a4e-4148-a738-319e7a33252c',
  '4ce440c1-be75-4700-a8fa-4a80f6d1fbde',
];

export function isTrack3Challenge(id: string): boolean {
  return TRACK3_CHALLENGES.includes(id);
}

export function isTrack4Challenge(id: string): boolean {
  return TRACK4_CHALLENGES.includes(id);
}

export function existingLessonIdFor(challengeId: string): string | undefined {
  return CHALLENGE_LESSON_MAP[challengeId];
}
