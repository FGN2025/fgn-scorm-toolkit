#!/usr/bin/env node
/**
 * @fgn/scorm-builder CLI
 *
 * Wraps transform(), packageCourse(), and publishCourse() for local
 * testing and acceptance-gate validation.
 *
 *   fgn-scorm transform <challengeId> [...challengeIds]
 *     --destination <dest>          required: where the export will go
 *     --scorm-version <ver>         default: 1.2
 *     --out <path>                  default: ./course.json
 *     env: FGN_PLAY_SUPABASE_URL, FGN_PLAY_SUPABASE_ANON_KEY
 *
 *   fgn-scorm package <course.json>
 *     --player <path>               required: compiled @fgn/scorm-player index.html
 *     --white-svg <path>            required: arcade-mode logo
 *     --ink-svg <path>              required: enterprise-mode logo
 *     --out <path>                  default: ./course.zip
 *
 *   fgn-scorm export <challengeId> [...challengeIds]
 *     --destination <dest>          required
 *     --player <path>               required
 *     --white-svg <path>            required
 *     --ink-svg <path>              required
 *     --out <path>                  default: ./course.zip
 *     One-shot: transform + package in a single command.
 *
 *   fgn-scorm publish <course.json>
 *     --endpoint <url>              default: https://vfzjfkcwromssjnlrhoo.supabase.co/functions/v1/scorm-publish
 *     --tenant-id <id>              optional, default null (FGN-canonical)
 *     --published <true|false>      default: false (admin reviews first)
 *     --difficulty <level>          beginner | intermediate | advanced (default intermediate)
 *     env: FGN_ACADEMY_APP_KEY (required)
 *     Native fgn.academy publish via the scorm-publish edge function.
 *
 *   fgn-scorm enhance <course.json>
 *     --out <path>                  default: overwrite input
 *     --slots <list>                comma-separated subset of
 *                                   description,briefingHtml,quizQuestions,coverImage
 *                                   (default: text-only — coverImage is
 *                                   opt-in because it costs OpenAI credits)
 *     --cache-dir <path>            optional disk cache for repeated runs
 *                                   (text + binary; safe to delete)
 *     --model <id>                  default: claude-opus-4-7 (text)
 *     --effort <low|medium|high|xhigh|max>  default: API default (high)
 *     --image-model <id>            default: gpt-image-2 (override:
 *                                   gpt-image-1-mini for unverified orgs)
 *     --image-quality <low|medium|high>  default: medium (~$0.04/image on gpt-image-2)
 *     --image-size <1024x1024|1024x1536|1536x1024>  default: 1024x1024
 *     --upload-to-academy           after generating a new cover, upload
 *                                   bytes to fgn.academy media library and
 *                                   stamp coverImageRemoteUrl. Only valid
 *                                   with --slots coverImage. Requires
 *                                   FGN_ACADEMY_APP_KEY.
 *     --dry-run                     skip API calls; emit a warning only
 *     env: ANTHROPIC_API_KEY    (required for text slots unless --dry-run)
 *          OPENAI_API_KEY       (required when --slots includes coverImage)
 *          FGN_ACADEMY_APP_KEY  (required when --upload-to-academy is set)
 *     AI rewrite of course description, briefing HTML, quiz questions,
 *     and (opt-in) cover image via @fgn/course-enhancer. Additive —
 *     failures keep the template-derived content. Binary assets (cover
 *     image PNG) are written next to course.json under assets/.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { transform, type TransformInput } from './transform.js';
import { packageCourse } from './pack.js';
import { createSupabaseFetcher, type SupabaseLike } from './fetcher.js';
import { publishCourse, PublishError } from '@fgn/academy-publisher';
import {
  enhanceCourse,
  type EnhancedField,
  type EffortLevel,
  type ImageQuality,
  type ImageSize,
} from '@fgn/course-enhancer';
import type { ScormDestination } from '@fgn/brand-tokens';
import type { CourseManifest, CourseWarning } from '@fgn/course-types';

interface Args {
  command: string;
  positional: string[];
  flags: Record<string, string>;
}

function parseArgs(argv: string[]): Args {
  const [, , command, ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = rest[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = 'true';
      }
    } else {
      positional.push(a);
    }
  }
  return { command: command ?? '', positional, flags };
}

function require_(flag: string | undefined, name: string): string {
  if (!flag) {
    console.error(`Missing required ${name}`);
    process.exit(2);
  }
  return flag;
}

function ensureDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

/**
 * Detects whether a URL is a relative path that should be resolved
 * against the directory of the manifest. Anything with a scheme
 * (http://, https://, data:, file://) is left alone — the SCORM
 * Player will fetch it at runtime.
 */
