/**
 * Builder — turns a list of FetchedChallenge rows into a CourseManifest.
 *
 * For each challenge in the bundle, the builder emits four lessons:
 *   1. briefing — auto-generated from the per-game template (admin can override)
 *   2. challenge — the deep-link to play.fgn.gg, with tasks snapshotted
 *   3. quiz — only if the credential framework requires a knowledge gate
 *   4. completion — short summary + credential-issuance trigger context
 *
 * Plus one final completion module at course level when the bundle has
 * multiple challenges.
 */

import type {
  CourseManifest,
  CourseModule,
  GameTitle,
  Pillar,
} from '@fgn/course-types';
import type { ScormDestination } from '@fgn/brand-tokens';
import { destinationToMode, credentialFrameworkToPillar } from '@fgn/brand-tokens';
import type { FetchedChallenge, PlayChallengeTask } from './play-types.js';
import { buildBriefing } from './briefing-templates.js';
import { inferFramework } from './pathway-validators.js';

export interface BuildOptions {
  bundleId: string;
  title: string;
  description?: string;
  destination: ScormDestination;
  scormVersion: '1.2' | 'cmi5';
  pillarOverride?: Pillar;
  launchTokenEndpoint?: string;
  /**
   * Frameworks that require a knowledge-gate quiz. Default: ['OSHA',
   * 'TIRAP', 'OpTIC Path']. Other frameworks skip directly to completion.
   */
  knowledgeGateFrameworks?: string[];
}

const DEFAULT_KNOWLEDGE_GATE_FRAMEWORKS = ['OSHA', 'TIRAP', 'OpTIC Path'];

export function buildCourseManifest(
  challenges: FetchedChallenge[],
  options: BuildOptions,
): CourseManifest {
  const knowledgeGateFrameworks =
    options.knowledgeGateFrameworks ?? DEFAULT_KNOWLEDGE_GATE_FRAMEWORKS;

  const modules: CourseModule[] = [];
  let position = 0;

  // Pick a course-level pillar: explicit override > first challenge's
  // inferred framework → pillar > undefined (no accent override).
  const firstFramework = challenges[0] ? inferFramework(challenges[0]) : undefined;
  const pillar = options.pillarOverride
    ?? (firstFramework ? credentialFrameworkToPillar[firstFramework] : undefined);

  // Pick a course-level credential framework label (best-effort).
  const courseFramework =
    challenges.length === 1
      ? inferFramework(challenges[0]!)
      : commonFramework(challenges);

  for (const fc of challenges) {
    const game = mapGameNameToTitle(fc.game?.name);
    const framework = inferFramework(fc);
    const moduleIdPrefix = `c-${fc.challenge.id.slice(0, 8)}`;

    // 1. Briefing
    const briefing = buildBriefing(fc, game, framework);
    modules.push({
      id: `${moduleIdPrefix}-briefing`,
      position: position++,
      type: 'briefing',
      title: briefing.title,
      html: briefing.bodyHtml,
    });

    // 2. Challenge
    modules.push({
      id: `${moduleIdPrefix}-challenge`,
      position: position++,
      type: 'challenge',
      title: fc.challenge.name,
      challengeId: fc.challenge.id,
      challengeUrl: `https://play.fgn.gg/challenges/${fc.challenge.id}`,
      ...(game !== undefined ? { game } : {}),
      ...(framework !== undefined ? { credentialFramework: framework } : {}),
      tasks: fc.tasks.map((t) => mapTask(t)),
    });

    // 3. Quiz (only if framework gates knowledge)
    if (framework && knowledgeGateFrameworks.includes(framework)) {
      modules.push({
        id: `${moduleIdPrefix}-quiz`,
        position: position++,
        type: 'quiz',
        title: `${framework} Knowledge Gate`,
        passThreshold: 80,
        // Quiz questions are NOT auto-generated — admin authors them in
        // the Course Builder UI. The transformer emits an empty quiz
        // with a single placeholder question so the lesson exists; the
        // admin must replace it before publishing. Surface as a warning.
        questions: [
          {
            id: 'placeholder',
            type: 'single-choice',
            prompt:
              `[Placeholder question — replace before publishing.] ${fc.challenge.name} addresses which framework?`,
            choices: [
              { id: 'a', label: framework, correct: true },
              { id: 'b', label: 'Not applicable', correct: false },
            ],
          },
        ],
      });
    }
  }

  // Course-level completion summary
  modules.push({
    id: 'course-completion',
    position: position++,
    type: 'completion',
    title: 'Course complete',
    html: buildCompletionHtml(challenges, courseFramework),
  });

  const manifest: CourseManifest = {
    schemaVersion: 1,
    id: options.bundleId,
    title: options.title,
    ...(options.description !== undefined ? { description: options.description } : {}),
    destination: options.destination,
    brandMode: destinationToMode[options.destination],
    ...(pillar !== undefined ? { pillar } : {}),
    ...(courseFramework !== undefined ? { credentialFramework: courseFramework } : {}),
    scormVersion: options.scormVersion,
    ...(options.launchTokenEndpoint !== undefined
      ? { launchTokenEndpoint: options.launchTokenEndpoint }
      : {}),
    modules,
  };

  return manifest;
}

