/**
 * Thin wrapper around the official `openai` SDK for image generation.
 *
 * Phase 1.4.5 v0 uses gpt-image-2 (April 2026 release, state-of-the-art
 * for FGN's purposes). The model accepts a text prompt and returns
 * base64-encoded PNG bytes which we decode into a Buffer for both the
 * disk cache and the SCORM ZIP packager.
 *
 * Type casts route through `unknown` because:
 *   1. The `openai` SDK's published types lag the API; gpt-image-2
 *      was released April 2026 and may not be in the type union yet.
 *   2. The `quality` field on images.generate accepts 'low'|'medium'|'high'
 *      for gpt-image-2, but older SDK types only know about 'standard'|
 *      'hd' (DALL-E 3 leftovers).
 * Runtime shape is what matters; the API endpoint accepts these.
 *
 * Per the project house rules: keep the wrapper thin so future model
 * bumps (gpt-image-3, etc.) are a one-line change here. Callers (the
 * cover-image prompt builder + enhance.ts image slot) never touch the
 * SDK directly.
 */

import OpenAI from 'openai';
import { Buffer } from 'node:buffer';

export type ImageQuality = 'low' | 'medium' | 'high';
export type ImageSize = '1024x1024' | '1024x1536' | '1536x1024';

export interface OpenAIClientOptions {
  /**
   * OpenAI API key. Defaults to OPENAI_API_KEY env var. The SDK reads
   * it automatically; we accept it explicitly so an edge function or
   * test harness can pass it in.
   */
  apiKey?: string;
  /**
   * Image model id. Defaults to `gpt-image-2` per the FGN house default.
   */
  model?: string;
  /**
   * Per-request timeout in ms. Image generation can take 20-60 seconds;
   * we give it a generous wall-clock cap. Defaults to 5 minutes.
   */
  requestTimeoutMs?: number;
}

export const DEFAULT_IMAGE_MODEL = 'gpt-image-2';
export const DEFAULT_IMAGE_TIMEOUT_MS = 5 * 60 * 1000;
export const DEFAULT_IMAGE_QUALITY: ImageQuality = 'medium';
export const DEFAULT_IMAGE_SIZE: ImageSize = '1024x1024';

export interface GenerateImageArgs {
  prompt: string;
  /** Quality tier. 'medium' is the production sweet spot. Default: medium. */
  quality?: ImageQuality;
  /** Output size. Default: 1024x1024 square. */
  size?: ImageSize;
}

export interface GeneratedImage {
  /** Decoded PNG bytes, ready to write to disk or stuff into a ZIP. */
  bytes: Buffer;
  /** Mime type — always 'image/png' for gpt-image-2. */
  mimeType: 'image/png';
}

export class OpenAIImageClient {
  private readonly client: OpenAI;
  readonly model: string;

  constructor(opts: OpenAIClientOptions = {}) {
    this.client = new OpenAI({
      ...(opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
      timeout: opts.requestTimeoutMs ?? DEFAULT_IMAGE_TIMEOUT_MS,
    });
    this.model = opts.model ?? DEFAULT_IMAGE_MODEL;
  }

  /**
   * Generate one image. Returns the decoded PNG bytes — caller is
   * responsible for caching and writing to disk.
   *
   * Throws on transport error, validation failure, or empty response.
   * `enhance.ts` catches the throw and turns it into a CourseWarning.
   */
  async generateImage(args: GenerateImageArgs): Promise<GeneratedImage> {
    // gpt-image-2 returns b64_json by default and rejects the
    // legacy `response_format` parameter (deprecated when the new
    // image models replaced DALL-E). We do NOT send response_format;
    // the response shape is parsed defensively below to handle either
    // `b64_json` (the documented default) or `url` (just in case the
    // API ever flips back).
    const params: Record<string, unknown> = {
      model: this.model,
      prompt: args.prompt,
      n: 1,
      size: args.size ?? DEFAULT_IMAGE_SIZE,
      quality: args.quality ?? DEFAULT_IMAGE_QUALITY,
    };

    // Cast through unknown — the published SDK types may not have
    // caught up to gpt-image-2 + the new quality enum.
    const response = (await (
      this.client.images.generate as unknown as (
        p: Record<string, unknown>,
      ) => Promise<{ data?: Array<{ b64_json?: string; url?: string }> }>
    )(params));

    const first = response.data?.[0];
    if (!first) {
      throw new Error('OpenAI returned an empty data array');
    }

    if (first.b64_json) {
      const bytes = Buffer.from(first.b64_json, 'base64');
      return { bytes, mimeType: 'image/png' };
    }

    // Fallback: API returned a hosted URL. Fetch it and decode.
    // Useful for self-hosted OpenAI-compatible providers that always
    // host generated images, and as belt-and-suspenders against
    // future API flips.
    if (first.url) {
      const fetched = await fetch(first.url);
      if (!fetched.ok) {
        throw new Error(
          `OpenAI returned a hosted URL but the fetch failed: HTTP ${fetched.status}`,
        );
      }
      const arrayBuffer = await fetched.arrayBuffer();
      return { bytes: Buffer.from(arrayBuffer), mimeType: 'image/png' };
    }

    throw new Error('OpenAI returned no b64_json or url');
  }
}