function isRelativeAssetUrl(url: string): boolean {
  if (!url) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return false; // has a scheme
  if (url.startsWith('//')) return false; // protocol-relative
  if (url.startsWith('/')) return false; // root-absolute, treated as external
  return true;
}

/**
 * Walks the manifest looking for relative-URL asset references that
 * should be bundled into the SCORM ZIP at the same relative path.
 * Reads bytes from disk, resolved against the directory containing
 * course.json. Currently checks coverImageUrl, thumbnailUrl, and
 * MediaModule.mediaUrl. New asset-bearing fields go here.
 */
function collectManifestAssets(
  course: CourseManifest,
  courseJsonPath: string,
): Array<{ path: string; content: Uint8Array }> {
  const baseDir = dirname(resolve(courseJsonPath));
  const collected = new Map<string, Uint8Array>(); // path → bytes (dedup if multiple fields point to same file)

  const candidates: Array<string | undefined> = [
    course.coverImageUrl,
    course.thumbnailUrl,
    ...course.modules.map((m) =>
      m.type === 'media' ? m.mediaUrl : undefined,
    ),
    ...course.modules.map((m) =>
      m.type === 'media' ? m.posterUrl : undefined,
    ),
  ];

  for (const url of candidates) {
    if (!url || !isRelativeAssetUrl(url)) continue;
    if (collected.has(url)) continue;
    const onDisk = resolve(baseDir, url);
    if (!existsSync(onDisk)) {
      console.warn(
        `[package] WARN  manifest references "${url}" but ${onDisk} does not exist; skipping`,
      );
      continue;
    }
    try {
      collected.set(url, readFileSync(onDisk));
    } catch (err) {
      console.warn(
        `[package] WARN  failed to read "${onDisk}": ${err instanceof Error ? err.message : err}; skipping`,
      );
    }
  }

  return Array.from(collected.entries()).map(([path, content]) => ({
    path,
    content,
  }));
}

function logWarnings(warnings: CourseWarning[]): void {
  if (warnings.length === 0) {
    console.log('No warnings.');
    return;
  }
  console.log(`\n${warnings.length} warning${warnings.length === 1 ? '' : 's'}:\n`);
  for (const w of warnings) {
    const tag = w.level === 'error' ? '[ERROR]' : w.level === 'warn' ? '[WARN] ' : '[INFO] ';
    console.log(`${tag} ${w.code}: ${w.message}`);
    if (w.suggestion) console.log(`        → ${w.suggestion}`);
    if (w.challengeIds) console.log(`        challenges: ${w.challengeIds.join(', ')}`);
    console.log('');
  }
}

async function loadSupabaseClient(): Promise<SupabaseLike> {
  const url = process.env.FGN_PLAY_SUPABASE_URL;
  const key = process.env.FGN_PLAY_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error(
      'Set FGN_PLAY_SUPABASE_URL and FGN_PLAY_SUPABASE_ANON_KEY env vars to point at play.fgn.gg.',
    );
    console.error('Example for the live project (vfzjfkcwromssjnlrhoo is fgn.academy — use yrhwzmkenjgiujhofucx for play.fgn.gg):');
    console.error('  export FGN_PLAY_SUPABASE_URL=https://yrhwzmkenjgiujhofucx.supabase.co');
    console.error('  export FGN_PLAY_SUPABASE_ANON_KEY=<from Supabase dashboard>');
    process.exit(2);
  }
  // Lazy import so the CLI loads quickly when not running transform.
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(url, key) as unknown as SupabaseLike;
}

