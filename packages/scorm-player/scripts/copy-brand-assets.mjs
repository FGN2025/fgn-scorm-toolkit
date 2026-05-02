// Copies @fgn/brand-tokens logo SVGs into public/assets so Vite serves
// them at ./assets/* during dev and includes them in the build output.
//
// The Wordmark component references logos via relative path
//   ./assets/logo-fgn-wordmark-{white|ink}.svg
// and the same paths exist inside SCORM ZIPs (the packager copies them
// to the same location), so the Player works identically in dev and in
// a deployed package.

import { mkdir, copyFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const playerRoot = resolve(__dirname, '..');
const brandAssets = resolve(playerRoot, '../brand-tokens/assets');
const publicAssets = resolve(playerRoot, 'public/assets');

await mkdir(publicAssets, { recursive: true });

let copied = 0;
for (const f of await readdir(brandAssets)) {
  if (!f.endsWith('.svg') && !f.endsWith('.png')) continue;
  const src = join(brandAssets, f);
  const dst = join(publicAssets, f);
  const s = await stat(src);
  if (!s.isFile()) continue;
  await copyFile(src, dst);
  copied += 1;
}

console.log(`[copy-brand-assets] Copied ${copied} brand asset(s) -> ${publicAssets}`);
