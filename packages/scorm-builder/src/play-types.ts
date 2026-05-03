/**
 * Internal types matching the relevant subset of play.fgn.gg's Supabase
 * schema. These are not re-exported from the package — they are internal
 * to the transformer's reads from play.fgn.gg.
 *
 * Mirror of FGN2025/guild-hall-maker @ src/integrations/supabase/types.ts
 * scoped to the columns the transformer cares about.
 */

export interface PlayChallenge {
  id: string;
  name: string;
  description: string | null;
  difficulty: string;
  challenge_type: string;
  game_id: string | null;
  is_active: boolean;
  is_featured: boolean;
  estimated_minutes: number | null;
  points_reward: number;
  requires_evidence: boolean;
  cdl_domain: string | null;
  certification_description: string | null;
  cfr_reference: string | null;
  academy_next_step_label: string | null;
  academy_next_step_url: string | null;
  cover_image_url: string | null;
  /**
   * Hand-curated AI image prompt that the FGN content team writes per
   * challenge. Used as the override prompt source when the admin
   * regenerates a SCORM course's cover via `fgn-scorm enhance
   * --slots coverImage`. When absent, the toolkit falls back to its
   * per-game scene library.
   *
   * Note: `cover_image_url` is the DEFAULT cover for SCORM courses.
   * `cover_image_prompt` is the override-time direction. Both can
   * coexist on a row (commonly do).
   */
  cover_image_prompt: string | null;
  coach_context: string | null;
  achievement_id: string | null;
  season_id: string | null;
  start_date: string | null;
  end_date: string | null;
  max_completions: number | null;
  max_enrollments: number | null;
  display_order: number | null;
}

export interface PlayChallengeTask {
  id: string;
  challenge_id: string;
  title: string;
  description: string | null;
  display_order: number;
}

export interface PlayGame {
  id: string;
  name: string;
  slug: string;
  category: string;
  description: string | null;
  cover_image_url: string | null;
  is_active: boolean;
  steam_app_id: string | null;
  platform_tags: string[] | null;
}

/**
 * Combined view of a challenge as the transformer sees it: challenge
 * row + its tasks + its game (resolved).
 */
export interface FetchedChallenge {
  challenge: PlayChallenge;
  tasks: PlayChallengeTask[];
  game: PlayGame | null;
}
