/**
 * enhanceCourse — the public entry point.
 *
 * Takes a CourseManifest produced by @fgn/scorm-builder.transform()
 * and returns an enhanced copy with rewritten description, briefing
 * HTML, and quiz questions.
 *
 * Design rules:
 *   1. ADDITIVE. The enhancer never deletes or replaces a field that
 *      it can't successfully regenerate — on per-slot failure we keep
 *      the template-derived original and emit a warning.
 *   2. IDEMPOTENT-ish. Identical input + identical model = identical
 *      output (via the content-hash cache). Re-running on a manifest
 *      that already carries `aiEnhanced` is a no-op unless the input
 *      hash differs.
 *   3. STAMPED. Every enhanced output carries `aiEnhanced.{model,
 *      enhancedAt, inputHash, enhancedFields}` so reviewers and
 *      downstream tooling can tell what happened.
 *   4. GRACEFUL. A missing API key, transport error, or schema
 *      validation failure becomes a warning, not a crash. The function
 *      returns the best manifest it could produce.
 */

import { createHash } from 'node:crypto';
import type {
  BriefingModule,
  ChallengeModule,
  CourseManifest,
  CourseWarning,
  GameTitle,
  QuizModule,
} from '@fgn/course-types';
import {
  EnhanceClient,
  type EnhanceClientOptions,
  type SystemBlock,
} from './anthropic-client.js';
import {
  OpenAIImageClient,
  type OpenAIClientOptions,
  type ImageQuality,
  type ImageSize,
  DEFAULT_IMAGE_QUALITY,
  DEFAULT_IMAGE_SIZE,
} from './openai-client.js';
import { EnhanceCache, type EnhanceCacheOptions } from './cache.js';
import { buildDescriptionPrompt } from './prompts/description.js';
import { buildBriefingPrompt } from './prompts/briefing.js';
import { buildQuizPrompt } from './prompts/quiz.js';
import { buildCoverImagePrompt } from './prompts/cover-image.js';

export type EnhancedField =
  | 'description'
  | 'briefingHtml'
  | 'quizQuestions'
  | 'coverImage';

/**
 * One generated binary asset that the enhancer wants the caller to
 * write to disk alongside course.json. The path is relative to the
 * directory that course.json lives in (e.g. "assets/cover.png").
 *
 * The CLI in @fgn/scorm-builder writes these to disk; the packager
 * later reads them by following relative URLs in the manifest.
 */
export interface EnhanceAsset {
  /** Relative path, e.g. "assets/cover.png". */
  path: string;
  /** Raw bytes ready to write. */
  bytes: Buffer;
  /** Mime type, e.g. "image/png". */
  mimeType: string;
}

export interface EnhanceOptions extends EnhanceClientOptions {
  /**
   * Restrict the pass to a subset of slots. Default: text-only
   * (description, briefingHtml, quizQuestions). The 'coverImage' slot
   * is OFF by default because it requires a separate API key and
   * costs money — opt in explicitly via slots: [..., 'coverImage'].
   */
  slots?: EnhancedField[];
  /** Cache configuration. Default: in-memory only. */
  cache?: EnhanceCacheOptions;
  /** Pre-built cache instance (overrides cache.persistDir). */
  cacheInstance?: EnhanceCache;
  /**
   * If false, skip the API call entirely and return the input
   * unchanged with a warning. Useful for CI dry-runs that need to
   * exercise the rest of the pipeline without spending tokens.
   */
  enabled?: boolean;
  /**
   * Optional snapshotted challenge descriptions, keyed by challenge
   * id, that the prompt builder will weave into the user message. The
   * transformer doesn't preserve the raw description on the
   * BriefingModule so callers wanting richer context pass it through
   * here. Falls back to whatever's already in the briefing HTML.
   */
  challengeDescriptions?: Record<string, string>;

  // -- Image-slot specific options ---------------------------------------
  /** OpenAI client options. Only consulted when 'coverImage' is in slots. */
  openai?: OpenAIClientOptions;
  /**
   * Source game for the briefing's cover image. The transformer maps
   * play.fgn.gg game names to the canonical GameTitle enum; for
   * hand-authored courses the caller can pass it through here.
   */
  game?: GameTitle;
  /** Image quality tier. Default: medium (~$0.04/image on gpt-image-2). */
  imageQuality?: ImageQuality;
  /** Image output size. Default: 1024x1024 square. */
  imageSize?: ImageSize;
  /**
   * Asset path used for the cover image in the manifest + on disk.
   * Default: "assets/cover.png". Override only if you have a
   * collision with another asset.
   */
  coverImageAssetPath?: string;
}

