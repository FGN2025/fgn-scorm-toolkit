import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * The SCORM Player builds to a single self-contained HTML file.
 *
 * SCORM 1.2 packages are zipped directories that LMSs unpack and serve
 * statically. We could ship multiple JS/CSS chunks, but a single inlined
 * HTML simplifies the manifest <file> list and dodges LMS quirks around
 * relative path handling. The bundle target stays under 500 KB gzipped
 * even with everything inlined.
 *
 * The course.json manifest lives next to index.html in the package and is
 * fetched at runtime — keeping it external makes courses reusable
 * without rebuilding the player.
 */
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    target: 'es2020',
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000, // inline everything
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        manualChunks: undefined,
      },
    },
  },
});
