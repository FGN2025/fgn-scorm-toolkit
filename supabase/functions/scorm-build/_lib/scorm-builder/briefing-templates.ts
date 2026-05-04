/**
 * Per-game briefing templates — Phase 1.5 content model.
 *
 * The course is post-completion content. The learner has already done
 * the challenge on play.fgn.gg AND had it verified as a Work Order on
 * fgn.academy. The briefing's job here is to:
 *
 *   1. Recap what they demonstrated (in past tense, "you've shown...")
 *   2. Connect what they did to the deeper concept / standard
 *   3. Set up the knowledge check (if framework requires one)
 *
 * NOT a pre-launch briefing. The challenge experience is owned by
 * play.fgn.gg + fgn.academy Work Orders. This is the next-step skills
 * development layer.
 *
 * Templates are data-driven — adding a new game / framework is a
 * content edit, not a code change.
 */

import type { GameTitle } from '../course-types.ts';
import type { FetchedChallenge } from './play-types.ts';

export interface BriefingTemplate {
  /**
   * Suffix appended to the challenge name to form the lesson title.
   * Builder produces "[challenge name]: Recap & Reinforcement" or
   * similar. Title consistency is intentional — Challenges, Work
   * Orders, and Learn lessons share the same source name.
   */
  titleSuffix: string;
  /** Sanitized HTML body, post-completion framing. */
  bodyHtml: string;
}

export interface BriefingContext {
  challengeName: string;
  challengeDescription: string;
  gameDisplayName: string;
  difficulty: string;
  estimatedMinutes: number | null;
  cfrReference: string | null;
  certificationDescription: string | null;
  cdlDomain: string | null;
  inferredFramework: string | undefined;
}

export function buildBriefing(
  challenge: FetchedChallenge,
  game: GameTitle | undefined,
  inferredFramework: string | undefined,
): BriefingTemplate {
  const ctx: BriefingContext = {
    challengeName: challenge.challenge.name,
    challengeDescription: challenge.challenge.description ?? '',
    gameDisplayName: GAME_DISPLAY[game ?? 'Construction_Sim'],
    difficulty: challenge.challenge.difficulty,
    estimatedMinutes: challenge.challenge.estimated_minutes,
    cfrReference: challenge.challenge.cfr_reference,
    certificationDescription: challenge.challenge.certification_description,
    cdlDomain: challenge.challenge.cdl_domain,
    inferredFramework,
  };

  const builder = TEMPLATES[game ?? 'Construction_Sim'] ?? TEMPLATES.Construction_Sim;
  return builder(ctx);
}

const GAME_DISPLAY: Record<GameTitle, string> = {
  ATS: 'American Truck Simulator',
  Farming_Sim: 'Farming Simulator 25',
  Construction_Sim: 'Construction Simulator',
  Mechanic_Sim: 'Car Mechanic Simulator 2021',
  Roadcraft: 'Roadcraft',
  Fiber_Tech: 'OpTIC Path Simulation',
};

type TemplateBuilder = (ctx: BriefingContext) => BriefingTemplate;

