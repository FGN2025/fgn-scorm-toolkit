// Reference-package build script.
//
// Uses @fgn/scorm-builder.packageCourse() to assemble the SCORM ZIP
// in-memory via JSZip, then writes the buffer to disk in one call.
// This avoids system-zip / PowerShell Compress-Archive collisions with
// Dropbox sync that we hit during initial bring-up.

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { packageCourse } from '@fgn/scorm-builder';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = __dirname;
const playerDist = resolve(root, '../../packages/scorm-player/dist');
const brandAssets = resolve(root, '../../packages/brand-tokens/assets');
const dist = resolve(root, 'dist');

async function main() {
  await mkdir(dist, { recursive: true });

  // Verify the player has been built.
  const playerIndex = join(playerDist, 'index.html');
  try {
    await stat(playerIndex);
  } catch {
    console.error(
      `[reference-package] @fgn/scorm-player not built. Run \`pnpm --filter @fgn/scorm-player build\` first.`,
    );
    process.exit(1);
  }

  // Read everything we need.
  const courseJson = await readFile(join(root, 'course.json'), 'utf8');
  const course = JSON.parse(courseJson);
  const playerHtml = await readFile(playerIndex, 'utf8');
  const whiteSvg = await readFile(join(brandAssets, 'logo-fgn-wordmark-white.svg'), 'utf8');
  const inkSvg = await readFile(join(brandAssets, 'logo-fgn-wordmark-ink.svg'), 'utf8');

  console.log(`[reference-package] Packaging "${course.title}" (${course.modules.length} modules)…`);
  const result = await packageCourse({
    course,
    playerHtml,
    brandAssets: { whiteSvg, inkSvg },
  });

  const zipPath = join(dist, 'fgn-cs-fiber-trench.zip');
  await writeFile(zipPath, result.zip);

  console.log(`[reference-package] Built ${zipPath}`);
  console.log(`  Size: ${result.zip.byteLength.toLocaleString()} bytes`);
  console.log(`  Files in ZIP:`);
  for (const f of result.files) console.log(`    - ${f}`);
  console.log(`\n[reference-package] Validate at https://cloud.scorm.com/sc/guest/SignInForm`);
}

main().catch((err) => {
  console.error('[reference-package] Build failed:', err);
  process.exit(1);
});