async function cmdTransform(args: Args): Promise<void> {
  const challengeIds = args.positional;
  if (challengeIds.length === 0) {
    console.error('At least one <challengeId> required');
    process.exit(2);
  }
  const destination = require_(args.flags.destination, '--destination') as ScormDestination;
  const out = args.flags.out ?? './course.json';

  const supabase = await loadSupabaseClient();
  const fetcher = createSupabaseFetcher(supabase);

  const input: TransformInput = {
    challengeIds,
    destination,
    scormVersion: (args.flags['scorm-version'] as '1.2' | 'cmi5' | undefined) ?? '1.2',
    ...(args.flags.title ? { title: args.flags.title } : {}),
    ...(args.flags.description ? { description: args.flags.description } : {}),
  };

  console.log(`Transforming ${challengeIds.length} challenge${challengeIds.length === 1 ? '' : 's'} for ${destination}…`);
  const { course, warnings, assets } = await transform(input, fetcher);

  ensureDir(out);
  writeFileSync(out, JSON.stringify(course, null, 2), 'utf8');
  console.log(`\n✓ Wrote ${out}`);
  console.log(`  ${course.modules.length} modules · brandMode=${course.brandMode} · scorm=${course.scormVersion}`);

  // Phase 1.4.5.1 — write any binary assets (cover image passthrough,
  // future thumbnails, etc.) to disk next to course.json. The
  // packager later picks them up by following relative URLs in the
  // manifest.
  for (const asset of assets) {
    const assetOut = resolve(dirname(out), asset.path);
    ensureDir(assetOut);
    writeFileSync(assetOut, asset.bytes);
    console.log(`✓ Wrote ${assetOut} (${asset.bytes.byteLength} bytes, ${asset.mimeType})`);
  }
  if (course.coverImageUrl) {
    console.log(`Cover image (default): ${course.coverImageUrl}` + (course.coverImageRemoteUrl ? ` ← ${course.coverImageRemoteUrl}` : ''));
  } else if (course.coverImageRemoteUrl) {
    console.log(`Cover image (remote-only): ${course.coverImageRemoteUrl}`);
  }
  logWarnings(warnings);

  const hasError = warnings.some((w) => w.level === 'error');
  if (hasError) process.exit(1);
}

async function cmdPackage(args: Args): Promise<void> {
  const courseJsonPath = args.positional[0];
  if (!courseJsonPath) {
    console.error('Usage: fgn-scorm package <course.json> --player ... --white-svg ... --ink-svg ...');
    process.exit(2);
  }
  const playerPath = require_(args.flags.player, '--player');
  const whiteSvgPath = require_(args.flags['white-svg'], '--white-svg');
  const inkSvgPath = require_(args.flags['ink-svg'], '--ink-svg');
  const out = args.flags.out ?? './course.zip';

  const course = JSON.parse(readFileSync(courseJsonPath, 'utf8')) as CourseManifest;
  const playerHtml = readFileSync(playerPath, 'utf8');
  const whiteSvg = readFileSync(whiteSvgPath, 'utf8');
  const inkSvg = readFileSync(inkSvgPath, 'utf8');

  // Pick up any binary assets the manifest references via relative
  // paths (e.g. assets/cover.png produced by `fgn-scorm enhance
  // --slots coverImage`). Resolved relative to course.json.
  const manifestAssets = collectManifestAssets(course, courseJsonPath);

  console.log(`Packaging ${course.title} (${course.modules.length} modules) → ${out}`);
  if (manifestAssets.length > 0) {
    console.log(`  bundling ${manifestAssets.length} manifest asset${manifestAssets.length === 1 ? '' : 's'}:`);
    for (const a of manifestAssets) console.log(`    + ${a.path} (${a.content.byteLength} bytes)`);
  }

  const result = await packageCourse({
    course,
    playerHtml,
    brandAssets: { whiteSvg, inkSvg },
    media: manifestAssets,
  });

  ensureDir(out);
  writeFileSync(out, result.zip);
  console.log(`\n✓ Wrote ${out} (${result.zip.byteLength} bytes)`);
  console.log(`  Files in ZIP: ${result.files.length}`);
  for (const f of result.files) console.log(`   - ${f}`);
  console.log(`\nValidate at https://cloud.scorm.com/sc/guest/SignInForm`);
}

