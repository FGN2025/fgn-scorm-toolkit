/**
 * Pathway and bundle validators.
 *
 * Inspect the set of challenges going into a course and emit warnings
 * for things the admin should be aware of:
 *
 *   - Track 3 OSHA Focus Four: bundle includes some but not all 4 →
 *     learners will not earn the OSHA credential until the missing
 *     challenges complete. Admin can proceed (the bundle still works)
 *     OR add the missing challenges.
 *
 *   - Track 4 Fiber: bundle includes a challenge that's already
 *     mapped to an existing CE course lesson → recommend reusing
 *     the existing lesson rather than auto-generating a duplicate.
 *
 *   - Mixed games: bundle spans multiple games. Not an error, but the
 *     admin should confirm this is intentional (e.g. cross-game
 *     curriculum vs accidental pairing).
 *
 *   - Mixed credential frameworks: similarly, multiple frameworks in one
 *     bundle is a yellow flag.
 *
 * All warnings are advisory. The transformer never fails on warning-level
 * issues — admins can proceed past any warning. error-level issues
 * (unpublished challenges, missing data) come from the fetcher layer.
 */

import type { CourseWarning } from '@fgn/course-types';
import type { FetchedChallenge } from './play-types.js';
import {
  CE_COURSE_ID,
  TRACK3_CHALLENGES,
  TRACK4_CHALLENGES,
  existingLessonIdFor,
  isTrack3Challenge,
  isTrack4Challenge,
} from './lesson-map.js';

export function validateBundle(challenges: FetchedChallenge[]): CourseWarning[] {
  const warnings: CourseWarning[] = [];
  const ids = challenges.map((c) => c.challenge.id);

  warnings.push(...validateTrack3FocusFour(ids));
  warnings.push(...validateTrack4ExistingLessons(ids));
  warnings.push(...validateMixedGames(challenges));
  warnings.push(...validateMixedFrameworks(challenges));

  return warnings;
}

function validateTrack3FocusFour(ids: string[]): CourseWarning[] {
  const includedTrack3 = ids.filter(isTrack3Challenge);
  if (includedTrack3.length === 0) return [];
  if (includedTrack3.length === TRACK3_CHALLENGES.length) {
    return [
      {
        level: 'info',
        code: 'OSHA_FOCUS_FOUR_COMPLETE',
        message:
          'This bundle includes all 4 OSHA Focus Four challenges. Learners who complete the bundle will earn the OSHA Safety Overlay credential.',
        challengeIds: includedTrack3,
      },
    ];
  }
  const missing = TRACK3_CHALLENGES.filter((c) => !ids.includes(c));
  return [
    {
      level: 'warn',
      code: 'OSHA_FOCUS_FOUR_INCOMPLETE',
      message: `This bundle includes ${includedTrack3.length} of 4 OSHA Focus Four challenges. The OSHA Safety Overlay credential will NOT be issued until learners complete the missing ${missing.length}.`,
      challengeIds: includedTrack3,
      suggestion: `Add the missing ${missing.length} challenge${missing.length === 1 ? '' : 's'} to enable the credential gate, or proceed knowing learners must complete the rest separately on play.fgn.gg / fgn.academy to earn the credential.`,
    },
  ];
}

function validateTrack4ExistingLessons(ids: string[]): CourseWarning[] {
  const warnings: CourseWarning[] = [];
  const mappedIds: string[] = [];
  for (const id of ids) {
    if (!isTrack4Challenge(id)) continue;
    const existingLesson = existingLessonIdFor(id);
    if (existingLesson) {
      mappedIds.push(id);
    }
  }
  if (mappedIds.length > 0) {
    warnings.push({
      level: 'info',
      code: 'EXISTING_LESSON_MAPPED',
      message: `${mappedIds.length} challenge${mappedIds.length === 1 ? ' is' : 's are'} already mapped to existing fgn.academy Challenge Enhancer lessons (course ${CE_COURSE_ID}). When publishing to fgn.academy native, the publisher will reuse the existing lesson rather than create a duplicate.`,
      challengeIds: mappedIds,
      suggestion:
        'No action required for SCORM exports. For fgn.academy native publishes, confirm the existing CE course is the right home for these challenges.',
    });
  }
  return warnings;
}

function validateMixedGames(challenges: FetchedChallenge[]): CourseWarning[] {
  const games = new Set(challenges.map((c) => c.game?.name).filter((n): n is string => !!n));
  if (games.size <= 1) return [];
  return [
    {
      level: 'info',
      code: 'MIXED_GAMES',
      message: `This bundle spans ${games.size} different games (${Array.from(games).join(', ')}). Confirm the admin intent — cross-game curricula are valid (e.g. CDL pathway combining ATS + Mechanic_Sim) but accidental pairings are easy to ship.`,
      suggestion:
        'Verify the bundle title and description reflect the multi-game scope. Use the canonical game enum so fgn.academy classifies correctly.',
    },
  ];
}

function validateMixedFrameworks(challenges: FetchedChallenge[]): CourseWarning[] {
  const frameworks = new Set<string>();
  for (const c of challenges) {
    const fw = inferFramework(c);
    if (fw) frameworks.add(fw);
  }
  if (frameworks.size <= 1) return [];
  return [
    {
      level: 'info',
      code: 'MIXED_FRAMEWORKS',
      message: `This bundle spans ${frameworks.size} credential frameworks (${Array.from(frameworks).join(', ')}). The course can still be published, but credential issuance will follow each challenge's own framework — the bundle does not aggregate into a single credential by default.`,
    },
  ];
}

/**
 * Best-effort framework inference from challenge metadata. play.fgn.gg
 * doesn't have an explicit credential_framework column — it's encoded
 * in `cdl_domain`, `cfr_reference`, `certification_description`, and
 * the challenge name (e.g. "CS Fiber:" prefix → TIRAP).
 */
export function inferFramework(c: FetchedChallenge): string | undefined {
  const name = c.challenge.name.toLowerCase();
  // Explicit name prefixes are strong intentional signals and take
  // precedence over generic field-presence checks. cdl_domain can
  // appear as residual cross-tagged metadata on Fiber challenges, so
  // checking it first misclassifies "CS Fiber:" as CDL.
  if (name.startsWith('cs fiber') || name.startsWith('rc fiber')) return 'TIRAP';
  if (name.startsWith('fs') || name.includes('agskill') || name.includes('farming')) return 'USDA';
  if (name.includes('optic')) return 'OpTIC Path';
  if (name.includes('nccer')) return 'NCCER';
  if (name.includes('osha')) return 'OSHA';
  if (c.challenge.cdl_domain) return 'CDL';
  if (c.challenge.cfr_reference) return 'OSHA';
  return undefined;
}
