/**
 * Top-level entry point for the transformer.
 *
 * Takes 1..N play.fgn.gg challenge IDs, fetches them through a
 * ChallengeFetcher, validates the bundle, and produces a CourseManifest
 * + a list of warnings the admin should review.
 */

import type { CourseManifest, CourseWarning, Pillar } from '../course-types.ts';
import type { ScormDestination } from '../brand-tokens.ts';
import type { ChallengeFetcher } from './fetcher.ts';
import { ChallengeNotFoundError } from './fetcher.ts';
import type { FetchedChallenge } from './play-types.ts';
import { buildCourseManifest } from './builder.ts';
import { inferFramework, validateBundle } from './pathway-validators.ts';

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

/**
 * Binary asset to be written alongside the manifest. The CLI writes
 * each `path` (relative to the manifest's directory) and the SCORM
 * packager later picks them up by following relative URLs in the
 * manifest. Phase 1.4.5.1 introduces this for cover-image passthrough;
 * future asset types (thumbnails, media clips) can use the same shape.
 */
export interface TransformAsset {
  /** Relative path, e.g. "assets/cover.png". */
  path: string;
  /** Raw bytes. */
  bytes: Uint8Array;
  /** Mime type, e.g. "image/png". */
  mimeType: string;
}

export interface TransformResult {
  course: CourseManifest;
  warnings: CourseWarning[];
  /**
   * Binary assets the transformer fetched from external sources
   * (currently: existing cover_image_url on the lead challenge).
   * Empty when no assets need to be bundled. The CLI writes each
   * to disk relative to the manifest output path.
   */
  assets: TransformAsset[];
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

  // Phase 1.4.5.1 — default cover passthrough.
  // If the lead challenge has a cover_image_url on play.fgn.gg, fetch
  // the bytes and stamp the manifest's coverImageUrl as a relative
  // ZIP path. The CLI writes the bytes to that path on disk; the
  // packager bundles them into the SCORM ZIP. Failure is non-fatal —
  // the course just ships without a cover, with a warning.
  const assets: TransformAsset[] = [];
  if (course.coverImageRemoteUrl) {
    try {
      const fetched = await fetchCoverImage(course.coverImageRemoteUrl);
      // Derive the on-disk extension from the actual mime type so a
      // JPEG byte-stream doesn't get a misleading .png name. Matters
      // for strict SCORM importers and for code-review cleanliness.
      const ext = extensionForMime(fetched.mimeType);
      const assetPath = `assets/cover.${ext}`;
      assets.push({
        path: assetPath,
        bytes: fetched.bytes,
        mimeType: fetched.mimeType,
      });
      // Mutate the manifest to point at the bundled relative path.
      course.coverImageUrl = assetPath;
    } catch (err) {
      warnings.push({
        level: 'warn',
        code: 'COVER_IMAGE_FETCH_FAILED',
        message: `Failed to fetch existing cover image from ${course.coverImageRemoteUrl}: ${err instanceof Error ? err.message : String(err)}. Course will ship without an embedded cover; coverImageRemoteUrl is preserved on the manifest.`,
      });
    }
  }

  return { course, warnings, assets };
}

/**
 * Pull the bytes for a play.fgn.gg cover image. Public Supabase
 * Storage URL — no auth required. Returns Uint8Array for parity with
 * the rest of the asset pipeline (PackageMedia, EnhanceAsset).
 */
async function fetchCoverImage(
  url: string,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const res = await fetch(url, {
    // No-cache to avoid stale CDN responses if the team updates the
    // image upstream during a single transform session.
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  const mimeType = res.headers.get('content-type') ?? inferMimeFromUrl(url);
  const ab = await res.arrayBuffer();
  return { bytes: new Uint8Array(ab), mimeType };
}

function inferMimeFromUrl(url: string): string {
  const lower = url.toLowerCase().split('?')[0]!;
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.jfif')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  // Default — most of FGN's storage holds JPEGs/PNGs.
  return 'application/octet-stream';
}

/**
 * Map a mime type to the file extension we use on disk. Keep the set
 * narrow — these are the only formats sane SCORM importers support
 * for course icons / cover art.
 */
function extensionForMime(mimeType: string): string {
  switch (mimeType) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    default:
      // Fall back to .png — extension-mismatched bytes still work for
      // most consumers via magic-byte sniffing, and we won't hit this
      // path under normal play.fgn.gg storage.
      return 'png';
  }
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
      message: `${placeholderQuizChallengeIds.length} challenge${placeholderQuizChallengeIds.length === 1 ? '' : 's'} require${placeholderQuizChallengeIds.length === 1 ? 's' : ''} a knowledge-gate quiz. The transformer emitted a single placeholder question per quiz -- replace with real scenario-based questions in the Course Builder before publishing.`,
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