async function cmdExport(args: Args): Promise<void> {
  const challengeIds = args.positional;
  if (challengeIds.length === 0) {
    console.error('At least one <challengeId> required');
    process.exit(2);
  }
  const destination = require_(args.flags.destination, '--destination') as ScormDestination;
  const playerPath = require_(args.flags.player, '--player');
  const whiteSvgPath = require_(args.flags['white-svg'], '--white-svg');
  const inkSvgPath = require_(args.flags['ink-svg'], '--ink-svg');
  const out = args.flags.out ?? './course.zip';

  const supabase = await loadSupabaseClient();
  const fetcher = createSupabaseFetcher(supabase);

  console.log(`Transforming ${challengeIds.length} challenge${challengeIds.length === 1 ? '' : 's'}…`);
  const { course, warnings, assets } = await transform(
    {
      challengeIds,
      destination,
      scormVersion: (args.flags['scorm-version'] as '1.2' | 'cmi5' | undefined) ?? '1.2',
      ...(args.flags.title ? { title: args.flags.title } : {}),
    },
    fetcher,
  );

  logWarnings(warnings);
  if (warnings.some((w) => w.level === 'error')) {
    console.error('Export blocked by error-level warnings.');
    process.exit(1);
  }

  console.log(`\nPackaging…`);
  const playerHtml = readFileSync(playerPath, 'utf8');
  const whiteSvg = readFileSync(whiteSvgPath, 'utf8');
  const inkSvg = readFileSync(inkSvgPath, 'utf8');

  // Phase 1.4.5.1 — pass transform-returned assets straight through to
  // the packager as media. cmdExport is a one-shot path that doesn't
  // touch disk between transform and package, so we route bytes
  // in-memory rather than via the assets/ directory the way cmdPackage
  // does.
  const exportMedia = assets.map((a) => ({ path: a.path, content: a.bytes }));

  const result = await packageCourse({
    course,
    playerHtml,
    brandAssets: { whiteSvg, inkSvg },
    media: exportMedia,
  });

  ensureDir(out);
  writeFileSync(out, result.zip);
  console.log(`\n✓ Wrote ${out} (${result.zip.byteLength} bytes, ${result.files.length} files)`);
  if (course.coverImageUrl) {
    console.log(`Cover image bundled: ${course.coverImageUrl}` + (course.coverImageRemoteUrl ? ` ← ${course.coverImageRemoteUrl}` : ''));
  }
  console.log(`\nValidate at https://cloud.scorm.com/sc/guest/SignInForm`);
}