export interface EnhanceResult {
  course: CourseManifest;
  warnings: CourseWarning[];
  /** Per-slot summary of what happened. */
  stats: {
    description: SlotStat;
    briefingHtml: SlotStat;
    quizQuestions: SlotStat;
    coverImage: SlotStat;
  };
  /**
   * Binary assets the enhancer produced (e.g. cover.png) that the
   * caller should write to disk next to course.json. Empty for
   * text-only runs. The CLI writes these via fs.writeFileSync; the
   * packager later picks them up by following relative URLs in the
   * manifest.
   */
  assets: EnhanceAsset[];
}

export interface SlotStat {
  attempted: number;
  succeeded: number;
  cached: number;
  failed: number;
}

/**
 * Default slot set. Note that 'coverImage' is intentionally NOT in
 * this list — image generation requires a separate OpenAI key + costs
 * money + is opt-in. Explicit consent via slots: [..., 'coverImage'].
 */
const DEFAULT_SLOTS: EnhancedField[] = [
  'description',
  'briefingHtml',
  'quizQuestions',
];

const DEFAULT_COVER_IMAGE_PATH = 'assets/cover.png';

export async function enhanceCourse(
  course: CourseManifest,
  opts: EnhanceOptions = {},
): Promise<EnhanceResult> {
  const slots = opts.slots ?? DEFAULT_SLOTS;
  const enabled = opts.enabled ?? true;
  const warnings: CourseWarning[] = [];
  const stats: EnhanceResult['stats'] = {
    description: blankStat(),
    briefingHtml: blankStat(),
    quizQuestions: blankStat(),
    coverImage: blankStat(),
  };
  const assets: EnhanceAsset[] = [];

  if (!enabled) {
    warnings.push({
      level: 'info',
      code: 'ENHANCER_DISABLED',
      message: 'AI enhancement skipped (enabled=false). Returning template-derived course unchanged.',
    });
    return { course, warnings, stats, assets };
  }

  // Anthropic client is needed for any text slot. If only the
  // coverImage slot is requested we skip Anthropic init entirely.
  const needsAnthropic = slots.some(
    (s) => s === 'description' || s === 'briefingHtml' || s === 'quizQuestions',
  );
  let client: EnhanceClient | undefined;
  if (needsAnthropic) {
    try {
      client = new EnhanceClient(opts);
    } catch (err) {
      warnings.push({
        level: 'warn',
        code: 'ENHANCER_INIT_FAILED',
        message: `Failed to initialize Anthropic client: ${stringifyError(err)}. Returning template-derived course.`,
        suggestion: 'Set ANTHROPIC_API_KEY or pass apiKey in options.',
      });
      return { course, warnings, stats, assets };
    }
  }
  // OpenAI client lazily — only when image slot is requested.
  let imageClient: OpenAIImageClient | undefined;
  if (slots.includes('coverImage')) {
    try {
      imageClient = new OpenAIImageClient(opts.openai ?? {});
    } catch (err) {
      warnings.push({
        level: 'warn',
        code: 'ENHANCER_IMAGE_INIT_FAILED',
        message: `Failed to initialize OpenAI image client: ${stringifyError(err)}. Skipping coverImage slot.`,
        suggestion: 'Set OPENAI_API_KEY or pass openai.apiKey in options.',
      });
    }
  }

  const cache =
    opts.cacheInstance
    ?? new EnhanceCache(opts.cache ?? {});

  // Snapshot the input for the inputHash field on aiEnhanced. We hash
  // the canonicalized JSON of the input so any later edit to the
  // template-derived output is detectable.
  const inputHash = createHash('sha256')
    .update(canonicalJson(course))
    .digest('hex');

  // Working copy — we'll mutate per-slot below.
  const draft: CourseManifest = structuredClone(course);
  const enhancedFields: EnhancedField[] = [];

  // ---- Description slot ----
  if (slots.includes('description') && client) {
    stats.description.attempted = 1;
    const result = await runDescriptionSlot({
      client,
      cache,
      course: draft,
      warnings,
    });
    if (result.text !== undefined) {
      draft.description = result.text;
      stats.description.succeeded = 1;
      if (result.fromCache) stats.description.cached = 1;
      if (!enhancedFields.includes('description')) enhancedFields.push('description');
    } else {
      stats.description.failed = 1;
    }
  }

  // ---- Briefing slot — runs once per BriefingModule ----
  if (slots.includes('briefingHtml') && client) {
    const briefings = draft.modules.filter(
      (m): m is BriefingModule => m.type === 'briefing',
    );
    stats.briefingHtml.attempted = briefings.length;
    for (const briefing of briefings) {
      const sibling = findSiblingChallenge(draft, briefing);
      const challengeId = sibling?.challengeId;
      const challengeDescription = challengeId
        ? opts.challengeDescriptions?.[challengeId]
        : undefined;
      const result = await runBriefingSlot({
        client,
        cache,
        course: draft,
        briefing,
        challenge: sibling,
        ...(challengeDescription !== undefined ? { challengeDescription } : {}),
        warnings,
      });
      if (result.html !== undefined) {
        briefing.html = result.html;
        stats.briefingHtml.succeeded += 1;
        if (result.fromCache) stats.briefingHtml.cached += 1;
        if (!enhancedFields.includes('briefingHtml')) enhancedFields.push('briefingHtml');
      } else {
        stats.briefingHtml.failed += 1;
      }
    }
  }

  // ---- Quiz slot — runs once per QuizModule ----
  if (slots.includes('quizQuestions') && client) {
    const quizzes = draft.modules.filter((m): m is QuizModule => m.type === 'quiz');
    stats.quizQuestions.attempted = quizzes.length;
    for (const quiz of quizzes) {
      const sibling = findSiblingChallengeForQuiz(draft, quiz);
      const challengeId = sibling?.challengeId;
      const challengeDescription = challengeId
        ? opts.challengeDescriptions?.[challengeId]
        : undefined;
      const result = await runQuizSlot({
        client,
        cache,
        course: draft,
        quiz,
        challenge: sibling,
        ...(challengeDescription !== undefined ? { challengeDescription } : {}),
        warnings,
      });
      if (result.questions !== undefined) {
        quiz.questions = result.questions;
        stats.quizQuestions.succeeded += 1;
        if (result.fromCache) stats.quizQuestions.cached += 1;
        if (!enhancedFields.includes('quizQuestions')) enhancedFields.push('quizQuestions');
      } else {
        stats.quizQuestions.failed += 1;
      }
    }
  }

  // ---- Cover image slot ----
  // Runs once per course. Uses gpt-image-2 (or override). Bytes go
  // into the returned assets[] array; the manifest is stamped with a
  // relative path (default "assets/cover.png"). The CLI writes the
  // bytes to disk next to course.json; the packager later bundles
  // anything matching that relative path into the SCORM ZIP.
  if (slots.includes('coverImage') && imageClient) {
    stats.coverImage.attempted = 1;
    const result = await runImageSlot({
      client: imageClient,
      cache,
      course: draft,
      game: opts.game,
      quality: opts.imageQuality ?? DEFAULT_IMAGE_QUALITY,
      size: opts.imageSize ?? DEFAULT_IMAGE_SIZE,
      assetPath: opts.coverImageAssetPath ?? DEFAULT_COVER_IMAGE_PATH,
      warnings,
    });
    if (result.asset) {
      assets.push(result.asset);
      draft.coverImageUrl = result.asset.path;
      stats.coverImage.succeeded = 1;
      if (result.fromCache) stats.coverImage.cached = 1;
      if (!enhancedFields.includes('coverImage')) enhancedFields.push('coverImage');
    } else {
      stats.coverImage.failed = 1;
    }
  }

  if (enhancedFields.length > 0) {
    // Use the Anthropic model id if it was loaded; otherwise the
    // image-only run stamps the image model id. This keeps a single
    // string field on aiEnhanced.model meaningful in both cases.
    const stampedModel = client?.model ?? imageClient?.model ?? 'unknown';
    draft.aiEnhanced = {
      model: stampedModel,
      enhancedAt: new Date().toISOString(),
      inputHash,
      enhancedFields,
    };
  } else {
    warnings.push({
      level: 'warn',
      code: 'ENHANCER_NO_OUTPUT',
      message: 'AI enhancement produced no successful slots — returning template-derived course unchanged.',
    });
  }

  return { course: draft, warnings, stats, assets };
}

