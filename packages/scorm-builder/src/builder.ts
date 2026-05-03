/**
 * Builder — turns a list of FetchedChallenge rows into a CourseManifest.
 *
 * Per the Phase 1.5 content model: SCORM/Learn courses are the
 * post-completion skills development layer. The challenge step itself
 * belongs to the Work Order layer on fgn.academy (and the deeper
 * gameplay on play.fgn.gg). The course content here assumes the
 * learner has already completed the prerequisite Work Order.
 *
 * For each challenge in a bundle the builder emits, by default:
 *
 *   1. briefing   "[challenge name]: Recap & Reinforcement"
 *      Post-completion recap + deeper concept reinforcement.
 *      Frames the challenge as already-done and connects what was
 *      practiced to the underlying standard / framework.
 *
 *   2. quiz       "[challenge name]: Knowledge Check"
 *      Only for frameworks requiring a knowledge gate (OSHA, TIRAP,
 *      OpTIC Path). Scenario-based questions verifying transfer.
 *
 *   3. completion "[challenge name]: Reflection"
 *      Final summary + next-step pointer + credential issuance trigger.
 *
 * One course-level completion module wraps a multi-challenge bundle.
 *
 * The CourseManifest carries `gatingChallengeId` so the Player can
 * /check completion on load and lock content if the Work Order isn't
 * verified yet. For single-challenge courses, this is the source
 * challenge id. For multi-challenge bundles, gating is set to the
 * first challenge — Phase 2 Course Builder UI may expose richer
 * multi-prerequisite logic.
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
  bridgeEndpoint?: string;
  /**
   * Frameworks that require a knowledge-gate quiz. Default: ['OSHA',
   * 'TIRAP', 'OpTIC Path']. Other frameworks skip directly to completion.
   */
  knowledgeGateFrameworks?: string[];
  /**
   * Phase 1.5 default: skip emitting the standalone `challenge` lesson
   * type. The challenge step belongs to the Work Order layer; the
   * course is post-completion content. Set true ONLY for legacy /
   * back-compat usage where the SCORM is the canonical challenge
   * experience (rare).
   */
  includeChallengeModule?: boolean;
}

const DEFAULT_KNOWLEDGE_GATE_FRAMEWORKS = ['OSHA', 'TIRAP', 'OpTIC Path'];

