/**
 * Top-level entry point for the transformer.
 *
 * Takes 1..N play.fgn.gg challenge IDs, fetches them through a
 * ChallengeFetcher, validates the bundle, and produces a CourseManifest
 * + a list of warnings the admin should review.
 */

import type { CourseManifest, CourseWarning, Pillar } from '@fgn/course-types';
import type { ScormDestination } from '@fgn/brand-tokens';
import type { ChallengeFetcher } from './fetcher.js';
import { ChallengeNotFoundError } from './fetcher.js';
import type { FetchedChallenge } from './play-types.js';
import { buildCourseManifest } from './builder.js';
import { inferFramework, validateBundle } from './pathway-validators.js';

export interface TransformInput {
  /** 1..N challenge IDs from play.fgn.gg, in the order they should appear in the course. */
  challengeIds: string[];
  /** Where the export is destined. Drives brand mode + naming. */
  destination: ScormDestination;
  /** SCORM version target. Default: '1.2'. */
  scormVersion?: '1.2' | 'cmi5';
  /** Course title. Default: derived from challenges. */
  title?: string;
  /** Course description. Default: derived from challenges. */
  description?: string;
  /** Bundle ID for the manifest. Default: a deterministic hash of challenge IDs. */
  bundleId?: string;
  /** Pillar accent override. */
  pillar?: Pillar;
  /** Endpoint base URL for the launch-token bridge. */
  launchTokenEndpoint?: string;
  /** Frameworks that require a knowledge-gate quiz. Default: ['OSHA', 'TIRAP', 'OpTIC Path']. */
  knowledgeGateFrameworks?: string[];
}

export interface TransformResult {
  course: CourseManifest;
  warnings: CourseWarning[];
}

export async function transform(
  input: TransformInput,
  fetcher: ChallengeFetcher,
): Promise<TransformResult> {
  if (input.challengeIds.length === 0) {
    throw new Error('transform: at least one challengeId is required');
  }

  // Fetch all challenges in parallel. Errors propagate (unpublished challenge
  // throws ChallengeNotPublishedError; the fetcher returns null for missing).
  const fetched = await Promise.all(
    input.challengeIds.map(async (id) => {
      const f = await fetcher.fetchChallenge(id);
      if (!f) throw new ChallengeNotFoundError(id);
      return f;
    }),
  );

  const warnings = validateBundle(fetched);

  // Surface a placeholder-quiz warning for any auto-generated quiz that
  // needs admin authoring before publish.
  warnings.push(...emitQuizPlaceholderWarnings(fetched, input.knowledgeGateFrameworks));

  const course = buildCourseManifest(fetched, {
    bundleId: input.bundleId ?? deriveBundleId(input.challengeIds),
    title: input.title ?? deriveTitle(fetched),
    ...(input.description !== undefined ? { description: input.description } : {}),
    destination: input.destination,
    scormVersion: input.scormVersion ?? '1.2',
    ...(input.pillar !== undefined ? { pillarOverride: input.pillar } : {}),
    ...(input.launchTokenEndpoint !== undefined
      ? { launchTokenEndpoint: input.launchTokenEndpoint }
      : {}),
    ...(input.knowledgeGateFrameworks !== undefined
      ? { knowledgeGateFrameworks: input.knowledgeGateFrameworks }
      : {}),
  });

  return { course, warnings };
}

function emitQuizPlaceholderWarnings(
  fetched: FetchedChallenge[],
  knowledgeGateFrameworks: string[] = ['OSHA', 'TIRAP', 'OpTIC Path'],
): CourseWarning[] {
  // Re-derive framework per challenge to match builder behavior.
  const placeholderQuizChallengeIds: string[] = [];
  for (const fc of fetched) {
    const framework = inferFramework(fc);
    if (framework && knowledgeGateFrameworks.includes(framework)) {
      placeholderQuizChallengeIds.push(fc.challenge.id);
    }
  }
  if (placeholderQuizChallengeIds.length === 0) return [];
  return [
    {
      level: 'warn',
      code: 'QUIZ_PLACEHOLDER_NEEDS_AUTHORING',
      message: `${placeholderQuizChallengeIds.length} challenge${placeholderQuizChallengeIds.length === 1 ? '' : 's'} require${placeholderQuizChallengeIds.length === 1 ? 's' : ''} a knowledge-gate quiz. The transformer emitted a single placeholder question per quiz — replace with real scenario-based questions in the Course Builder before publishing.`,
      challengeIds: placeholderQuizChallengeIds,
      suggestion:
        'Open each placeholder quiz in the Course Builder, write 5 scenario-based questions per FGN curriculum standards, and set 80% pass threshold (default).',
    },
  ];
}

function deriveBundleId(ids: string[]): string {
  if (ids.length === 1) return `bundle-${ids[0]!.slice(0, 8)}`;
  // Deterministic short hash of joined ids.
  let h = 0;
  const joined = ids.join('|');
  for (let i = 0; i < joined.length; i++) {
    h = (h * 31 + joined.charCodeAt(i)) | 0;
  }
  return `bundle-${(h >>> 0).toString(16).padStart(8, '0')}`;
}

function deriveTitle(fetched: FetchedChallenge[]): string {
  if (fetched.length === 1) return fetched[0]!.challenge.name;
  // Try common prefix (e.g. "CS Fiber") + count.
  const names = fetched.map((f) => f.challenge.name);
  const prefix = commonPrefix(names);
  if (prefix && prefix.length > 3) {
    return `${prefix.replace(/[:\-—]\s*$/, '').trim()} — ${fetched.length} challenges`;
  }
  return `FGN Bundle — ${fetched.length} challenges`;
}

function commonPrefix(strings: string[]): string {
  if (strings.length === 0) return '';
  let prefix = strings[0]!;
  for (let i = 1; i < strings.length; i++) {
    while (strings[i]!.indexOf(prefix) !== 0) {
      prefix = prefix.slice(0, -1);
      if (!prefix) return '';
    }
  }
  return prefix;
}
