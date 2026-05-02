/**
 * Re-export of @fgn/course-types so the rest of @fgn/scorm-player can
 * keep importing from "../types" / "./types" without each file knowing
 * about the workspace package.
 *
 * The single source of truth lives in @fgn/course-types — see that
 * package for the full definitions.
 */
export type {
  CourseManifest,
  CourseModule,
  BaseModule,
  BriefingModule,
  ChallengeModule,
  ChallengeTask,
  QuizModule,
  QuizQuestion,
  MediaModule,
  CompletionModule,
  ProgressState,
  ChallengeState,
  ScormLessonStatus,
  CourseWarning,
  GameTitle,
  Pillar,
} from '@fgn/course-types';