async function cmdPublish(args: Args): Promise<void> {
  const courseJsonPath = args.positional[0];
  if (!courseJsonPath) {
    console.error('Usage: fgn-scorm publish <course.json> [--endpoint URL] [--tenant-id ID] [--published true|false] [--difficulty LEVEL]');
    process.exit(2);
  }
  const appKey = process.env.FGN_ACADEMY_APP_KEY;
  if (!appKey) {
    console.error('FGN_ACADEMY_APP_KEY env var is required. Provision via the SQL function on fgn.academy and set it.');
    process.exit(2);
  }

  const course = JSON.parse(readFileSync(courseJsonPath, 'utf8')) as CourseManifest;

  console.log(`Publishing "${course.title}" to fgn.academy native (${course.modules.length} modules)…`);

  const isPublished = args.flags.published === 'true';
  const difficulty = (args.flags.difficulty as 'beginner' | 'intermediate' | 'advanced' | undefined);

  try {
    const result = await publishCourse(course, {
      appKey,
      ...(args.flags.endpoint ? { endpoint: args.flags.endpoint } : {}),
      tenantId: args.flags['tenant-id'] ?? null,
      isPublished,
      ...(difficulty ? { difficultyLevel: difficulty } : {}),
    });

    console.log(`\n✓ Published`);
    console.log(`  courseId:  ${result.courseId}`);
    console.log(`  modules:   ${result.moduleIds.length}`);
    console.log(`  lessons:   ${result.lessonIds.length}`);
    if (result.warnings.length > 0) {
      console.log('');
      logWarnings(result.warnings);
    } else {
      console.log('  warnings:  none');
    }
    console.log(`\nReview at https://fgn.academy (course ID ${result.courseId})`);
    console.log(`Course is ${isPublished ? 'PUBLISHED' : 'DRAFT — flip is_published=true after admin review'}`);
  } catch (err) {
    if (err instanceof PublishError) {
      console.error(`\nPublish failed (${err.status}): ${err.message}`);
      console.error('Response body:', JSON.stringify(err.body, null, 2));
    } else {
      console.error('\nPublish failed:', err);
    }
    process.exit(1);
  }
}

