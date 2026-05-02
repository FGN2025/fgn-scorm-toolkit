/**
 * Content-hash cache — keyed by sha256 of (model, prompt slot, payload).
 *
 * Why not just rely on Anthropic's prompt cache? Two reasons:
 *   1. Repeated identical exports during dev (re-run the CLI on the same
 *      course.json) shouldn't pay the API round-trip at all.
 *   2. Validation failures should retry the API call without retrying
 *      already-good cached responses for sibling slots.
 *
 * Storage is in-memory + optional disk persistence via opts.persistDir.
 * Disk format: one .json file per cache key under persistDir/. Lets the
 * CLI cache survive across runs without standing up a database.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface EnhanceCacheOptions {
  /**
   * Directory to persist cached entries to. Each entry is a small JSON
   * file. Pass undefined to use in-memory only (e.g. inside an edge
   * function with ephemeral fs).
   */
  persistDir?: string;
}

export class EnhanceCache {
  private readonly mem = new Map<string, string>();
  private readonly persistDir: string | undefined;

  constructor(opts: EnhanceCacheOptions = {}) {
    this.persistDir = opts.persistDir;
    if (this.persistDir && !existsSync(this.persistDir)) {
      mkdirSync(this.persistDir, { recursive: true });
    }
  }

  /**
   * Compute the deterministic cache key for a slot. The slot label is
   * part of the key so accidentally hashing the same payload under
   * different prompts can't collide.
   *
   * `systemPayload` MUST include all system blocks (style guide,
   * framework reference, etc.) — otherwise tightening the system
   * prompt without changing the user message returns stale cached
   * answers. `userPayload` is the per-call user message.
   */
  static keyFor(args: {
    model: string;
    slot: 'description' | 'briefing' | 'quiz';
    systemPayload: string;
    userPayload: string;
  }): string {
    return createHash('sha256')
      .update(args.model)
      .update('::')
      .update(args.slot)
      .update('::sys::')
      .update(args.systemPayload)
      .update('::user::')
      .update(args.userPayload)
      .digest('hex');
  }

  /** Get a cached response. Falls back to disk if not in memory. */
  get(key: string): string | undefined {
    const memHit = this.mem.get(key);
    if (memHit !== undefined) return memHit;
    if (!this.persistDir) return undefined;
    const path = join(this.persistDir, `${key}.json`);
    if (!existsSync(path)) return undefined;
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as { value?: string };
      if (typeof parsed.value === 'string') {
        this.mem.set(key, parsed.value);
        return parsed.value;
      }
    } catch {
      // corrupted file — treat as miss; will be overwritten on set
    }
    return undefined;
  }

  /** Cache a response in memory and (if configured) on disk. */
  set(key: string, value: string): void {
    this.mem.set(key, value);
    if (!this.persistDir) return;
    const path = join(this.persistDir, `${key}.json`);
    try {
      writeFileSync(path, JSON.stringify({ key, value, savedAt: new Date().toISOString() }));
    } catch {
      // Disk failure shouldn't break enhancement — we already have the
      // value in memory and we'll just pay the API cost on the next run.
    }
  }
}
