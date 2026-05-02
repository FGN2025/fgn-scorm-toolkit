/**
 * @fgn/brand-tokens — TypeScript-side token constants.
 *
 * Mirrors the values in tokens.css so consumers can read the palette
 * programmatically (e.g. for chart libraries, runtime overrides,
 * documentation generators).
 *
 * Values here MUST stay in sync with tokens.css. The tokens.css file is
 * authoritative for runtime styling; this file is authoritative for
 * compile-time TypeScript usage.
 */

export type HslTriplet = `${number} ${number}% ${number}%`;
export type Hex = `#${string}`;

export interface PillarToken {
  readonly id: 'perf' | 'play' | 'path' | 'fiber';
  readonly name: 'Performance' | 'Play' | 'Pathways' | 'Fiber';
  readonly hsl: HslTriplet;
  readonly hex: Hex;
  readonly cssVar: string;
}

/**
 * The four FGN brand pillars. These colors are immutable across all
 * properties, all modes, and all tenant white-labels. Never override.
 */
export const pillars: Record<PillarToken['id'], PillarToken> = {
  perf: {
    id: 'perf',
    name: 'Performance',
    hsl: '262 83% 58%',
    hex: '#7C3AED',
    cssVar: '--brand-pillar-perf',
  },
  play: {
    id: 'play',
    name: 'Play',
    hsl: '180 100% 42%',
    hex: '#00D4D4',
    cssVar: '--brand-pillar-play',
  },
  path: {
    id: 'path',
    name: 'Pathways',
    hsl: '38 92% 50%',
    hex: '#F59E0B',
    cssVar: '--brand-pillar-path',
  },
  fiber: {
    id: 'fiber',
    name: 'Fiber',
    hsl: '214 100% 59%',
    hex: '#2E8BFF',
    cssVar: '--brand-pillar-fiber',
  },
} as const;

/**
 * The two surface colors. fgn.ink is the dark surface (Arcade), fgn.cloud
 * is the light surface (Enterprise).
 */
export const surfaces = {
  ink: { hsl: '216 28% 6%' as HslTriplet, hex: '#0B0F14' as Hex },
  cloud: { hsl: '214 27% 97%' as HslTriplet, hex: '#F6F8FB' as Hex },
} as const;

/**
 * Status colors — immutable across modes.
 */
export const status = {
  success: { hsl: '142 71% 45%' as HslTriplet, hex: '#22C55E' as Hex },
  warning: { hsl: '38 92% 50%' as HslTriplet, hex: '#F59E0B' as Hex },
  destructive: { hsl: '0 72% 51%' as HslTriplet, hex: '#EF4444' as Hex },
} as const;

/**
 * Border radii. Card and button get distinct values per the brand guide.
 */
export const radii = {
  base: '0.5rem',     // 8px
  card: '0.75rem',    // 12px
  button: '0.625rem', // 10px
  full: '9999px',
} as const;

/**
 * Font stacks for each role. Arcade mode uses all three; Enterprise mode
 * uses Inter for everything.
 */
export const fonts = {
  display: ['Orbitron', 'sans-serif'] as const,
  heading: ['Rajdhani', 'sans-serif'] as const,
  body: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'] as const,
} as const;

/**
 * Map a credential framework to a default pillar. The Course Builder uses
 * this to pick a pillar accent automatically when an admin attaches a
 * challenge to a course. Authors can override.
 *
 * NOTE: This mapping is provisional. The canonical credential -> pillar
 * matrix lives on fgn.business. Pull from there once accessible and
 * replace this dictionary.
 */
export const credentialFrameworkToPillar: Record<string, PillarToken['id']> = {
  CDL: 'path',
  NCCER: 'perf',
  OSHA: 'path',
  TIRAP: 'fiber',
  // Fiber Broadband Association OpTIC Path — the FBA's fiber-tech
  // certification pathway. Sits in the fiber pillar alongside TIRAP.
  'OpTIC Path': 'fiber',
  FFA: 'play',
  USDA: 'play',
  // Automotive frameworks for Mechanic_Sim challenges. Specific framework
  // (NCCER Automotive vs ASE) is admin-selected per challenge.
  ASE: 'perf',
  Rarity: 'play',
};