export function buildCourseManifest(
  challenges: FetchedChallenge[],
  options: BuildOptions,
): CourseManifest {
  const knowledgeGateFrameworks =
    options.knowledgeGateFrameworks ?? DEFAULT_KNOWLEDGE_GATE_FRAMEWORKS;
  const includeChallenge = options.includeChallengeModule ?? false;

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
    const challengeName = fc.challenge.name;

    // 1. Briefing — post-completion recap + reinforcement
    const briefing = buildBriefing(fc, game, framework);
    modules.push({
      id: `${moduleIdPrefix}-briefing`,
      position: position++,
      type: 'briefing',
      title: `${challengeName}: ${briefing.titleSuffix}`,
      html: briefing.bodyHtml,
    });

    // 2. (Optional, default-off) Challenge — for back-compat only.
    // Phase 1.5 content model: the challenge belongs to the Work Order
    // layer on fgn.academy, not the SCORM/Learn layer. Set
    // includeChallengeModule=true to override.
    if (includeChallenge) {
      modules.push({
        id: `${moduleIdPrefix}-challenge`,
        position: position++,
        type: 'challenge',
        title: `${challengeName}: Challenge Tasks`,
        challengeId: fc.challenge.id,
        challengeUrl: `https://play.fgn.gg/challenges/${fc.challenge.id}`,
        ...(game !== undefined ? { game } : {}),
        ...(framework !== undefined ? { credentialFramework: framework } : {}),
        tasks: fc.tasks.map((t) => mapTask(t)),
      });
    }

    // 3. Quiz (only if framework gates knowledge)
    if (framework && knowledgeGateFrameworks.includes(framework)) {
      modules.push({
        id: `${moduleIdPrefix}-quiz`,
        position: position++,
        type: 'quiz',
        title: `${challengeName}: Knowledge Check`,
        passThreshold: 80,
        questions: [
          {
            id: 'placeholder',
            type: 'single-choice',
            prompt:
              `[Placeholder question — replace before publishing.] ${challengeName} addresses which framework?`,
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
  // Title uses the lead challenge's name when single-challenge, or a
  // bundle-level label otherwise.
  const completionTitle =
    challenges.length === 1
      ? `${challenges[0]!.challenge.name}: Reflection`
      : `Course Reflection`;

  modules.push({
    id: 'course-completion',
    position: position++,
    type: 'completion',
    title: completionTitle,
    html: buildCompletionHtml(challenges, courseFramework),
  });

  // Determine the gating challenge — the prerequisite Work Order the
  // Player will check on load. For single-challenge courses this is
  // unambiguously the source. For multi-challenge bundles, gate on
  // the first; Phase 2 Course Builder UI will expose richer logic.
  const gatingChallengeId = challenges[0]?.challenge.id;

  // Phase 1.4.5.1 — pass through the existing play.fgn.gg cover image
  // and per-challenge AI prompt as override-time direction. For
  // single-challenge courses we trust the lead challenge's row; for
  // multi-challenge bundles we still use the lead challenge's cover
  // (Phase 2 Course Builder UI will expose admin selection between
  // bundle members or full manual override).
  const leadChallenge = challenges[0];
  const coverImageRemoteUrl = leadChallenge?.challenge.cover_image_url ?? undefined;
  const coverImagePromptOverride = leadChallenge?.challenge.cover_image_prompt ?? undefined;

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
    ...(options.bridgeEndpoint !== undefined
      ? { bridgeEndpoint: options.bridgeEndpoint }
      : {}),
    ...(gatingChallengeId !== undefined ? { gatingChallengeId } : {}),
    // Note: coverImageUrl (the relative path inside the SCORM ZIP)
    // is intentionally NOT stamped here. transform() fetches the
    // bytes and stamps it after the asset is bundled. Builder is a
    // pure-data step; HTTP fetching is transform()'s job.
    ...(coverImageRemoteUrl !== undefined ? { coverImageRemoteUrl } : {}),
    ...(coverImagePromptOverride !== undefined ? { coverImagePromptOverride } : {}),
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
  // Per FGN curriculum convention, task descriptions contain an
  // "Evidence: ..." sentence. Pull that out for explicit display in
  // the Player while preserving the full description.
  const evidenceMatch = description.match(/Evidence:\s*([\s\S]+?)(?:\n\s*$|$)/i);
  const evidenceSpec = evidenceMatch
    ? evidenceMatch[1]!.trim()
    : 'Submit screenshots or video evidence of completion as specified in the description.';

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
    ? `<p>This course is part of the <strong>${framework}</strong> credential pathway. Your final credential will be issued to your <a href="https://fgn.academy/skill-passport">FGN Skill Passport</a> once instructor review of your Work Order evidence is complete — usually within 1-2 business days.</p>`
    : '<p>Your credential will be issued to your <a href="https://fgn.academy/skill-passport">FGN Skill Passport</a> once instructor review of your Work Order evidence is complete.</p>';
  return [
    `<p>You've completed ${count === 1 ? 'this FGN learning unit' : `all ${count} challenges in this bundle`}. The recap and knowledge-check work you did here builds on the verified Work Order completion that gated access to this course.</p>`,
    credentialLine,
    `<h3>What's next</h3>`,
    `<p>Continue to the next learning unit in your pathway. New Work Orders unlock additional courses as you progress through your Skill Passport.</p>`,
  ].join('\n');
}

/**
 * Map play.fgn.gg's `games.name` (free-text display name) to the
 * canonical `GameTitle` enum used by fgn.academy and the course types.
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