// -----------------------------------------------------------------
// Per-slot runners. Each catches its own errors → warning.

async function runDescriptionSlot(args: {
  client: EnhanceClient;
  cache: EnhanceCache;
  course: CourseManifest;
  warnings: CourseWarning[];
}): Promise<{ text?: string; fromCache?: boolean }> {
  const { client, cache, course, warnings } = args;
  try {
    const prompt = buildDescriptionPrompt(course);
    const cacheKey = EnhanceCache.keyFor({
      model: client.model,
      slot: 'description',
      systemPayload: joinSystemBlocks(prompt.systemBlocks),
      userPayload: prompt.userMessage,
    });
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return { text: cached, fromCache: true };

    const text = await client.generateText({
      systemBlocks: prompt.systemBlocks,
      userMessage: prompt.userMessage,
      maxTokens: 600,
    });
    const cleaned = stripQuotesAndFences(text);
    if (cleaned.length === 0 || cleaned.length > 600) {
      throw new Error(`Out-of-range output length: ${cleaned.length}`);
    }
    cache.set(cacheKey, cleaned);
    return { text: cleaned, fromCache: false };
  } catch (err) {
    warnings.push({
      level: 'warn',
      code: 'ENHANCER_DESCRIPTION_FAILED',
      message: `Failed to enhance course description: ${stringifyError(err)}. Keeping template description.`,
    });
    return {};
  }
}

