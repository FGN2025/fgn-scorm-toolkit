/**
 * Briefing HTML rewrite — replaces the template-derived briefing body
 * with prose customized to the actual challenge content.
 *
 * The template produces a workable baseline ("You've completed X.
 * This challenge maps to Y."); the AI pass tightens the language,
 * draws sharper connections between the in-game mechanics and the
 * underlying standard, and avoids the placeholder shape ("the work
 * you practiced applies to…").
 */

import type { BriefingModule, ChallengeModule, CourseManifest } from '../../course-types.ts';
import { FGN_STYLE_GUIDE } from './style-guide.ts';
import type { SystemBlock } from '../anthropic-client.ts';

export interface BriefingPrompt {
  systemBlocks: SystemBlock[];
  userMessage: string;
}

export function buildBriefingPrompt(args: {
  course: CourseManifest;
  briefing: BriefingModule;
  /** The challenge module this briefing recaps, if available. */
  challenge?: ChallengeModule | undefined;
  /** Snapshotted challenge description from play.fgn.gg, if available. */
  challengeDescription?: string;
}): BriefingPrompt {
  const { course, briefing, challenge, challengeDescription } = args;

  const taskList = challenge?.tasks
    ?.map((t, i) => `${i + 1}. ${t.title} — ${t.description.replace(/\s+/g, ' ').trim()}`)
    .join('\n');

  const taskBlock = taskList
    ? `\nTasks the learner completed in the Work Order:\n${taskList}\n`
    : '';

  const descBlock = challengeDescription
    ? `\nUnderlying challenge description:\n"""${challengeDescription.trim()}"""\n`
    : '';

  const frameworkBlock = course.credentialFramework
    ? `\nCredential framework this course sits in: ${course.credentialFramework}.`
    : '';

  const userMessage = `Rewrite the briefing body for the lesson "${briefing.title}".

The briefing is the FIRST screen of the post-completion course. Its job is to (1) acknowledge what the learner has already accomplished in the Work Order, (2) connect that work to the deeper standard or framework, and (3) set up the knowledge-check or reflection that follows.${frameworkBlock}
${taskBlock}${descBlock}
Current template-derived briefing (to improve, not preserve verbatim):
"""
${briefing.html}
"""

REQUIREMENTS
- Output sanitized HTML using only: <p>, <strong>, <em>, <h3>, <ul>, <li>.
- Open with a <p> that names the specific work done in past tense — refer to actual tasks if listed above.
- Include a <h3>What you demonstrated</h3> section followed by 1-2 paragraphs grounded in the task list above.
- Include a <h3>Why it matters</h3> section followed by 1-2 paragraphs connecting the in-game mechanics to the real-world standard or job context.
- Total length: 180-320 words.
- Do NOT include the lesson title (it is rendered separately).
- Do NOT include any "Knowledge Check" preamble — that's a separate lesson.

Return ONLY the HTML body — no <html>, <body>, or markdown fences.`;

  return {
    systemBlocks: [
      { text: FGN_STYLE_GUIDE, cache: true },
    ],
    userMessage,
  };
}
