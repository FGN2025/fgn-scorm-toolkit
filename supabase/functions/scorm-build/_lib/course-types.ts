/**
 * @fgn/course-types — shared types for the FGN SCORM toolkit.
 *
 * `CourseManifest` is the contract that ties three packages together:
 *
 *   @fgn/scorm-builder.transform()  produces  CourseManifest
 *   @fgn/scorm-builder.package()    consumes  CourseManifest  → SCORM 1.2 ZIP
 *   @fgn/academy-publisher          consumes  CourseManifest  → fgn.academy native rows
 *   @fgn/scorm-player               consumes  CourseManifest  (loaded from course.json at runtime)
 *
 * If you change the schema, bump `CourseManifest.schemaVersion` and update
 * every consumer. The Player rejects packages with an unsupported version.
 */

import type { BrandMode, ScormDestination } from './brand-tokens.ts';

/**
 * Source game / simulation — aligned with fgn.academy's canonical
 * `game_title` enum. `Fiber_Tech` is FGN's name for the Fiber Broadband
 * Association OpTIC Path simulation pathway (not a third-party game).
 */
export type GameTitle =
  | 'ATS'
  | 'Farming_Sim'
  | 'Construction_Sim'
  | 'Mechanic_Sim'
  | 'Roadcraft'
  | 'Fiber_Tech';

/**
 * Brand pillars — one of four immutable color/category anchors. Picked
 * automatically from the credential framework, or set per-course by admin.
 */
export type Pillar = 'perf' | 'play' | 'path' | 'fiber';

export interface CourseManifest {
  /** Schema version for forward-compatibility. Bump when shape changes. */
  schemaVersion: 1;
  id: string;
  title: string;
  description?: string;
  destination: ScormDestination;
  brandMode: BrandMode;
  pillar?: Pillar;
  credentialFramework?: string;
  scormVersion: '1.2' | 'cmi5';
  /** Endpoint base URL for the launch-token bridge. */
  launchTokenEndpoint?: string;
  /**
   * Endpoint base URL for the completion-check bridge — the SCORM Player
   * calls this on load to decide locked vs unlocked state.
   * Default: https://vfzjfkcwromssjnlrhoo.supabase.co/functions/v1/scorm-launch-status
   * The /check route is appended at runtime.
   */
  bridgeEndpoint?: string;
  /**
   * Logical reference to the source play.fgn.gg challenge that gates
   * access to this course. The Player calls /check with this id +
   * the learner's email (from cmi.core.student_id) to decide whether
   * to unlock content. Required for any course produced by transform();
   * absent only for hand-authored courses with no work_order prerequisite.
   */
  gatingChallengeId?: string;
  /**
   * Marker stamped by @fgn/course-enhancer when an AI pass has rewritten
   * one or more text fields on this manifest. Carries the model id and
   * a hash of the input course used to generate the cache keys, so
   * downstream consumers can re-run idempotently and reviewers can tell
   * at a glance whether content has been LLM-touched.
   *
   * Absence (undefined) means the manifest is fully template-derived —
   * the default for transform() output.
   */
  aiEnhanced?: {
    /**
     * Primary model id used for the enhancement pass. For Phase 1.4
     * text slots this is the Anthropic model (e.g. claude-opus-4-7).
     * For mixed text+image runs this is still the Anthropic model;
     * the image model is implicit from the slot type. Future schema
     * versions may add a per-slot model field if we ever route slots
     * to multiple text models.
     */
    model: string;
    /** ISO timestamp of when the enhancement ran. */
    enhancedAt: string;
    /**
     * sha256 of the canonicalized pre-enhancement manifest, hex-encoded.
     * Lets us detect "this course was enhanced from THIS exact input" even
     * after later edits.
     */
    inputHash: string;
    /** Which fields were rewritten — useful for partial-failure recovery. */
    enhancedFields: Array<
      'description' | 'briefingHtml' | 'quizQuestions' | 'coverImage'
    >;
  };
  /**
   * Path or URL to the course cover image. Phase 1.4.5 stamps this as
   * a relative path (e.g. "assets/cover.png") that the SCORM packager
   * resolves against the manifest's directory and bundles into the ZIP.
   * Phase 1.4.6+ may also stamp this as an absolute URL when the image
   * has been uploaded to fgn.academy's media library.
   */
  coverImageUrl?: string;
  /**
   * Smaller variant of the cover image — reserved for Phase 1.4.7 when
   * the catalog grid on fgn.academy / broadbandworkforce.com needs
   * thumbnails distinct from full-size covers.
   */
  thumbnailUrl?: string;
  /**
   * Canonical hosted URL for the cover image, when uploaded to
   * fgn.academy's media library (Phase 1.4.6+). Distinct from
   * coverImageUrl, which may be a relative path inside the SCORM ZIP.
   * Both can coexist; consumers pick whichever fits their context
   * (admin UI prefers remote; offline SCORM player prefers local).
   *
   * Phase 1.4.5.1 also stamps this field with the original
   * play.fgn.gg `cover_image_url` when the toolkit passes the
   * existing curated cover through to the SCORM. That gives the
   * catalog UI a stable reference to the source-of-truth image even
   * after the bytes are bundled into the ZIP.
   */
  coverImageRemoteUrl?: string;
  /**
   * Hand-curated AI image prompt copied from play.fgn.gg's
   * `challenges.cover_image_prompt` field at transform time. Used as
   * the prompt source when the admin chooses to REGENERATE the cover
   * via `fgn-scorm enhance --slots coverImage`. When absent, the
   * enhancer falls back to its per-game scene library.
   *
   * The default flow does NOT use this field — the existing
   * `coverImageUrl`/`coverImageRemoteUrl` is the default cover. This
   * field only matters during AI-driven override regeneration.
   */
  coverImagePromptOverride?: string;
  modules: CourseModule[];
}

