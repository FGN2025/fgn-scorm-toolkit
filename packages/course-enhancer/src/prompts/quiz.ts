/**
 * Quiz question generation — replaces the placeholder question stamped
 * by the builder with 3-5 scenario-based questions that test transfer
 * of the standard, not memorization of the challenge tasks.
 *
 * Returns structured JSON validated against a hand-written JSON schema
 * + a runtime validator. We deliberately don't pull Zod as a dep —
 * the schema here is small enough to validate inline.
 */

import type {
  ChallengeModule,
  CourseManifest,
  QuizModule,
  QuizQuestion,
} from '@fgn/course-types';
import { FGN_STYLE_GUIDE } from './style-guide.js';
import type { SystemBlock } from '../anthropic-client.js';

export interface QuizPrompt {
  systemBlocks: SystemBlock[];
  userMessage: string;
  schema: Record<string, unknown>;
  schemaName: string;
  validate: (raw: unknown) => GeneratedQuiz;
}

export interface GeneratedQuiz {
  questions: QuizQuestion[];
}

export function buildQuizPrompt(args: {
  course: CourseManifest;
  quiz: QuizModule;
  /** Sibling challenge module that the quiz tests transfer of. */
  challenge?: ChallengeModule | undefined;
  /** Snapshotted challenge description from play.fgn.gg, if available. */
  challengeDescription?: string;
}): QuizPrompt {
  const { course, quiz, challenge, challengeDescription } = args;

  const taskList = challenge?.tasks
    ?.map((t, i) => `${i + 1}. ${t.title}`)
    .join('\n');

  const taskBlock = taskList
    ? `\nTasks completed in the Work Order:\n${taskList}\n`
    : '';

  const descBlock = challengeDescription
    ? `\nUnderlying challenge description:\n"""${challengeDescription.trim()}"""\n`
    : '';

  const framework = course.credentialFramework
    ? `\nCredential framework: ${course.credentialFramework}.`
    : '';

  const userMessage = `Generate 3 to 5 knowledge-check questions for the lesson "${quiz.title}".${framework}
${taskBlock}${descBlock}
REQUIREMENTS
- Questions must test TRANSFER — would the learner apply the same reasoning to a slightly different scenario? Avoid recall-of-task questions ("which step did you do third").
- Mix question types: prefer single-choice; include 0-1 true-false if appropriate.
- 3-4 choices per single-choice question, exactly one correct. For true-false, exactly two choices labeled "True" and "False".
- Each correct answer must have a 1-2 sentence explanation grounded in the relevant standard or domain logic.
- Choice ids: lowercase letters "a", "b", "c", "d" (or "true"/"false" for true-false).
- Question ids: short slugs like "q1", "q2", "q3".
- No "all of the above" or "none of the above". No trick wording.
- Pass threshold for the lesson is ${quiz.passThreshold}% — calibrate difficulty so a competent learner passes on first attempt.

Return ONLY the structured JSON specified by the output schema.`;

  // JSON schema mirrors the QuizQuestion type. Kept inline so the
  // structured-output endpoint can constrain decoding.
  const schema: Record<string, unknown> = {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        minItems: 3,
        maxItems: 5,
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            prompt: { type: 'string' },
            type: {
              type: 'string',
              enum: ['single-choice', 'multi-choice', 'true-false'],
            },
            choices: {
              type: 'array',
              minItems: 2,
              maxItems: 4,
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  label: { type: 'string' },
                  correct: { type: 'boolean' },
                },
                required: ['id', 'label', 'correct'],
                additionalProperties: false,
              },
            },
            explanation: { type: 'string' },
          },
          required: ['id', 'prompt', 'type', 'choices', 'explanation'],
          additionalProperties: false,
        },
      },
    },
    required: ['questions'],
    additionalProperties: false,
  };

  return {
    systemBlocks: [
      { text: FGN_STYLE_GUIDE, cache: true },
    ],
    userMessage,
    schema,
    schemaName: 'fgn_quiz_questions',
    validate: validateGeneratedQuiz,
  };
}

function validateGeneratedQuiz(raw: unknown): GeneratedQuiz {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Quiz output is not an object');
  }
  const obj = raw as { questions?: unknown };
  if (!Array.isArray(obj.questions)) {
    throw new Error('Quiz output missing "questions" array');
  }
  const questions: QuizQuestion[] = obj.questions.map((q, i) => validateQuestion(q, i));
  if (questions.length < 1) {
    throw new Error('Quiz output produced 0 questions');
  }
  return { questions };
}

function validateQuestion(raw: unknown, idx: number): QuizQuestion {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Question ${idx} is not an object`);
  }
  const q = raw as {
    id?: unknown;
    prompt?: unknown;
    type?: unknown;
    choices?: unknown;
    explanation?: unknown;
  };
  if (typeof q.id !== 'string') throw new Error(`Question ${idx}: id missing`);
  if (typeof q.prompt !== 'string') throw new Error(`Question ${idx}: prompt missing`);
  if (q.type !== 'single-choice' && q.type !== 'multi-choice' && q.type !== 'true-false') {
    throw new Error(`Question ${idx}: invalid type ${String(q.type)}`);
  }
  if (!Array.isArray(q.choices) || q.choices.length < 2) {
    throw new Error(`Question ${idx}: needs >=2 choices`);
  }
  const choices = q.choices.map((c, j) => {
    if (!c || typeof c !== 'object') throw new Error(`Question ${idx}.choice ${j} not an object`);
    const ch = c as { id?: unknown; label?: unknown; correct?: unknown };
    if (typeof ch.id !== 'string') throw new Error(`Question ${idx}.choice ${j}: id missing`);
    if (typeof ch.label !== 'string') throw new Error(`Question ${idx}.choice ${j}: label missing`);
    if (typeof ch.correct !== 'boolean') throw new Error(`Question ${idx}.choice ${j}: correct missing`);
    return { id: ch.id, label: ch.label, correct: ch.correct };
  });
  // At least one correct, exactly one for single-choice / true-false
  const correctCount = choices.filter((c) => c.correct).length;
  if (correctCount === 0) throw new Error(`Question ${idx}: no correct choice`);
  if ((q.type === 'single-choice' || q.type === 'true-false') && correctCount !== 1) {
    throw new Error(`Question ${idx}: ${q.type} must have exactly 1 correct choice`);
  }

  const result: QuizQuestion = {
    id: q.id,
    prompt: q.prompt,
    type: q.type,
    choices,
  };
  if (typeof q.explanation === 'string' && q.explanation.length > 0) {
    result.explanation = q.explanation;
  }
  return result;
}
