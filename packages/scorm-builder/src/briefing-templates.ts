/**
 * Per-game briefing templates.
 *
 * Each game gets a tailored "Why this matters" briefing slide that the
 * transformer auto-generates ahead of the challenge module. The
 * template interpolates challenge-specific fields and emphasizes the
 * real-world skill the challenge is grounded in.
 *
 * Templates are intentionally data-driven (not code-branched) so that
 * adding a new game / framework is a content edit, not a code change.
 * Override per challenge by passing `templateOverride` to transform()
 * — the admin's manual briefing wins over the auto-generated one.
 */

import type { GameTitle } from '@fgn/course-types';
import type { FetchedChallenge } from './play-types.js';

export interface BriefingTemplate {
  /** Title for the auto-briefing slide. */
  title: string;
  /** Sanitized HTML body. The transformer interpolates from the challenge. */
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

/**
 * Build a briefing for a fetched challenge. Picks the per-game template
 * and interpolates challenge-specific values.
 */
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
    title: 'Why this matters',
    bodyHtml: htmlBlock([
      `<p>${escapeHtml(ctx.challengeDescription || `${ctx.challengeName} runs in ${ctx.gameDisplayName}.`)}</p>`,
      ctx.cdlDomain
        ? `<p>This challenge maps to the FMCSA <strong>${escapeHtml(ctx.cdlDomain)}</strong> CDL knowledge domain. The skills you demonstrate here translate directly to a Class A or Class B commercial driver examination.</p>`
        : '',
      ctx.certificationDescription
        ? `<p><em>${escapeHtml(ctx.certificationDescription)}</em></p>`
        : '',
      `<h3>What you'll need</h3>`,
      `<ul>`,
      `<li>${escapeHtml(ctx.gameDisplayName)} installed and signed in</li>`,
      `<li>A way to capture screenshots and short video clips for evidence</li>`,
      ctx.estimatedMinutes
        ? `<li>About ${ctx.estimatedMinutes} minutes of focused playtime</li>`
        : '',
      `</ul>`,
    ]),
  }),

  Farming_Sim: (ctx) => ({
    title: 'Why this matters',
    bodyHtml: htmlBlock([
      `<p>${escapeHtml(ctx.challengeDescription || `${ctx.challengeName} runs in ${ctx.gameDisplayName}.`)}</p>`,
      `<p>${ctx.inferredFramework === 'USDA' ? 'This challenge is part of the USDA Beginning Farmer pathway and FFA agricultural skills curriculum.' : 'Skills practiced here apply to agricultural operations, equipment safety, and farm management.'}</p>`,
      `<h3>What you'll need</h3>`,
      `<ul>`,
      `<li>${escapeHtml(ctx.gameDisplayName)} installed (and any required DLC for specific equipment)</li>`,
      `<li>Screenshot/video capture for evidence</li>`,
      ctx.estimatedMinutes
        ? `<li>About ${ctx.estimatedMinutes} minutes of focused playtime</li>`
        : '',
      `</ul>`,
    ]),
  }),

  Construction_Sim: (ctx) => ({
    title: 'Why this matters',
    bodyHtml: htmlBlock([
      `<p>${escapeHtml(ctx.challengeDescription || `${ctx.challengeName} runs in ${ctx.gameDisplayName}.`)}</p>`,
      ctx.inferredFramework === 'TIRAP'
        ? `<p>This challenge is grounded in the <strong>TIRAP Underground Utility Installer Technician</strong> credential pathway. The work you do here mirrors the field skills tracked under the Telecommunications Industry Registered Apprenticeship Program.</p>`
        : ctx.inferredFramework === 'OSHA'
          ? `<p>This challenge applies <strong>OSHA 1926 Subpart P</strong> excavation and construction safety standards. Your evidence should connect each in-game action to the real standard.</p>`
          : `<p>Construction Simulator scenarios in this challenge map to NCCER Heavy Equipment Operations and Site Operations curricula.</p>`,
      ctx.cfrReference
        ? `<p><em>Standard reference: ${escapeHtml(ctx.cfrReference)}</em></p>`
        : '',
      `<h3>What you'll need</h3>`,
      `<ul>`,
      `<li>${escapeHtml(ctx.gameDisplayName)} installed and signed in</li>`,
      `<li>A way to capture screenshots and short video clips for evidence</li>`,
      ctx.estimatedMinutes
        ? `<li>About ${ctx.estimatedMinutes} minutes of focused playtime</li>`
        : '',
      `</ul>`,
    ]),
  }),

  Mechanic_Sim: (ctx) => ({
    title: 'Why this matters',
    bodyHtml: htmlBlock([
      `<p>${escapeHtml(ctx.challengeDescription || `${ctx.challengeName} runs in ${ctx.gameDisplayName}.`)}</p>`,
      `<p>Diagnostic, repair, and maintenance procedures practiced here align with NCCER Automotive Service Technology and ASE certification frameworks. Capturing your reasoning — not just the action — is what separates a passing run from an exemplary one.</p>`,
      `<h3>What you'll need</h3>`,
      `<ul>`,
      `<li>${escapeHtml(ctx.gameDisplayName)} installed and signed in</li>`,
      `<li>Screenshot/video capture for evidence</li>`,
      ctx.estimatedMinutes
        ? `<li>About ${ctx.estimatedMinutes} minutes of focused playtime</li>`
        : '',
      `</ul>`,
    ]),
  }),

  Roadcraft: (ctx) => ({
    title: 'Why this matters',
    bodyHtml: htmlBlock([
      `<p>${escapeHtml(ctx.challengeDescription || `${ctx.challengeName} runs in ${ctx.gameDisplayName}.`)}</p>`,
      `<p>Roadcraft scenarios emphasize site rehabilitation, heavy hauling, and infrastructure restoration — work patterns common to disaster recovery and utility maintenance crews.</p>`,
      `<h3>What you'll need</h3>`,
      `<ul>`,
      `<li>${escapeHtml(ctx.gameDisplayName)} installed and signed in</li>`,
      `<li>Screenshot/video capture for evidence</li>`,
      ctx.estimatedMinutes
        ? `<li>About ${ctx.estimatedMinutes} minutes of focused playtime</li>`
        : '',
      `</ul>`,
    ]),
  }),

  Fiber_Tech: (ctx) => ({
    title: 'Why this matters',
    bodyHtml: htmlBlock([
      `<p>${escapeHtml(ctx.challengeDescription || `${ctx.challengeName} is part of the OpTIC Path simulation pathway.`)}</p>`,
      `<p>OpTIC Path is the Fiber Broadband Association's certification framework for fiber broadband technicians. Each challenge here maps to a specific competency in the FBA OpTIC certifications (Connect, Tech, Pro).</p>`,
      `<h3>What you'll need</h3>`,
      `<ul>`,
      `<li>Access to the OpTIC Path simulation environment</li>`,
      `<li>Screenshot/video capture for evidence</li>`,
      ctx.estimatedMinutes
        ? `<li>About ${ctx.estimatedMinutes} minutes of focused work</li>`
        : '',
      `</ul>`,
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
