import type { Config } from 'tailwindcss';
import fgnPreset from '@fgn/brand-tokens/tailwind-preset';

export default {
  presets: [fgnPreset],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
} satisfies Config;
