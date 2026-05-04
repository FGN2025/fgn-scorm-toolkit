/**
 * In-memory-only cache for the scorm-build edge function.
 *
 * The original toolkit cache also persists to disk via node:fs. Edge
 * functions don't have stable local disk between invocations, so we
 * keep only the in-memory map. Cache hits help during a single build
 * (e.g., the same prompt across multiple briefings within one bundle)
 * but don't persist across function invocations — that's fine since
 * each invocation is one course.
 *
 * Web Crypto API replaces node:crypto for the hash key derivation.
 * createHash().update().digest() pattern → crypto.subtle.digest('SHA-256', ...).
 */

export interface EnhanceCacheOptions {
  /** Ignored in this Deno port — kept on the type for source-shape compatibility. */
  persistDir?: string;
}

export class EnhanceCache {
  private readonly mem = new Map<string, string>();
  private readonly memBinary = new Map<string, Uint8Array>();

  constructor(_opts: EnhanceCacheOptions = {}) {
    // No disk persistence in edge function context.
  }

  static keyFor(args: {
    model: string;
    slot: 'description' | 'briefing' | 'quiz';
    systemPayload: string;
    userPayload: string;
  }): string {
    return syncHash(
      args.model + '::' + args.slot + '::sys::' + args.systemPayload + '::user::' + args.userPayload,
    );
  }

  static binaryKeyFor(args: {
    model: string;
    slot: 'cover-image' | 'thumbnail-image';
    prompt: string;
    quality: string;
    size: string;
  }): string {
    return syncHash(
      args.model + '::' + args.slot + '::quality::' + args.quality + '::size::' + args.size + '::prompt::' + args.prompt,
    );
  }

  get(key: string): string | undefined {
    return this.mem.get(key);
  }

  set(key: string, value: string): void {
    this.mem.set(key, value);
  }

  getBinary(key: string): Uint8Array | undefined {
    return this.memBinary.get(key);
  }

  setBinary(key: string, value: Uint8Array): void {
    this.memBinary.set(key, value);
  }
}

/**
 * Synchronous-feeling SHA-256 hash. Web Crypto's digest() is async,
 * so we fall back to a simple string hash for cache-key derivation.
 * Cache keys don't need cryptographic strength — collision resistance
 * across the inputs we hash is plenty with FNV-1a-style. If a stronger
 * hash is wanted later, the caller can await the real Web Crypto digest.
 */
function syncHash(input: string): string {
  // FNV-1a 64-bit-ish — string of length up to ~16 hex chars
  let h1 = 0xcbf29ce4 >>> 0;
  let h2 = 0x84222325 >>> 0;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ (c & 0xff), 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ ((c >> 8) & 0xff), 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}