async function runBriefingSlot(args: {
  client: EnhanceClient;
  cache: EnhanceCache;
  course: CourseManifest;
  briefing: BriefingModule;
  challenge?: ChallengeModule | undefined;
  challengeDescription?: string;
  warnings: CourseWarning[];
}): Promise<{ html?: string; fromCache?: boolean }> {
  const { client, cache, course, briefing, challenge, challengeDescription, warnings } = args;
  try {
    const prompt = buildBriefingPrompt({
      course,
      briefing,
      challenge,
      ...(challengeDescription !== undefined ? { challengeDescription } : {}),
    });
    const cacheKey = EnhanceCache.keyFor({
      model: client.model,
      slot: 'briefing',
      systemPayload: joinSystemBlocks(prompt.systemBlocks),
      userPayload: prompt.userMessage,
    });
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return { html: cached, fromCache: true };

    const html = await client.generateText({
      systemBlocks: prompt.systemBlocks,
      userMessage: prompt.userMessage,
      maxTokens: 4000,
    });
    const cleaned = stripCodeFences(html);
    validateBriefingHtml(cleaned);
    cache.set(cacheKey, cleaned);
    return { html: cleaned, fromCache: false };
  } catch (err) {
    warnings.push({
      level: 'warn',
      code: 'ENHANCER_BRIEFING_FAILED',
      message: `Failed to enhance briefing "${briefing.title}": ${stringifyError(err)}. Keeping template HTML.`,
      ...(challenge?.challengeId
        ? { challengeIds: [challenge.challengeId] }
        : {}),
    });
    return {};
  }
}

async function runQuizSlot(args: {
  client: EnhanceClient;
  cache: EnhanceCache;
  course: CourseManifest;
  quiz: QuizModule;
  challenge?: ChallengeModule | undefined;
  challengeDescription?: string;
  warnings: CourseWarning[];
}): Promise<{ questions?: QuizModule['questions']; fromCache?: boolean }> {
  const { client, cache, course, quiz, challenge, challengeDescription, warnings } = args;
  try {
    const prompt = buildQuizPrompt({
      course,
      quiz,
      challenge,
      ...(challengeDescription !== undefined ? { challengeDescription } : {}),
    });
    const cacheKey = EnhanceCache.keyFor({
      model: client.model,
      slot: 'quiz',
      systemPayload: joinSystemBlocks(prompt.systemBlocks),
      userPayload: prompt.userMessage,
    });
    const cached = cache.get(cacheKey);
    if (cached !== undefined) {
      const parsed = JSON.parse(cached);
      const validated = prompt.validate(parsed);
      return { questions: validated.questions, fromCache: true };
    }

    const result = await client.generateStructured({
      systemBlocks: prompt.systemBlocks,
      userMessage: prompt.userMessage,
      schema: prompt.schema,
      schemaName: prompt.schemaName,
      validate: prompt.validate,
      maxTokens: 6000,
    });
    cache.set(cacheKey, JSON.stringify(result));
    return { questions: result.questions, fromCache: false };
  } catch (err) {
    warnings.push({
      level: 'warn',
      code: 'ENHANCER_QUIZ_FAILED',
      message: `Failed to enhance quiz "${quiz.title}": ${stringifyError(err)}. Keeping placeholder questions.`,
      ...(challenge?.challengeId
        ? { challengeIds: [challenge.challengeId] }
        : {}),
    });
    return {};
  }
}

