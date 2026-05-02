import { useState } from 'react';
import type { BrandMode } from '@fgn/brand-tokens';

/**
 * FGN wordmark — the official brand mark, with image-or-text fallback.
 *
 * Logo files live in @fgn/brand-tokens/assets/ and are copied into every
 * SCORM package by the packager (apps/reference-package/build.mjs and,
 * later, @fgn/scorm-builder). The Player references them via the relative
 * path `./assets/logo-fgn-wordmark-{white|ink}.svg` — the path is identical
 * inside SCORM ZIPs and during local Vite dev (where a prebuild step
 * copies the files into `public/assets/`).
 *
 * If the SVG fails to load (legacy LMS strips SVG, or the asset path is
 * wrong for some reason), the typographic fallback renders so the chrome
 * never looks broken. Brand-guide rules are preserved either way: white
 * on dark in Arcade, ink on light in Enterprise.
 */
const LOGO_SRC: Record<BrandMode, string> = {
  arcade: './assets/logo-fgn-wordmark-white.svg',
  enterprise: './assets/logo-fgn-wordmark-ink.svg',
};

export function Wordmark({
  mode,
  className = '',
}: {
  mode: BrandMode;
  className?: string;
}) {
  const [errored, setErrored] = useState(false);

  if (errored) {
    const fontClass = mode === 'arcade' ? 'font-display' : 'font-body';
    return (
      <span
        className={`${fontClass} text-2xl font-black tracking-tight text-foreground ${className}`}
        aria-label="FGN"
      >
        FGN
      </span>
    );
  }

  return (
    <img
      src={LOGO_SRC[mode]}
      alt="FGN"
      className={`h-8 w-auto ${className}`}
      onError={() => setErrored(true)}
    />
  );
}
