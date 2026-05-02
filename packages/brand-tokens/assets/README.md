# Logo assets

The FGN wordmark — single master mark, two surface variants per the brand guide.

Drop the official files here. Required filenames:

| File | Use |
|---|---|
| `logo-fgn-wordmark-white.svg` | On dark surfaces (Arcade mode) |
| `logo-fgn-wordmark-ink.svg` | On light surfaces (Enterprise mode) |
| `logo-fgn-wordmark-white.png` | PNG fallback for legacy LMSs that strip SVG |
| `logo-fgn-wordmark-ink.png` | PNG fallback, light variant |

PNG fallbacks should be ~512px wide, transparent background, 2x density.

## Brand-guide rules (enforced)

- Never recolor the mark to an accent color.
- Minimum clear space: 1x the height of the "G" on all sides.
- White on dark surfaces. Ink (#0B0F14) on light surfaces. Never reverse.

## How the SCORM Player picks

The Player reads the active brand mode and selects the right variant automatically:

```ts
import whiteLogo from '@fgn/brand-tokens/assets/logo-fgn-wordmark-white.svg';
import inkLogo from '@fgn/brand-tokens/assets/logo-fgn-wordmark-ink.svg';

const logo = mode === 'arcade' ? whiteLogo : inkLogo;
```

SCORM packages are FGN-canonical — no per-course logo overrides. The mark in every package is the FGN wordmark, sized and surfaced per brand-guide rules.