function mapTask(t: PlayChallengeTask): {
  id: string;
  position: number;
  title: string;
  description: string;
  evidenceSpec: string;
  mechanicType: 'in-game' | 'annotation';
} {
  const description = t.description ?? '';
  // Per FGN curriculum convention, task descriptions end with an
  // "Evidence: ..." line. Pull that out for explicit display in the
  // Player while preserving the full description.
  const evidenceMatch = description.match(/(?:^|\n)\s*Evidence:\s*([\s\S]+?)(?:\n\s*$|$)/i);
  const evidenceSpec = evidenceMatch
    ? evidenceMatch[1]!.trim()
    : 'Submit screenshots or video evidence of completion as specified in the description.';

  // Mechanic type heuristic: descriptions that emphasize "annotation"
  // or written explanation hint at the annotation model. Default to
  // in-game when ambiguous.
  const lower = description.toLowerCase();
  const mechanicType: 'in-game' | 'annotation' =
    lower.includes('annotation') || lower.includes('written explanation') || lower.includes('annotate')
      ? 'annotation'
      : 'in-game';

  return {
    id: t.id,
    position: t.display_order,
    title: t.title,
    description,
    evidenceSpec,
    mechanicType,
  };
}

function buildCompletionHtml(
  challenges: FetchedChallenge[],
  framework: string | undefined,
): string {
  const count = challenges.length;
  const credentialLine = framework
    ? `<p>This course is part of the <strong>${framework}</strong> credential pathway. Your final score will be confirmed once instructor review of your evidence is complete — usually within 1-2 business days.</p>`
    : '<p>Your final score will be confirmed once instructor review of your evidence is complete.</p>';
  return [
    `<p>You've completed ${count === 1 ? 'this FGN learning unit' : `all ${count} challenges in this bundle`}. A preliminary score has been written to your LMS based on your knowledge-gate quizzes (where applicable).</p>`,
    credentialLine,
    `<h3>What's next</h3>`,
    `<p>Continue to the next module in your pathway, or explore additional challenges on play.fgn.gg.</p>`,
  ].join('\n');
}

/**
 * Map play.fgn.gg's `games.name` (which is a free-text display name like
 * "Construction Simulator", "Farming Simulator 25", etc.) to the canonical
 * `GameTitle` enum used by fgn.academy and the course types.
 */
function mapGameNameToTitle(name: string | undefined): GameTitle | undefined {
  if (!name) return undefined;
  const n = name.toLowerCase();
  if (n.includes('american truck')) return 'ATS';
  if (n.includes('ats')) return 'ATS';
  if (n.includes('farming')) return 'Farming_Sim';
  if (n.includes('fs')) return 'Farming_Sim';
  if (n.includes('construction')) return 'Construction_Sim';
  if (n.includes('mechanic')) return 'Mechanic_Sim';
  if (n.includes('roadcraft')) return 'Roadcraft';
  if (n.includes('optic') || n.includes('fiber')) return 'Fiber_Tech';
  return undefined;
}

function commonFramework(challenges: FetchedChallenge[]): string | undefined {
  const fws = challenges.map(inferFramework).filter((f): f is string => !!f);
  if (fws.length === 0) return undefined;
  const first = fws[0]!;
  return fws.every((f) => f === first) ? first : undefined;
}