const TEMPLATES: Record<GameTitle, TemplateBuilder> = {
  ATS: (ctx) => ({
    titleSuffix: 'Recap & Reinforcement',
    bodyHtml: htmlBlock([
      `<p>You've completed the <strong>${escapeHtml(ctx.challengeName)}</strong> Work Order. The runs you logged in ${escapeHtml(ctx.gameDisplayName)} demonstrated the practical mechanics; this section connects what you did to the deeper standards behind it.</p>`,
      ctx.cdlDomain
        ? `<p>This challenge maps to the FMCSA <strong>${escapeHtml(ctx.cdlDomain)}</strong> CDL knowledge domain. The skills you demonstrated translate directly to a Class A or Class B commercial driver examination.</p>`
        : '<p>The skills you practiced apply to commercial driving operations and FMCSA-regulated long-haul trucking.</p>',
      ctx.certificationDescription
        ? `<p><em>${escapeHtml(ctx.certificationDescription)}</em></p>`
        : '',
      `<h3>What you demonstrated</h3>`,
      `<p>${escapeHtml(ctx.challengeDescription || 'You completed the challenge tasks on play.fgn.gg with verified evidence.')}</p>`,
      `<h3>Why it matters</h3>`,
      `<p>The decisions you made — route planning, fatigue management, fuel discipline, on-time arrival — are the same decisions that separate professional CDL drivers from also-rans. The Knowledge Check that follows tests whether you can apply the same reasoning to scenarios you didn't see in the challenge itself.</p>`,
    ]),
  }),

  Farming_Sim: (ctx) => ({
    titleSuffix: 'Recap & Reinforcement',
    bodyHtml: htmlBlock([
      `<p>You've completed the <strong>${escapeHtml(ctx.challengeName)}</strong> Work Order. The work you logged in ${escapeHtml(ctx.gameDisplayName)} demonstrated the practical mechanics; this section connects what you did to the deeper agricultural framework.</p>`,
      ctx.inferredFramework === 'USDA'
        ? '<p>This challenge is part of the USDA Beginning Farmer pathway and FFA agricultural skills curriculum.</p>'
        : '<p>The work you practiced applies to agricultural operations, equipment safety, and farm management.</p>',
      `<h3>What you demonstrated</h3>`,
      `<p>${escapeHtml(ctx.challengeDescription || 'You completed the challenge tasks on play.fgn.gg with verified evidence.')}</p>`,
      `<h3>Why it matters</h3>`,
      `<p>Modern farming combines mechanical operation with planning, record-keeping, and regulatory awareness. The Knowledge Check below tests the deeper "why" behind the equipment work.</p>`,
    ]),
  }),

  Construction_Sim: (ctx) => ({
    titleSuffix: 'Recap & Reinforcement',
    bodyHtml: htmlBlock([
      `<p>You've completed the <strong>${escapeHtml(ctx.challengeName)}</strong> Work Order. The runs you logged in ${escapeHtml(ctx.gameDisplayName)} demonstrated the practical mechanics; this section connects what you did to the deeper standards behind it.</p>`,
      ctx.inferredFramework === 'TIRAP'
        ? `<p>This challenge is grounded in the <strong>TIRAP Underground Utility Installer Technician</strong> credential pathway. The work you completed mirrors the field skills tracked under the Telecommunications Industry Registered Apprenticeship Program.</p>`
        : ctx.inferredFramework === 'OSHA'
          ? `<p>This challenge applies <strong>OSHA 1926 Subpart P</strong> excavation and construction safety standards. Your evidence connected each in-game action to the real standard.</p>`
          : `<p>The work you practiced maps to NCCER Heavy Equipment Operations and Site Operations curricula.</p>`,
      ctx.cfrReference
        ? `<p><em>Standard reference: ${escapeHtml(ctx.cfrReference)}</em></p>`
        : '',
      `<h3>What you demonstrated</h3>`,
      `<p>${escapeHtml(ctx.challengeDescription || 'You completed the challenge tasks on play.fgn.gg with verified evidence.')}</p>`,
      `<h3>Why it matters</h3>`,
      `<p>Site safety and operational discipline are the foundation of every credential pathway in heavy construction. The Knowledge Check below tests whether you can apply the same standards to scenarios outside the challenge.</p>`,
    ]),
  }),

  Mechanic_Sim: (ctx) => ({
    titleSuffix: 'Recap & Reinforcement',
    bodyHtml: htmlBlock([
      `<p>You've completed the <strong>${escapeHtml(ctx.challengeName)}</strong> Work Order. The diagnostic and repair work you logged in ${escapeHtml(ctx.gameDisplayName)} demonstrated the practical mechanics; this section connects what you did to NCCER Automotive and ASE certification frameworks.</p>`,
      `<h3>What you demonstrated</h3>`,
      `<p>${escapeHtml(ctx.challengeDescription || 'You completed the challenge tasks on play.fgn.gg with verified evidence.')}</p>`,
      `<h3>Why it matters</h3>`,
      `<p>Diagnostic reasoning matters more than the wrench-turn itself — knowing WHY a fix works is what separates a passing run from an exemplary one. The Knowledge Check below tests that reasoning layer.</p>`,
    ]),
  }),

  Roadcraft: (ctx) => ({
    titleSuffix: 'Recap & Reinforcement',
    bodyHtml: htmlBlock([
      `<p>You've completed the <strong>${escapeHtml(ctx.challengeName)}</strong> Work Order. The site-rehab work you logged in ${escapeHtml(ctx.gameDisplayName)} demonstrated the practical mechanics; this section connects what you did to disaster recovery and infrastructure restoration practice.</p>`,
      `<h3>What you demonstrated</h3>`,
      `<p>${escapeHtml(ctx.challengeDescription || 'You completed the challenge tasks on play.fgn.gg with verified evidence.')}</p>`,
      `<h3>Why it matters</h3>`,
      `<p>Recovery work is high-pressure and triage-driven. The Knowledge Check below tests prioritization reasoning and standard-of-care decisions in scenarios beyond the challenge.</p>`,
    ]),
  }),

  Fiber_Tech: (ctx) => ({
    titleSuffix: 'Recap & Reinforcement',
    bodyHtml: htmlBlock([
      `<p>You've completed the <strong>${escapeHtml(ctx.challengeName)}</strong> Work Order. The simulation work you logged on the FBA OpTIC Path platform demonstrated the practical mechanics; this section connects what you did to the certification framework.</p>`,
      `<p>OpTIC Path is the Fiber Broadband Association's credential pathway for fiber broadband technicians. Each challenge maps to a specific competency in the FBA OpTIC certifications (Connect, Tech, Pro).</p>`,
      `<h3>What you demonstrated</h3>`,
      `<p>${escapeHtml(ctx.challengeDescription || 'You completed the challenge tasks with verified evidence.')}</p>`,
      `<h3>Why it matters</h3>`,
      `<p>Fiber installation and maintenance are precision trades — small errors cost large repairs. The Knowledge Check below tests the standards-and-procedures layer beneath the hands-on work.</p>`,
    ]),
  }),
};

function htmlBlock(parts: string[]): string {
  return parts.filter(Boolean).join('\n');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
