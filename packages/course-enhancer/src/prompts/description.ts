/**
 * Course description rewrite — the short blurb shown in the LMS
 * catalog and on the fgn.academy course card.
 *
 * Inputs: course title + (optional) existing description + a digest
 * of the included challenges. Output: 1-3 sentence prose, no HTML.
 */

import type { CourseManifest } from '@fgn/course-types';
import { FGN_STYLE_GUIDE } from './style-guide.js';
import type { SystemBlock } from '../anthropic-client.js';

export interface DescriptionPrompt {
  systemBlocks: SystemBlock[];
  userMessage: string;
}

export function buildDescriptionPrompt(course: CourseManifest): DescriptionPrompt {
  const challengeSummary = course.modules
    .filter((m) => m.type !== 'completion')
    .map((m) => `- ${m.title} (${m.type})`)
    .join('\n');

  const framework = course.credentialFramework
    ? `\nCredential framework: ${course.credentialFramework}`
    : '';

  const existing = course.description?.trim();
  const existingBlock = existing
    ? `Current placeholder description (to improve, not preserve verbatim):\n"""${existing}"""\n\n`
    : '';

  const userMessage = `Write a course description for the FGN catalog.

Course title: ${course.title}${framework}

Modules included:
${challengeSummary}

${existingBlock}REQUIREMENTS
- Plain prose, 1-3 sentences, 280 characters max.
- No HTML, no markdown, no leading/trailing quotes.
- State what the course reinforces and the framework it sits in (if any).
- Frame as post-completion reinforcement, not pre-launch instructions.

Return ONLY the description text — no preamble, no closing remark.`;

  return {
    systemBlocks: [
      // Style guide is stable across all calls in a batch — cache it.
      { text: FGN_STYLE_GUIDE, cache: true },
    ],
    userMessage,
  };
}