async function runImageSlot(args: {
  client: OpenAIImageClient;
  cache: EnhanceCache;
  course: CourseManifest;
  game?: GameTitle | undefined;
  quality: ImageQuality;
  size: ImageSize;
  assetPath: string;
  warnings: CourseWarning[];
}): Promise<{ asset?: EnhanceAsset; fromCache?: boolean }> {
  const { client, cache, course, game, quality, size, assetPath, warnings } = args;
  try {
    // Prefer the explicitly-passed game; otherwise infer from a
    // ChallengeModule on the course (the transformer stamps it
    // there). Falls back to undefined which the prompt builder
    // handles with a generic scene.
    const inferredGame =
      game
      ?? course.modules.find(
        (m): m is ChallengeModule => m.type === 'challenge',
      )?.game
      ?? undefined;

    const prompt = buildCoverImagePrompt(course, inferredGame);
    const cacheKey = EnhanceCache.binaryKeyFor({
      model: client.model,
      slot: 'cover-image',
      prompt: prompt.prompt,
      quality,
      size,
    });

    const cached = cache.getBinary(cacheKey);
    if (cached) {
      return {
        asset: { path: assetPath, bytes: cached, mimeType: 'image/png' },
        fromCache: true,
      };
    }

    const generated = await client.generateImage({
      prompt: prompt.prompt,
      quality,
      size,
    });
    cache.setBinary(cacheKey, generated.bytes);
    return {
      asset: {
        path: assetPath,
        bytes: generated.bytes,
        mimeType: generated.mimeType,
      },
      fromCache: false,
    };
  } catch (err) {
    warnings.push({
      level: 'warn',
      code: 'ENHANCER_IMAGE_FAILED',
      message: `Failed to generate cover image: ${stringifyError(err)}. Course will ship without a cover image.`,
    });
    return {};
  }
}

// -----------------------------------------------------------------
// Helpers

function blankStat(): SlotStat {
  return { attempted: 0, succeeded: 0, cached: 0, failed: 0 };
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Concatenate system blocks into a single string for cache-key
 * derivation. Both text and the cache flag participate, so toggling
 * a block's cache_control breakpoint also invalidates the cache —
 * matches the semantics of the actual API request.
 */
function joinSystemBlocks(blocks: SystemBlock[]): string {
  return blocks
    .map((b) => `[cache=${b.cache ? '1' : '0'}]\n${b.text}`)
    .join('\n---\n');
}

function stripCodeFences(text: string): string {
  // Strip a single leading/trailing ```html...``` fence, common when the
  // model adds one despite instructions.
  const fenced = text.match(/^```(?:html)?\s*([\s\S]*?)\s*```$/);
  if (fenced) return fenced[1]!.trim();
  return text.trim();
}

function stripQuotesAndFences(text: string): string {
  let out = stripCodeFences(text);
  // Trim a single matched pair of surrounding quotes (' or ").
  if (out.length >= 2) {
    const first = out[0]!;
    const last = out[out.length - 1];
    if ((first === '"' || first === "'") && last === first) {
      out = out.slice(1, -1).trim();
    }
  }
  return out;
}

function validateBriefingHtml(html: string): void {
  if (html.length === 0) throw new Error('Empty briefing HTML');
  if (html.length > 8000) throw new Error(`Briefing HTML too long: ${html.length} chars`);
  // Reject obviously-bad content. We don't run a full sanitizer here —
  // that's the player's job — but we catch the most common model errors.
  if (/<script\b/i.test(html) || /<iframe\b/i.test(html)) {
    throw new Error('Briefing HTML contains forbidden tags');
  }
}

function findSiblingChallenge(
  course: CourseManifest,
  briefing: BriefingModule,
): ChallengeModule | undefined {
  // The builder uses an id prefix like c-XXXXXXXX-briefing for each
  // challenge group. The same prefix is on the matching -challenge
  // module if it was emitted (legacy / opt-in).
  const prefix = briefing.id.replace(/-briefing$/, '');
  return course.modules.find(
    (m): m is ChallengeModule => m.type === 'challenge' && m.id.startsWith(prefix),
  );
}

function findSiblingChallengeForQuiz(
  course: CourseManifest,
  quiz: QuizModule,
): ChallengeModule | undefined {
  const prefix = quiz.id.replace(/-quiz$/, '');
  return course.modules.find(
    (m): m is ChallengeModule => m.type === 'challenge' && m.id.startsWith(prefix),
  );
}

/**
 * Stable JSON stringification for hashing. JSON.stringify with sorted
 * keys produces a deterministic output, which is what we want for the
 * inputHash field.
 */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, sortedReplacer);
}

function sortedReplacer(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return value;
}
