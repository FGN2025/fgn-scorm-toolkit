/**
 * Packager — turns a CourseManifest + the @fgn/scorm-player runtime +
 * brand assets into a SCORM 1.2 ZIP suitable for upload to any LMS.
 *
 * Pure function: takes inputs as buffers/strings, returns a ZIP buffer.
 * No filesystem access, no network calls. The CLI / test harness loads
 * the player and brand assets from disk and passes them in. The Supabase
 * edge-function wrapper would fetch them from storage and pass them in.
 *
 * ZIP layout:
 *
 *   imsmanifest.xml                              SCORM 1.2 manifest
 *   index.html                                   compiled @fgn/scorm-player
 *   course.json                                  the manifest the player loads at runtime
 *   assets/logo-fgn-wordmark-white.svg           FGN brand logo (Arcade)
 *   assets/logo-fgn-wordmark-ink.svg             FGN brand logo (Enterprise)
 *   media/<filename>                             optional media files (clips, screenshots)
 */

import JSZip from 'https://esm.sh/jszip@3.10.1';
import type { CourseManifest } from '../course-types.ts';
import { generateManifestXml } from './manifest-xml.ts';

export interface PackageMedia {
  /** Filename relative to the package root, e.g. "media/clip-001.mp4". */
  path: string;
  /** File content. Strings are written as UTF-8; Uint8Array is written as binary. */
  content: string | Uint8Array;
}

export interface PackageInput {
  /** The course manifest produced by transform(). */
  course: CourseManifest;
  /** Compiled @fgn/scorm-player single-file HTML output (from `pnpm --filter @fgn/scorm-player build`). */
  playerHtml: string;
  /** Brand logo SVG content. Read from @fgn/brand-tokens/assets/. */
  brandAssets: {
    whiteSvg: string;
    inkSvg: string;
  };
  /** Optional media to bundle (clips, screenshots, images referenced by media modules). */
  media?: PackageMedia[];
  /** Mastery score 0..100 written into the SCORM manifest. Default: 80. */
  masteryScore?: number;
  /**
   * Estimated learning time as ISO 8601 duration. Default: derived from
   * course.modules.length * 8 minutes. Override for accurate reporting.
   */
  typicalLearningTime?: string;
}

export interface PackageResult {
  /** The SCORM 1.2 ZIP as raw bytes. */
  zip: Uint8Array;
  /** The generated imsmanifest.xml content (returned for inspection / debugging). */
  manifestXml: string;
  /** Every file path inside the ZIP (relative to package root). */
  files: string[];
}

export async function packageCourse(input: PackageInput): Promise<PackageResult> {
  validateInput(input);

  const zip = new JSZip();

  // The Player bundle, the runtime entry point of the SCORM package.
  zip.file('index.html', input.playerHtml);

  // The course manifest, loaded by the Player at runtime.
  zip.file('course.json', JSON.stringify(input.course, null, 2));

  // FGN brand logo SVGs. The Player's Wordmark component references
  // these via relative path './assets/logo-fgn-wordmark-{white|ink}.svg'.
  zip.file('assets/logo-fgn-wordmark-white.svg', input.brandAssets.whiteSvg);
  zip.file('assets/logo-fgn-wordmark-ink.svg', input.brandAssets.inkSvg);

  // Optional bundled media.
  for (const m of input.media ?? []) {
    zip.file(m.path, m.content);
  }

  // Build the file list for the manifest. Order doesn't matter for SCORM
  // 1.2 conformance, but we sort for deterministic output (helpful for
  // ZIP hashing / cache keys / diffing).
  const fileList = Object.keys(zip.files)
    .filter((p) => !zip.files[p]!.dir)
    .sort();

  const manifestXml = generateManifestXml({
    course: input.course,
    filePaths: ['imsmanifest.xml', ...fileList],
    ...(input.masteryScore !== undefined ? { masteryScore: input.masteryScore } : {}),
    typicalLearningTime:
      input.typicalLearningTime ?? deriveLearningTime(input.course.modules.length),
  });

  zip.file('imsmanifest.xml', manifestXml);

  const zipBytes = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  return {
    zip: zipBytes,
    manifestXml,
    files: ['imsmanifest.xml', ...fileList],
  };
}

function validateInput(input: PackageInput): void {
  if (!input.course) {
    throw new Error('packageCourse: course is required');
  }
  if (input.course.schemaVersion !== 1) {
    throw new Error(
      `packageCourse: unsupported course.schemaVersion ${input.course.schemaVersion}. The packager handles schemaVersion 1.`,
    );
  }
  if (!input.playerHtml || input.playerHtml.length < 100) {
    throw new Error('packageCourse: playerHtml is required and must be a compiled @fgn/scorm-player bundle');
  }
  if (!input.brandAssets?.whiteSvg || !input.brandAssets?.inkSvg) {
    throw new Error('packageCourse: brandAssets.whiteSvg and brandAssets.inkSvg are required');
  }
}

function deriveLearningTime(moduleCount: number): string {
  // Rough heuristic: 8 minutes per module on average. Min 10 min.
  const minutes = Math.max(10, moduleCount * 8);
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder > 0 ? `PT${hours}H${remainder}M` : `PT${hours}H`;
  }
  return `PT${minutes}M`;
}