export type CourseModule =
  | BriefingModule
  | ChallengeModule
  | QuizModule
  | MediaModule
  | CompletionModule;

export interface BaseModule {
  id: string;
  position: number;
  title: string;
}

export interface BriefingModule extends BaseModule {
  type: 'briefing';
  /** Sanitized HTML rendered inside the briefing slide. */
  html: string;
  mediaIds?: string[];
}

export interface ChallengeModule extends BaseModule {
  type: 'challenge';
  challengeId: string;
  challengeUrl: string;
  /** Source game / simulation. */
  game?: GameTitle;
  /** Per-module credential framework override (defaults to course-level). */
  credentialFramework?: string;
  /**
   * Tasks within the challenge, snapshotted from play.fgn.gg at export
   * time. 1..N tasks per challenge.
   */
  tasks: ChallengeTask[];
  /** Optional pre-launch instructions shown above the task list. */
  preLaunchHtml?: string;
}

export interface ChallengeTask {
  id: string;
  position: number;
  title: string;
  /** Full task description, including the trailing "Evidence:" line. */
  description: string;
  /**
   * Concrete evidence specification (the "Evidence: ..." line extracted
   * from the description if present). The transformer parses this out
   * for cleaner display in the Player; the full description is preserved
   * separately so nothing is lost.
   */
  evidenceSpec: string;
  /**
   * Whether the task uses a real in-game mechanic or the FGN annotation
   * model. Inferred by the transformer from challenge metadata or
   * defaulted to 'in-game' when unknown.
   */
  mechanicType: 'in-game' | 'annotation';
}

export interface QuizModule extends BaseModule {
  type: 'quiz';
  passThreshold: number;
  questions: QuizQuestion[];
}

export interface QuizQuestion {
  id: string;
  prompt: string;
  type: 'single-choice' | 'multi-choice' | 'true-false';
  choices: { id: string; label: string; correct: boolean }[];
  explanation?: string;
}

export interface MediaModule extends BaseModule {
  type: 'media';
  mediaUrl: string;
  caption?: string;
  posterUrl?: string;
}

export interface CompletionModule extends BaseModule {
  type: 'completion';
  html: string;
}

/** Runtime progress state, mirrored to SCORM cmi.suspend_data. */
export interface ProgressState {
  currentModuleId: string | null;
  completedModuleIds: string[];
  quizScores: Record<string, { score: number; passed: boolean }>;
  challengeStates: Record<string, ChallengeState>;
  finalScore?: number;
}

export interface ChallengeState {
  launchToken?: string;
  status: 'pending' | 'launched' | 'completed' | 'failed';
  preliminaryScore?: number;
}

/** SCORM 1.2 lesson_status valid values. */
export type ScormLessonStatus =
  | 'passed'
  | 'completed'
  | 'failed'
  | 'incomplete'
  | 'browsed'
  | 'not attempted';

/**
 * Response shape from POST /scorm-launch-status/check.
 *
 * Drives the Player's gating UI:
 *   userExists=false           → "Create FGN passport" CTA
 *   userExists, !completed     → "Complete Work Order on fgn.academy" CTA
 *   userExists, completed      → unlock + "✓ Work Order Completed" badge
 */
export interface WorkOrderCheckResult {
  userExists: boolean;
  completed: boolean;
  /** ISO timestamp of the most recent successful completion. */
  completedAt?: string;
  /** Score as written by sync-challenge-completion (0..100). */
  score?: number;
  /** Title of the gating work_order on fgn.academy. */
  workOrderTitle?: string;
  /** Direct URL to the work_order page on fgn.academy for the locked-state CTA. */
  workOrderUrl?: string;
}

/**
 * Warning surfaced by the transformer / publisher / packager. Admins
 * see these in the Course Builder UI before exporting.
 *
 * `error` blocks the export. `warn` and `info` allow proceeding with
 * acknowledgement. The validation layer is advisory not enforcing —
 * admins can override anything.
 */
export interface CourseWarning {
  level: 'info' | 'warn' | 'error';
  /** Stable code for UI styling and i18n. */
  code: string;
  /** Human-readable, admin-actionable message. */
  message: string;
  /** Affected challenge IDs, if applicable. */
  challengeIds?: string[];
  /** Recommended next step, if applicable. */
  suggestion?: string;
}
