import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { applyMode, detectMode } from '@fgn/brand-tokens';
import '@fgn/brand-tokens/tokens.css';
import './styles.css';
import { App } from './App';
import type { CourseManifest } from './types';

/**
 * SCORM Player bootstrap.
 *
 * Loads course.json from alongside index.html in the package, applies
 * the destination-driven brand mode (Arcade or Enterprise — no tenant
 * overrides; SCORM packages are FGN-canonical), then mounts the App.
 * If course.json is missing or invalid, renders an error screen but
 * still keeps the SCORM API session open so the LMS doesn't lose track
 * of the attempt.
 */
async function bootstrap() {
  const root = document.getElementById('root');
  if (!root) throw new Error('No #root element found in index.html');

  const course = await loadCourse();
  if (!course) {
    renderError(root, 'Could not load course.json.');
    return;
  }

  applyMode(course.brandMode ?? detectMode());
  document.title = course.title;

  createRoot(root).render(
    <StrictMode>
      <App course={course} />
    </StrictMode>,
  );
}

async function loadCourse(): Promise<CourseManifest | null> {
  try {
    const res = await fetch('./course.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as CourseManifest;
    if (data.schemaVersion !== 1) {
      console.error(
        `[scorm-player] Unsupported course.json schemaVersion ${data.schemaVersion}. Expected 1.`,
      );
      return null;
    }
    return data;
  } catch (err) {
    console.error('[scorm-player] Failed to load course.json', err);
    return null;
  }
}

function renderError(root: HTMLElement, message: string) {
  root.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:Inter,sans-serif;background:#0B0F14;color:#E9EDED;">
      <div style="max-width:32rem;padding:2rem;text-align:center;">
        <h1 style="font-family:Orbitron,sans-serif;font-size:1.5rem;margin-bottom:1rem;">Course unavailable</h1>
        <p style="opacity:0.7;">${message}</p>
      </div>
    </div>
  `;
}

void bootstrap();
