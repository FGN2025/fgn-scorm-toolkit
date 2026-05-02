# @fgn/brand-tokens

The single source of truth for FGN's visual identity inside SCORM packages and any consumer that adopts this toolkit. Mirrors the play.fgn.gg `tailwind.config.ts` and the official FGN Brand Guide.

## What's in here

- **`src/tokens.css`** — CSS custom properties for both Arcade and Enterprise modes. The runtime authority.
- **`src/tokens.ts`** — TypeScript constants mirroring the same values for compile-time use.
- **`src/modes.ts`** — Mode detection, application, persistence, and tenant override helpers.
- **`src/tailwind-preset.ts`** — Tailwind preset matching play.fgn.gg's config.
- **`assets/`** — Logo SVG/PNG drops (see `assets/README.md`).

## Two modes, one palette

| Mode | Surface | Primary CTA | Typography | Effects |
|---|---|---|---|---|
| **Arcade** | `fgn.ink` (#0B0F14) | cyan (Play pillar) | Orbitron + Rajdhani + Inter | neon glow |
| **Enterprise** | `fgn.cloud` (#F6F8FB) | violet (Perf pillar) | Inter only | elevation shadows |

Pillar colors are immutable: Performance=violet, Play=cyan, Pathways=amber, Fiber=azure.

## Usage

### In a Vite/React app

```ts
// tailwind.config.ts
import fgnPreset from '@fgn/brand-tokens/tailwind-preset';

export default {
  presets: [fgnPreset],
  content: ['./src/**/*.{ts,tsx}'],
};
```

```ts
// main.tsx
import '@fgn/brand-tokens/tokens.css';
import { applyMode, detectMode } from '@fgn/brand-tokens';

applyMode(detectMode());
```

### Inside a SCORM package

The brand mode is decided at build time from the course destination and frozen into the package's `<html>` class. Detection is still helpful for previewing, but at runtime in a deployed package the class is already set.

```ts
import { destinationToMode, applyMode } from '@fgn/brand-tokens';

const mode = destinationToMode['broadbandworkforce']; // 'enterprise'
applyMode(mode);
```

### Tenant white-labels — for live FGN surfaces only, NOT SCORM

Per the brand guide, **only `--brand-primary` and `--brand-secondary` are overridable**. Pillar tokens are locked.

```ts
import { applyTenantOverrides } from '@fgn/brand-tokens';

applyTenantOverrides({
  primary: '#FF6B35',   // a tenant's accent
  secondary: '#1B4965',
});
```

**Important scope:** this utility exists for *live* multi-tenant FGN surfaces — e.g. broadbandworkforce.com showing employer branding inside a provider portal session. SCORM packages exported from this toolkit are **FGN-canonical artifacts** and do not use the tenant override path. The Player does not call `applyTenantOverrides` and `course.json` has no `brandOverrides` field. Brand mode (Arcade vs Enterprise) is the only variation, driven entirely by the export destination.

## Tokens at a glance

```css
/* Pillar locks (always) */
--brand-pillar-perf:  262 83% 58%;   /* violet */
--brand-pillar-play:  180 100% 42%;  /* cyan */
--brand-pillar-path:  38 92% 50%;    /* amber */
--brand-pillar-fiber: 214 100% 59%;  /* azure */

/* Radii */
--radius:        0.5rem;    /* 8px base */
--radius-card:   0.75rem;   /* 12px */
--radius-button: 0.625rem;  /* 10px */
```

## Build

```bash
pnpm --filter @fgn/brand-tokens build
```

## Versioning

Bump major when token names or semantics change. Bump minor for additive changes (new tokens, new helpers). Bump patch for fixes that don't change consumer-visible values.

## Notes

- The `credentialFrameworkToPillar` mapping in `tokens.ts` is provisional. The canonical credential -> pillar matrix lives on fgn.business; pull from there once accessible.
- Logo SVGs in `assets/` are placeholders — drop the official files in (see `assets/README.md`).
