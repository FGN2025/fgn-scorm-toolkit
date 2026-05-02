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

import type { BrandMode, ScormDestination } from '@fgn/brand-tokens';

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
