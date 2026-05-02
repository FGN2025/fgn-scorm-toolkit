/**
 * @fgn/scorm-builder — public API.
 *
 * Two responsibilities:
 *
 *   1. transform()   challenge IDs → CourseManifest + warnings
 *      Reads from play.fgn.gg via a ChallengeFetcher. Use
 *      createSupabaseFetcher() in production, createFixtureFetcher()
 *      in tests.
 *
 *   2. package()     CourseManifest → SCORM 1.2 ZIP   (Phase 1.3.b — coming next)
 */

export { transform } from './transform.js';
export type { TransformInput, TransformResult } from './transform.js';

export { packageCourse } from './pack.js';
export type { PackageInput, PackageMedia, PackageResult } from './pack.js';

export { generateManifestXml } from './manifest-xml.js';
export type { GenerateManifestInput } from './manifest-xml.js';

export {
  createSupabaseFetcher,
  createFixtureFetcher,
  ChallengeNotPublishedError,
  ChallengeNotFoundError,
} from './fetcher.js';
export type { ChallengeFetcher, SupabaseLike } from './fetcher.js';

export type {
  PlayChallenge,
  PlayChallengeTask,
  PlayGame,
  FetchedChallenge,
} from './play-types.js';

export { validateBundle, inferFramework } from './pathway-validators.js';

export {
  CHALLENGE_LESSON_MAP,
  CE_COURSE_ID,
  TRACK3_CHALLENGES,
  TRACK4_CHALLENGES,
  TRACK3_LESSON_ID,
  isTrack3Challenge,
  isTrack4Challenge,
  existingLessonIdFor,
} from './lesson-map.js';

export { buildCourseManifest } from './builder.js';
export type { BuildOptions } from './builder.js';

export { buildBriefing } from './briefing-templates.js';
export type { BriefingTemplate, BriefingContext } from './briefing-templates.js';
