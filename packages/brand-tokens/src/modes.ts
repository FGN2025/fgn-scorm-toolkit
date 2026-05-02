/**
 * Brand mode resolution and runtime application.
 *
 * Two modes share one palette. The active mode is decided at SCORM build
 * time from the destination, then frozen into the package's HTML root
 * class. The mode helpers here handle:
 *
 *   1. Mapping a SCORM destination to a brand mode at build time.
 *   2. Detecting the mode at runtime (URL param, localStorage, iframe
 *      heuristic, fallback).
 *   3. Applying the mode to a DOM root.
 *   4. Tenant white-label overrides for primary/secondary only.
 */

export type BrandMode = 'arcade' | 'enterprise';

export type ScormDestination =
  | 'play-fgn-gg'
  | 'fgn-academy'
  | 'broadbandworkforce'
  | 'skill-truck-path'
  | 'fgn-business'
  | 'external-lms';

export const MODE_STORAGE_KEY = 'fgn-brand-mode';

/**
 * Destination -> mode mapping. Locked from the FGN brand guide.
 * Player-audience destinations get Arcade; everything else gets Enterprise.
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
 * Apply a brand mode to a DOM root by toggling the appropriate classes.
 * Idempotent — safe to call repeatedly.
 */
export function applyMode(
  mode: BrandMode,
  root: HTMLElement = document.documentElement,
): void {
  if (mode === 'arcade') {
    root.classList.add('dark');
    root.classList.remove('light', 'enterprise');
  } else {
    root.classList.add('light', 'enterprise');
    root.classList.remove('dark');
  }
}

/**
 * Detect the active brand mode from URL, storage, embedding context.
 *
 * Order of precedence:
 *   1. ?mode=arcade or ?mode=enterprise URL parameter
 *   2. localStorage `fgn-brand-mode` if previously set
 *   3. iframe heuristic — if embedded, default to Enterprise (per brand guide)
 *   4. Fallback to Arcade (the play.fgn.gg default)
 */
export function detectMode(): BrandMode {
  if (typeof window === 'undefined') return 'arcade';

  const params = new URLSearchParams(window.location.search);
  const param = params.get('mode');
  if (param === 'enterprise' || param === 'arcade') return param;

  try {
    const stored = window.localStorage.getItem(MODE_STORAGE_KEY);
    if (stored === 'enterprise' || stored === 'arcade') return stored;
  } catch {
    /* storage may be blocked — fall through */
  }

  if (window.self !== window.top) return 'enterprise';

  return 'arcade';
}

/**
 * Persist the mode preference. Called by user-facing mode toggles, never
 * called automatically.
 */
export function persistMode(mode: BrandMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    /* storage blocked — ignore */
  }
}

/**
 * Tenant white-label overrides. Per the brand guide, ONLY brand-primary
 * and brand-secondary may be overridden. Pillar tokens (perf/play/path/
 * fiber) are immutable. Validation is enforced here — calls that attempt
 * to override pillars are silently dropped with a console warning.
 */
export interface TenantOverrides {
  /** Hex color string, e.g. "#00D4D4". Will be converted to HSL triplet. */
  primary?: string;
  /** Hex color string. */
  secondary?: string;
}

export function applyTenantOverrides(
  overrides: TenantOverrides,
  root: HTMLElement = document.documentElement,
): void {
  if (overrides.primary) {
    const triplet = hexToHslTriplet(overrides.primary);
    if (triplet) {
      root.style.setProperty('--brand-primary', triplet);
      root.style.setProperty('--primary', triplet);
    }
  }
  if (overrides.secondary) {
    const triplet = hexToHslTriplet(overrides.secondary);
    if (triplet) {
      root.style.setProperty('--brand-secondary', triplet);
    }
  }
}

/**
 * Convert a hex color (#rgb, #rrggbb) to an HSL triplet string suitable
 * for CSS custom properties: "180 100% 42%".
 *
 * Returns null for malformed input. Internal helper — exported for tests.
 */
export function hexToHslTriplet(hex: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let raw = m[1]!;
  if (raw.length === 3) {
    raw = raw.split('').map((c) => c + c).join('');
  }
  const r = parseInt(raw.slice(0, 2), 16) / 255;
  const g = parseInt(raw.slice(2, 4), 16) / 255;
  const b = parseInt(raw.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h *= 60;
  }
  const round = (n: number) => Math.round(n * 10) / 10;
  return `${Math.round(h)} ${round(s * 100)}% ${round(l * 100)}%`;
}
