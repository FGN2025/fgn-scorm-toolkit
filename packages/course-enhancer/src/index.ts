/**
 * @fgn/course-enhancer — public API.
 *
 * Primary entry point: `enhanceCourse(course, options)` — additive
 * AI rewrite of a CourseManifest's description, briefing HTML, and
 * quiz questions. Designed to be called between transform() and
 * package() in the SCORM build pipeline.
 *
 * Phase 1.4 v0: Anthropic Claude (claude-opus-4-7) with adaptive
 * thinking, prompt caching, and graceful degradation on per-slot
 * failure. Cover image generation is deferred to Phase 1.4.5.
 */

export { enhanceCourse } from './enhance.js';
export type {
  EnhanceOptions,
  EnhanceResult,
  EnhancedField,
  SlotStat,
} from './enhance.js';

export { EnhanceClient, DEFAULT_MODEL } from './anthropic-client.js';
export type {
  EnhanceClientOptions,
  EffortLevel,
  SystemBlock,
} from './anthropic-client.js';

export { EnhanceCache } from './cache.js';
export type { EnhanceCacheOptions } from './cache.js';