async function cmdEnhance(args: Args): Promise<void> {
  const courseJsonPath = args.positional[0];
  if (!courseJsonPath) {
    console.error(
      'Usage: fgn-scorm enhance <course.json> [--out PATH] [--slots a,b,c] [--cache-dir DIR] [--model ID] [--effort LEVEL] [--image-model ID] [--image-quality LEVEL] [--image-size WxH] [--upload-to-academy] [--dry-run]',
    );
    process.exit(2);
  }
  const dryRun = args.flags['dry-run'] === 'true';
  const out = args.flags.out ?? courseJsonPath;
  const cacheDir = args.flags['cache-dir'];
  const model = args.flags.model;
  const effort = args.flags.effort as EffortLevel | undefined;
  const imageQuality = args.flags['image-quality'] as ImageQuality | undefined;
  const imageSize = args.flags['image-size'] as ImageSize | undefined;
  const imageModel = args.flags['image-model'];
  const uploadToAcademy = args.flags['upload-to-academy'] === 'true';
  const slotList = args.flags.slots;
  const slots: EnhancedField[] | undefined = slotList
    ? slotList
        .split(',')
        .map((s) => s.trim())
        .filter((s): s is EnhancedField =>
          s === 'description'
          || s === 'briefingHtml'
          || s === 'quizQuestions'
          || s === 'coverImage',
        )
    : undefined;

  // Determine which API keys we need based on the requested slots.
  // Default slots are text-only; coverImage is opt-in.
  const requestedSlots = slots ?? ['description', 'briefingHtml', 'quizQuestions'];
  const needsAnthropic = requestedSlots.some(
    (s) => s !== 'coverImage',
  );
  const needsOpenAI = requestedSlots.includes('coverImage');

  if (!dryRun && needsAnthropic && !process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY env var is required for text slots (use --dry-run or limit --slots to coverImage to skip).');
    process.exit(2);
  }
  if (!dryRun && needsOpenAI && !process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY env var is required when --slots includes coverImage.');
    process.exit(2);
  }
  if (!dryRun && uploadToAcademy && !needsOpenAI) {
    console.error(
      '--upload-to-academy only applies when generating a new cover (--slots coverImage). The default-passthrough flow keeps the original play.fgn.gg cover URL on coverImageRemoteUrl already.',
    );
    process.exit(2);
  }
  if (!dryRun && uploadToAcademy && !process.env.FGN_ACADEMY_APP_KEY) {
    console.error('FGN_ACADEMY_APP_KEY env var is required when --upload-to-academy is set.');
    process.exit(2);
  }

  const course = JSON.parse(readFileSync(courseJsonPath, 'utf8')) as CourseManifest;

  console.log(`Enhancing "${course.title}" (${course.modules.length} modules)…`);
  if (dryRun) console.log('  [dry-run: skipping API calls]');

  const result = await enhanceCourse(course, {
    enabled: !dryRun,
    ...(slots !== undefined ? { slots } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(effort !== undefined ? { effort } : {}),
    ...(imageQuality !== undefined ? { imageQuality } : {}),
    ...(imageSize !== undefined ? { imageSize } : {}),
    ...(imageModel !== undefined ? { openai: { model: imageModel } } : {}),
    ...(uploadToAcademy ? { uploadToAcademy: true } : {}),
    cache: {
      ...(cacheDir !== undefined ? { persistDir: cacheDir } : {}),
    },
  });

  ensureDir(out);
  writeFileSync(out, JSON.stringify(result.course, null, 2), 'utf8');
  console.log(`\n✓ Wrote ${out}`);

  // Write any binary assets (cover.png, etc.) to disk next to the
  // manifest. The packager later picks them up by following relative
  // URLs in the manifest.
  for (const asset of result.assets) {
    const assetOut = resolve(dirname(out), asset.path);
    ensureDir(assetOut);
    writeFileSync(assetOut, asset.bytes);
    console.log(`✓ Wrote ${assetOut} (${asset.bytes.byteLength} bytes, ${asset.mimeType})`);
  }

  console.log('\nSlot stats:');
  for (const [name, stat] of Object.entries(result.stats)) {
    console.log(
      `  ${name.padEnd(16)} attempted=${stat.attempted} ok=${stat.succeeded} cached=${stat.cached} failed=${stat.failed}`,
    );
  }
  if (result.course.aiEnhanced) {
    console.log(
      `\nStamped aiEnhanced: model=${result.course.aiEnhanced.model} fields=[${result.course.aiEnhanced.enhancedFields.join(', ')}]`,
    );
  }
  if (result.course.coverImageUrl) {
    console.log(`Cover image: ${result.course.coverImageUrl}`);
  }
  if (result.course.coverImageRemoteUrl) {
    console.log(`Cover image (remote): ${result.course.coverImageRemoteUrl}`);
  }
  logWarnings(result.warnings);

  const hasError = result.warnings.some((w) => w.level === 'error');
  if (hasError) process.exit(1);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  switch (args.command) {
    case 'transform':
      await cmdTransform(args);
      break;
    case 'package':
      await cmdPackage(args);
      break;
    case 'export':
      await cmdExport(args);
      break;
    case 'publish':
      await cmdPublish(args);
      break;
    case 'enhance':
      await cmdEnhance(args);
      break;
    case '':
    case 'help':
    case '--help':
    case '-h':
      console.log(`fgn-scorm — FGN SCORM toolkit CLI

Commands:
  transform <challengeId>...   Read play.fgn.gg challenges → write course.json
  package <course.json>        Bundle a course.json + player + brand → SCORM ZIP
  export <challengeId>...      One-shot: transform + package
  publish <course.json>        Publish a course.json to fgn.academy native rows
                               via the scorm-publish edge function (no service
                               role key required client-side)
  enhance <course.json>        AI-rewrite course description, briefing HTML,
                               and quiz questions via @fgn/course-enhancer.
                               Opt-in --slots coverImage adds a generated
                               cover.png next to course.json (gpt-image-2).
                               Add --upload-to-academy to also push the new
                               cover to fgn.academy's media library.
                               Requires ANTHROPIC_API_KEY for text slots,
                               OPENAI_API_KEY for the coverImage slot,
                               FGN_ACADEMY_APP_KEY for upload (unless --dry-run).

See \`fgn-scorm <command> --help\` for command flags.`);
      break;
    default:
      console.error(`Unknown command: ${args.command}`);
      process.exit(2);
  }
}

void main();
