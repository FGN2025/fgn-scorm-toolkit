/**
 * ChallengeFetcher — abstraction over reading challenges + tasks from
 * play.fgn.gg. The transformer takes a Fetcher rather than a Supabase
 * client directly, which makes:
 *
 *   - Tests trivial (pass an in-memory fixture fetcher)
 *   - Edge-function deployment painless (pass a SupabaseClient-backed one)
 *   - Future swapping easy (e.g. cache layer, batch read, GraphQL)
 *
 * The Supabase implementation lives below as `createSupabaseFetcher` and
 * is the production path. It enforces `is_active = true` so unpublished
 * challenges cannot be packaged.
 */

import type { FetchedChallenge, PlayChallenge, PlayChallengeTask, PlayGame } from './play-types.js';

export interface ChallengeFetcher {
  /**
   * Fetch a challenge along with its tasks and game. Returns null if
   * the challenge does not exist OR is not published (`is_active = false`).
   */
  fetchChallenge(id: string): Promise<FetchedChallenge | null>;
}

export class ChallengeNotPublishedError extends Error {
  constructor(public challengeId: string) {
    super(`Challenge ${challengeId} is not published (is_active = false). Publish it on play.fgn.gg before exporting.`);
    this.name = 'ChallengeNotPublishedError';
  }
}

export class ChallengeNotFoundError extends Error {
  constructor(public challengeId: string) {
    super(`Challenge ${challengeId} not found in play.fgn.gg.`);
    this.name = 'ChallengeNotFoundError';
  }
}

/**
 * Minimal interface from @supabase/supabase-js so we don't add it as a
 * hard dependency. Anything that quacks like SupabaseClient.from(...) works.
 */
export interface SupabaseLike {
  from(table: string): {
    select(cols: string): {
      eq(col: string, val: unknown): {
        maybeSingle(): Promise<{ data: unknown; error: { message: string } | null }>;
        order(col: string, opts: { ascending: boolean }): Promise<{
          data: unknown;
          error: { message: string } | null;
        }>;
      };
    };
  };
}

/**
 * Production fetcher backed by a Supabase client pointed at play.fgn.gg.
 * The client must have at least anon-key permissions on `challenges`,
 * `challenge_tasks`, and `games` (all are readable for any authenticated
 * user under play.fgn.gg's RLS).
 */
export function createSupabaseFetcher(supabase: SupabaseLike): ChallengeFetcher {
  return {
    async fetchChallenge(id: string): Promise<FetchedChallenge | null> {
      // Read challenge row, gating on is_active=true (publish gate).
      const challengeRes = await supabase
        .from('challenges')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (challengeRes.error) {
        throw new Error(`fetchChallenge: ${challengeRes.error.message}`);
      }
      if (!challengeRes.data) {
        return null;
      }

      const challenge = challengeRes.data as PlayChallenge;
      if (!challenge.is_active) {
        throw new ChallengeNotPublishedError(id);
      }

      // Read tasks.
      const tasksRes = await supabase
        .from('challenge_tasks')
        .select('*')
        .eq('challenge_id', id)
        .order('display_order', { ascending: true });

      if (tasksRes.error) {
        throw new Error(`fetchChallengeTasks: ${tasksRes.error.message}`);
      }

      const tasks = (tasksRes.data as PlayChallengeTask[] | null) ?? [];

      // Read game (optional — challenge.game_id may be null).
      let game: PlayGame | null = null;
      if (challenge.game_id) {
        const gameRes = await supabase
          .from('games')
          .select('*')
          .eq('id', challenge.game_id)
          .maybeSingle();

        if (gameRes.error) {
          throw new Error(`fetchGame: ${gameRes.error.message}`);
        }
        game = (gameRes.data as PlayGame | null) ?? null;
      }

      return { challenge, tasks, game };
    },
  };
}

/**
 * Test/in-memory fetcher backed by a fixture map. Used in unit tests
 * and in development when play.fgn.gg credentials aren't available.
 */
export function createFixtureFetcher(
  fixtures: Record<string, FetchedChallenge>,
): ChallengeFetcher {
  return {
    async fetchChallenge(id: string): Promise<FetchedChallenge | null> {
      const f = fixtures[id];
      if (!f) return null;
      if (!f.challenge.is_active) {
        throw new ChallengeNotPublishedError(id);
      }
      return f;
    },
  };
}
