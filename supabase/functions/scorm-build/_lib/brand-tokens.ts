/**
 * Minimal Deno-runnable shim of @fgn/brand-tokens.
 *
 * Only the build-time exports the SCORM builder needs. The original
 * module also has DOM-aware helpers (detectMode, applyMode,
 * applyTenantOverrides, localStorage) that don't run in Deno — they're
 * not needed for server-side SCORM building.
 *
 * If the toolkit's brand-tokens module changes, this shim must be
 * re-synced.
 */

export type BrandMode = 'arcade' | 'enterprise';

export type ScormDestination =
  | 'play-fgn-gg'
  | 'fgn-academy'
  | 'broadbandworkforce'
  | 'skill-truck-path'
  | 'fgn-business'
  | 'external-lms';

/**
 * Destination -> mode mapping. Locked from the FGN brand guide.
 * Player-audience destinations get Arcade; everything else gets
 * Enterprise.
 */
export const destinationToMode: Record<ScormDestination, BrandMode> = {
  'play-fgn-gg': 'arcade',
  'fgn-academy': 'arcade',
  'broadbandworkforce': 'enterprise',
  'skill-truck-path': 'enterprise',
  'fgn-business': 'enterprise',
  'external-lms': 'enterprise',
};

/**
 * Map a credential framework label to its FGN brand pillar id. Pillar
 * colors are immutable across all properties (per Brand Guide v2 §2).
 */
export const credentialFrameworkToPillar: Record<string, 'perf' | 'play' | 'path' | 'fiber'> = {
  CDL: 'path',
  NCCER: 'perf',
  OSHA: 'path',
  TIRAP: 'fiber',
  'OpTIC Path': 'fiber',
  FFA: 'play',
  USDA: 'play',
  ASE: 'perf',
  Rarity: 'play',
};
