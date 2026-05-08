/**
 * scorm-build -- fgn.academy edge function for the Course Builder UI.
 *
 * Phase 2 v0 spec: docs/PHASE_2_SPEC.md in the FGN SCORM toolkit repo.
 *
 * STATUS: Step 4.5 -- transform + storage + DB upsert + ZIP packaging.
 *
 * What this function does:
 *   - Validates the request shape (workOrderId UUID, destination /
 *     brandMode enums, image-options-imply-enhanceCover)
 *   - Authenticates the caller via the standard Supabase session JWT
 *     (Authorization: Bearer <token>)
 *   - Checks the calling user has admin or super_admin in user_roles
 *   - Looks up the source Work Order, confirms is_active and a
 *     source_challenge_id is present
 *   - Looks up any existing scorm_courses row at (workOrderId,
 *     destination) -- the response carries isReplacement so the UI
 *     can show a confirmation modal
 *   - Runs transform() against play.fgn.gg, fetching the challenge
 *     and the curated cover_image_url passthrough (Phase 1.4.5.1)
 *   - Uploads course.json + assets/ to media-assets/scorm-courses/
 *     <courseId>/ via service role
 *   - INSERT or UPDATE the scorm_courses row (replacement uses the
 *     existing id; new build uses crypto.randomUUID()). is_published
 *     defaults to true so the Learning Resource card renders right
 *     after publish.
 *   - Returns { courseId, manifestUrl, zipUrl: null, playerUrl,
 *     workOrderUrl, coverImageUrl, title, isReplacement, warnings }
 *
 * Step 4.5 ZIP packaging notes:
 *   - Uses redirect-style ZIP (index.html redirects to fgn.academy
 *     native player) rather than self-contained. Avoids needing to
 *     bundle the ~1MB compiled @fgn/scorm-player HTML into every
 *     build. Trade-off: SCORM API progress tracking doesn't work
 *     cross-origin; LMS sees content but can't track lesson progress
 *     through the standard SCORM API. Phase 2.x adds a self-contained
 *     ZIP variant for full SCORM 1.2 conformance.
 *   - ZIP packaging failure is non-fatal: the course is still
 *     published, the native player still works, only the download
 *     button on external destinations is unavailable.
 *
 * Not yet wired -- coming in subsequent steps:
 *   - Step 5: enhance() text slots (description / briefingHtml /
 *     quizQuestions) when enhanceText=true. Anthropic key required.
 *   - Step 6: enhance() coverImage slot when enhanceCover=true.
 *     OpenAI key required. Replaces the passthrough cover.
 *
 * Deploy on FGN2025/stratify-workforce. Same Lovable-managed Supabase
 * project as scorm-publish, scorm-launch-status, media-upload.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { transform } from './_lib/scorm-builder/transform.ts';
import {
  createSupabaseFetcher,
  type SupabaseLike,
} from './_lib/scorm-builder/fetcher.ts';
import { packageCourse } from './_lib/scorm-builder/pack.ts';
import type { ScormDestination } from './_lib/brand-tokens.ts';
import { enhanceCourse } from './_lib/course-enhancer/enhance.ts';
import type {
  ImageQuality,
  ImageSize,
} from './_lib/course-enhancer/openai-client.ts';
import type { QuizQuestion } from './_lib/course-types.ts';

// v0.1 -- briefing HTML sanitization. Strict allowlist matching the
// briefing prompt contract. Lovable also runs DOMPurify client-side
// for preview render fidelity; this server-side pass is the
// authoritative strip per the locked v0.1 contract (PHASE_2_SPEC.md
// §"HTML sanitization").
//
// Implementation note: an earlier draft used `npm:isomorphic-dompurify`,
// but that package depends on `jsdom` which has Node-native bindings
// Deno's npm: resolver can't load (function failed at module init,
// returning no CORS headers, browser saw "Failed to fetch"). Switched
// to a Deno-native regex sanitizer with the exact same allowlist
// semantics. The allowlist is narrow enough (6 tags, 0 attrs, all
// formatting-only) that a regex pass is correct and safe; no need
// for full HTML parsing or namespace awareness. Briefing HTML never
// includes images, scripts, SVG, or MathML; the prompt contract
// pins it to text-formatting tags only.
const SANITIZE_ALLOWED_TAGS = new Set(['p', 'strong', 'em', 'h3', 'ul', 'li']);
// "Block tags" are stripped along with their content. Matches DOMPurify's
// default behavior for unsafe content carriers -- the text inside
// <script> / <style> / <iframe> / etc. shouldn't leak as plain text
// after the tag is removed (executable in a script context, CSS rules
// in a style context, inline-attack-vector in iframes).
const SANITIZE_BLOCK_TAGS = ['script', 'style', 'iframe', 'noscript', 'object', 'embed', 'template', 'svg', 'math'];
const BLOCK_TAGS_RE = new RegExp(
  `<(${SANITIZE_BLOCK_TAGS.join('|')})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`,
  'gi',
);
// Unclosed block tags that still might appear (e.g., `<script>` without
// a closing tag): drop everything from the open tag to end of string.
const UNCLOSED_BLOCK_TAGS_RE = new RegExp(
  `<(${SANITIZE_BLOCK_TAGS.join('|')})\\b[^>]*>[\\s\\S]*$`,
  'gi',
);
const TAG_RE = /<([^>]+)>/g;
const TAG_NAME_RE = /^\/?([a-zA-Z][a-zA-Z0-9]*)/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

function sanitizeBriefingHtml(html: string): {
  sanitized: string;
  didStrip: boolean;
} {
  // 1. Strip control chars / null bytes.
  let s = html.replace(CONTROL_CHAR_RE, '');
  // 2. Strip block tags WITH their content (script, style, iframe, etc.).
  //    Two passes: closed first (greedy minimal match), then unclosed.
  s = s.replace(BLOCK_TAGS_RE, '');
  s = s.replace(UNCLOSED_BLOCK_TAGS_RE, '');
  // 3. For each remaining tag:
  //      - If the tag name isn't in the allowlist, drop the tag wrapper
  //        but keep text children (so e.g. `<div>hello</div>` -> `hello`).
  //      - If it is, emit just `<tagName>` or `</tagName>` -- attributes
  //        stripped (zero allowed attrs per spec).
  s = s.replace(TAG_RE, (_match, contents: string) => {
    const tagMatch = contents.match(TAG_NAME_RE);
    if (!tagMatch) return ''; // malformed tag-like string, strip
    const tagName = tagMatch[1]!.toLowerCase();
    if (!SANITIZE_ALLOWED_TAGS.has(tagName)) return '';
    const isClosing = contents.trimStart().startsWith('/');
    return isClosing ? `</${tagName}>` : `<${tagName}>`;
  });
  return { sanitized: s, didStrip: s.length < html.length };
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Allowed values, mirroring the @fgn/brand-tokens shim and the
// scorm_courses CHECK constraint. Keep in sync with both.
const ALLOWED_DESTINATIONS = new Set([
  'fgn-academy',
  'broadband-workforce',
  'simu-cdl-path',
  'external-lms',
]);

const ALLOWED_BRAND_MODES = new Set(['arcade', 'enterprise']);

const ALLOWED_SCORM_VERSIONS = new Set(['1.2', 'cmi5']);

const ALLOWED_IMAGE_QUALITIES = new Set(['low', 'medium', 'high']);

const ALLOWED_IMAGE_SIZES = new Set([
  '1024x1024',
  '1024x1536',
  '1536x1024',
]);

const ADMIN_ROLES = new Set(['admin', 'super_admin']);

interface BuildRequest {
  workOrderId: string;
  destination: string;
  brandMode: string;
  scormVersion?: string;
  title?: string;
  description?: string;
  enhanceText?: boolean;
  enhanceCover?: boolean;
  imageQuality?: string;
  imageSize?: string;
  imageModel?: string;
  uploadCoverToAcademy?: boolean;

  // v0.1 manual text override fields. See PHASE_2_SPEC.md §"v0.1
  // coordination contract — manual text override".

  /**
   * If true, run transform + enhance and return the resulting
   * CourseManifest in the response without writing to storage /
   * scorm_courses / ZIP. Used by the Course Builder UI to show admin
   * a preview before publish. Default: false.
   */
  dryRun?: boolean;

  /**
   * Per-module HTML overrides for briefing modules, keyed by module
   * id. When provided, the override is sanitized server-side and
   * applied to the manifest BEFORE enhance, and that module's id
   * goes into the enhancer's skipModuleIds so it isn't regenerated.
   */
  briefingHtml?: Record<string, string>;

  /**
   * Per-module quiz question overrides, keyed by quiz module id.
   * Each value is a complete replacement of the module's questions
   * array (not a partial patch). Server validates QuizQuestion shape
   * + id regex + uniqueness. Skipped during enhance for that module.
   */
  quizQuestions?: Record<string, QuizQuestion[]>;
}

function jsonError(status: number, message: string, extra?: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ error: message, ...extra }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function jsonOk(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

// v0.1 manual text override -- shape validation for briefingHtml /
// quizQuestions overrides. Runs post-transform so cross-reference
// checks against the manifest's module IDs work. All issues aggregate
// into a single OVERRIDE_VALIDATION 400 per the locked v0.1 contract.
// See PHASE_2_SPEC.md §"v0.1 coordination contract — manual text
// override" §"Server-side validation rules".

const QUESTION_ID_RE = /^[A-Za-z0-9_-]+$/;
const QUIZ_TYPES = new Set(['single-choice', 'multi-choice', 'true-false']);

interface ValidationIssue {
  path: string;
  message: string;
}

function validateOverrides(
  body: BuildRequest,
  manifestModules: Array<{ id: string; type: string }>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Index manifest modules by id for cross-reference checks.
  const moduleById = new Map(manifestModules.map((m) => [m.id, m] as const));

  // -- briefingHtml --
  if (body.briefingHtml !== undefined) {
    if (typeof body.briefingHtml !== 'object' || body.briefingHtml === null || Array.isArray(body.briefingHtml)) {
      issues.push({ path: 'briefingHtml', message: 'must be an object keyed by module id' });
    } else {
      for (const [moduleId, html] of Object.entries(body.briefingHtml)) {
        const path = `briefingHtml.${moduleId}`;
        if (typeof html !== 'string') {
          issues.push({ path, message: 'must be a string' });
          continue;
        }
        if (html.length === 0) {
          issues.push({ path, message: 'must be non-empty string' });
        }
        if (html.length > 8000) {
          issues.push({ path, message: `exceeds 8000 char cap (got ${html.length})` });
        }
        const mod = moduleById.get(moduleId);
        if (!mod) {
          issues.push({ path, message: 'module id not found in manifest' });
        } else if (mod.type !== 'briefing') {
          issues.push({ path, message: `module is type '${mod.type}', expected 'briefing'` });
        }
      }
    }
  }

  // -- quizQuestions --
  if (body.quizQuestions !== undefined) {
    if (typeof body.quizQuestions !== 'object' || body.quizQuestions === null || Array.isArray(body.quizQuestions)) {
      issues.push({ path: 'quizQuestions', message: 'must be an object keyed by module id' });
    } else {
      for (const [moduleId, questions] of Object.entries(body.quizQuestions)) {
        const modPath = `quizQuestions.${moduleId}`;
        if (!Array.isArray(questions)) {
          issues.push({ path: modPath, message: 'must be an array of QuizQuestion' });
          continue;
        }
        if (questions.length === 0) {
          issues.push({ path: modPath, message: 'must be non-empty array' });
        }
        const mod = moduleById.get(moduleId);
        if (!mod) {
          issues.push({ path: modPath, message: 'module id not found in manifest' });
        } else if (mod.type !== 'quiz') {
          issues.push({ path: modPath, message: `module is type '${mod.type}', expected 'quiz'` });
        }
        // Per-question shape checks
        const seenIds = new Set<string>();
        for (let i = 0; i < questions.length; i += 1) {
          const q = questions[i] as unknown;
          const qPath = `${modPath}[${i}]`;
          if (typeof q !== 'object' || q === null || Array.isArray(q)) {
            issues.push({ path: qPath, message: 'must be an object' });
            continue;
          }
          const qq = q as Record<string, unknown>;
          // id
          if (typeof qq.id !== 'string') {
            issues.push({ path: `${qPath}.id`, message: 'must be a string' });
          } else if (qq.id.length < 1 || qq.id.length > 128) {
            issues.push({ path: `${qPath}.id`, message: 'must be 1-128 chars' });
          } else if (!QUESTION_ID_RE.test(qq.id)) {
            issues.push({ path: `${qPath}.id`, message: 'must match /^[A-Za-z0-9_-]+$/' });
          } else {
            if (seenIds.has(qq.id)) {
              issues.push({ path: `${qPath}.id`, message: 'duplicate id' });
            }
            seenIds.add(qq.id);
          }
          // prompt
          if (typeof qq.prompt !== 'string' || qq.prompt.length === 0) {
            issues.push({ path: `${qPath}.prompt`, message: 'must be non-empty string' });
          }
          // type
          if (typeof qq.type !== 'string' || !QUIZ_TYPES.has(qq.type)) {
            issues.push({
              path: `${qPath}.type`,
              message: `must be one of [single-choice, multi-choice, true-false]`,
            });
          }
          // choices
          if (!Array.isArray(qq.choices)) {
            issues.push({ path: `${qPath}.choices`, message: 'must be an array' });
            continue;
          }
          if (qq.choices.length < 2) {
            issues.push({ path: `${qPath}.choices`, message: 'must have at least 2 entries' });
          }
          let correctCount = 0;
          for (let j = 0; j < qq.choices.length; j += 1) {
            const c = qq.choices[j] as unknown;
            const cPath = `${qPath}.choices[${j}]`;
            if (typeof c !== 'object' || c === null) {
              issues.push({ path: cPath, message: 'must be an object' });
              continue;
            }
            const cc = c as Record<string, unknown>;
            if (typeof cc.id !== 'string') {
              issues.push({ path: `${cPath}.id`, message: 'must be a string' });
            } else if (cc.id.length < 1 || cc.id.length > 128) {
              issues.push({ path: `${cPath}.id`, message: 'must be 1-128 chars' });
            } else if (!QUESTION_ID_RE.test(cc.id)) {
              issues.push({ path: `${cPath}.id`, message: 'must match /^[A-Za-z0-9_-]+$/' });
            }
            if (typeof cc.label !== 'string' || cc.label.length === 0) {
              issues.push({ path: `${cPath}.label`, message: 'must be non-empty string' });
            }
            if (typeof cc.correct !== 'boolean') {
              issues.push({ path: `${cPath}.correct`, message: 'must be boolean' });
            } else if (cc.correct === true) {
              correctCount += 1;
            }
          }
          // type-specific correct-count rules
          if (qq.type === 'single-choice' && correctCount !== 1) {
            issues.push({
              path: qPath,
              message: `single-choice requires exactly 1 correct, got ${correctCount}`,
            });
          } else if (qq.type === 'multi-choice' && correctCount < 1) {
            issues.push({
              path: qPath,
              message: `multi-choice requires at least 1 correct, got 0`,
            });
          } else if (qq.type === 'true-false') {
            if (qq.choices.length !== 2) {
              issues.push({ path: `${qPath}.choices`, message: 'true-false must have exactly 2 choices' });
            }
            if (correctCount !== 1) {
              issues.push({
                path: qPath,
                message: `true-false requires exactly 1 correct, got ${correctCount}`,
              });
            }
          }
        }
      }
    }
  }

  return issues;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Phase 2 v0 step 4.5 -- redirect-style index.html for the SCORM ZIP.
 *
 * When an LMS opens this page in its iframe, JS replaces the location
 * with the fgn.academy native player URL. The player loads the
 * manifest + assets from fgn.academy storage and renders the course.
 *
 * Trade-off: SCORM API progress tracking doesn't work cross-origin.
 * The LMS sees content but can't track lesson progress. Phase 2.x
 * adds a self-contained ZIP variant that bundles the player HTML for
 * full SCORM API conformance.
 *
 * For v0 destinations:
 *   - fgn-academy: ZIP unused (Learning Resource card uses native player)
 *   - broadbandworkforce / simu-cdl-path / external-lms: ZIP works
 *     for content delivery; progress tracking limited
 */
function buildRedirectIndexHtml(courseId: string, courseTitle: string): string {
  const safeTitle = escapeHtml(courseTitle);
  const launchUrl = `https://fgn.academy/scorm-player/${courseId}/launch`;
  const safeUrl = escapeHtml(launchUrl);
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${safeTitle}</title>`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<style>',
    '  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 2rem; color: #0B0F14; background: #F6F8FB; }',
    '  .center { max-width: 480px; margin: 4rem auto; text-align: center; }',
    '  a.cta { display: inline-block; margin-top: 1rem; padding: 0.75rem 1.5rem; background: #00D4D4; color: #0B0F14; text-decoration: none; border-radius: 8px; font-weight: 600; }',
    '</style>',
    '<script>',
    `  window.location.replace(${JSON.stringify(launchUrl)});`,
    '</script>',
    '</head>',
    '<body>',
    '<div class="center">',
    `  <h1>${safeTitle}</h1>`,
    '  <p>Loading your FGN course...</p>',
    `  <p>If you are not redirected automatically, <a class="cta" href="${safeUrl}">click here to launch</a>.</p>`,
    '</div>',
    '</body>',
    '</html>',
  ].join('\n');
}

/**
 * Phase 2 v0 step 4.5 -- minimal placeholder SVGs for the brand
 * wordmarks. The toolkit's packageCourse() requires both white and
 * ink wordmarks because the SCORM Player references them via relative
 * URL. The redirect ZIP never renders the player, so these are dead
 * files inside the ZIP. Tiny stubs keep the manifest valid without
 * bundling real brand assets.
 *
 * Real brand SVGs live in @fgn/brand-tokens/assets/ in the toolkit
 * repo and will replace these stubs when v0.x adds self-contained
 * ZIP packaging.
 */
const PLACEHOLDER_WHITE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 24"><rect width="100" height="24" fill="#0B0F14"/><text x="50" y="16" text-anchor="middle" fill="#F6F8FB" font-family="sans-serif" font-size="12" font-weight="700">FGN</text></svg>';

const PLACEHOLDER_INK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 24"><rect width="100" height="24" fill="#F6F8FB"/><text x="50" y="16" text-anchor="middle" fill="#0B0F14" font-family="sans-serif" font-size="12" font-weight="700">FGN</text></svg>';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonError(405, 'POST only');
  }

  try {
    // --------------------------------------------------------------
    // 1. Set up Supabase client. We use the service role for the
    //    work_orders read (because it's also gated by RLS that
    //    expects an admin) but we'll use the *user's JWT* for
    //    auth.getUser() so user_roles can be checked correctly.
    // --------------------------------------------------------------
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    if (!supabaseUrl || !serviceKey) {
      return jsonError(500, 'edge function misconfigured: missing SUPABASE_URL or SERVICE_ROLE_KEY');
    }

    // --------------------------------------------------------------
    // 2. Authenticate the caller. Phase 2 v0 spec -- session-based JWT.
    // --------------------------------------------------------------
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return jsonError(401, 'unauthenticated: missing Bearer token');
    }
    const jwt = authHeader.slice('Bearer '.length);

    // Use a service-role client to call auth.getUser(jwt) -- this
    // bypasses RLS for the auth check itself. The JWT is the
    // authoritative identity.
    const adminSupabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: userData, error: userErr } = await adminSupabase.auth.getUser(jwt);
    if (userErr || !userData?.user) {
      return jsonError(401, 'unauthenticated: invalid or expired JWT');
    }
    const user = userData.user;

    // --------------------------------------------------------------
    // 3. Admin role check. Spec: user_roles.role IN ('admin', 'super_admin').
    // --------------------------------------------------------------
    const { data: roles, error: rolesErr } = await adminSupabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    if (rolesErr) {
      return jsonError(500, `failed to check user roles: ${rolesErr.message}`);
    }
    const isAdmin = (roles ?? []).some((r: { role: string }) => ADMIN_ROLES.has(r.role));
    if (!isAdmin) {
      return jsonError(403, 'not an admin', {
        userId: user.id,
        roles: (roles ?? []).map((r: { role: string }) => r.role),
      });
    }

    // --------------------------------------------------------------
    // 4. Parse + validate request body.
    // --------------------------------------------------------------
    let body: BuildRequest;
    try {
      body = (await req.json()) as BuildRequest;
    } catch {
      return jsonError(400, 'invalid JSON body');
    }

    // Required fields
    if (!body.workOrderId || typeof body.workOrderId !== 'string') {
      return jsonError(400, 'workOrderId is required');
    }
    if (!isUuid(body.workOrderId)) {
      return jsonError(400, `workOrderId is not a valid UUID: ${body.workOrderId}`);
    }
    if (!ALLOWED_DESTINATIONS.has(body.destination)) {
      return jsonError(400, `destination must be one of [${Array.from(ALLOWED_DESTINATIONS).join(', ')}]; got: ${body.destination}`);
    }
    if (!ALLOWED_BRAND_MODES.has(body.brandMode)) {
      return jsonError(400, `brandMode must be one of [${Array.from(ALLOWED_BRAND_MODES).join(', ')}]; got: ${body.brandMode}`);
    }

    // Optional fields -- validate enums where present
    if (body.scormVersion && !ALLOWED_SCORM_VERSIONS.has(body.scormVersion)) {
      return jsonError(400, `scormVersion must be one of [${Array.from(ALLOWED_SCORM_VERSIONS).join(', ')}]`);
    }
    if (body.imageQuality && !ALLOWED_IMAGE_QUALITIES.has(body.imageQuality)) {
      return jsonError(400, `imageQuality must be one of [${Array.from(ALLOWED_IMAGE_QUALITIES).join(', ')}]`);
    }
    if (body.imageSize && !ALLOWED_IMAGE_SIZES.has(body.imageSize)) {
      return jsonError(400, `imageSize must be one of [${Array.from(ALLOWED_IMAGE_SIZES).join(', ')}]`);
    }

    // Image options without enhanceCover is suspicious -- warn loudly
    if (
      (body.imageQuality || body.imageSize || body.imageModel || body.uploadCoverToAcademy)
      && !body.enhanceCover
    ) {
      return jsonError(
        400,
        'image-related options (imageQuality, imageSize, imageModel, uploadCoverToAcademy) require enhanceCover=true',
      );
    }

    // --------------------------------------------------------------
    // 5. Look up the Work Order. Must exist + be active + have a
    //    source_challenge_id (otherwise transform has nothing to
    //    pull from on play.fgn.gg).
    // --------------------------------------------------------------
    const { data: wo, error: woErr } = await adminSupabase
      .from('work_orders')
      .select('id, title, description, game_title, is_active, source_challenge_id, fgn_origin_challenge_id, cover_image_url, difficulty')
      .eq('id', body.workOrderId)
      .maybeSingle();

    if (woErr) {
      return jsonError(500, `failed to fetch work order: ${woErr.message}`);
    }
    if (!wo) {
      return jsonError(404, `work order not found: ${body.workOrderId}`);
    }
    if (!wo.is_active) {
      return jsonError(404, `work order is inactive: ${body.workOrderId}`);
    }
    if (!wo.source_challenge_id) {
      return jsonError(400, 'work order has no source_challenge_id; cannot build a SCORM course from it');
    }

    // --------------------------------------------------------------
    // 6. Look up any existing scorm_courses row for this
    //    (work_order_id, destination) tuple. Surface to the caller
    //    so the UI can show a confirmation modal before replacing.
    // --------------------------------------------------------------
    const { data: existing, error: existingErr } = await adminSupabase
      .from('scorm_courses')
      .select('id, title, is_published, created_at, updated_at')
      .eq('work_order_id', body.workOrderId)
      .eq('destination', body.destination)
      .maybeSingle();

    if (existingErr) {
      // Not fatal -- table might not exist yet (pre-migration). Log,
      // continue with isReplacement=false.
      console.warn('scorm_courses lookup failed (table missing?):', existingErr.message);
    }

    // --------------------------------------------------------------
    // 7. Set up the play.fgn.gg client + fetcher used by transform().
    //    Public anon key -- RLS-safe for reading published challenges.
    // --------------------------------------------------------------
    const playSupabaseUrl = Deno.env.get('FGN_PLAY_SUPABASE_URL');
    const playAnonKey = Deno.env.get('FGN_PLAY_SUPABASE_ANON_KEY');
    if (!playSupabaseUrl || !playAnonKey) {
      return jsonError(
        500,
        'edge function misconfigured: missing FGN_PLAY_SUPABASE_URL or FGN_PLAY_SUPABASE_ANON_KEY',
      );
    }

    const playSupabase = createClient(playSupabaseUrl, playAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const fetcher = createSupabaseFetcher(playSupabase as unknown as SupabaseLike);

    // --------------------------------------------------------------
    // 8. Generate the courseId up-front so we can use it as both the
    //    DB row id AND the storage path prefix. Avoids a second write
    //    after insert. Replacement flows reuse the existing row's id.
    // --------------------------------------------------------------
    const courseId = existing?.id ?? crypto.randomUUID();
    const storagePrefix = `scorm-courses/${courseId}`;

    // --------------------------------------------------------------
    // 9. Run transform -- fetches the challenge from play.fgn.gg,
    //    builds the manifest, fetches the cover image bytes
    //    (Phase 1.4.5.1 passthrough), returns CourseManifest +
    //    assets[]. Note: the toolkit's destinationToMode mapping is
    //    the source of truth for brandMode; the body.brandMode field
    //    is informational. The toolkit also uses bundleId to
    //    derive course.id; we pass our DB courseId so the manifest's
    //    internal id matches the DB row.
    // --------------------------------------------------------------
    let transformResult;
    try {
      transformResult = await transform(
        {
          challengeIds: [wo.fgn_origin_challenge_id ?? wo.source_challenge_id],
          destination: body.destination as ScormDestination,
          scormVersion: (body.scormVersion ?? '1.2') as '1.2' | 'cmi5',
          bundleId: courseId,
          ...(body.title ? { title: body.title } : {}),
          ...(body.description ? { description: body.description } : {}),
        },
        fetcher,
      );
    } catch (err) {
      return jsonError(
        502,
        `transform failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // courseManifest and assets are reassigned in the enhancement
    // block below when enhanceText / enhanceCover are set, so they
    // need to be `let` rather than `const`.
    let courseManifest = transformResult.course;
    let assets = transformResult.assets;
    const transformWarnings = transformResult.warnings;

    // Block on error-level warnings (e.g., COVER_IMAGE_FETCH_FAILED is
    // a warn, not an error -- passes through; ChallengeNotPublished
    // would have thrown above).
    const blockingWarnings = transformWarnings.filter((w) => w.level === 'error');
    if (blockingWarnings.length > 0) {
      return jsonError(400, 'transform produced blocking warnings', {
        warnings: blockingWarnings,
      });
    }

    // --------------------------------------------------------------
    // 9.4 v0.1 manual text overrides -- validate + apply pre-enhance.
    //     Validation runs against manifest module ids (post-transform)
    //     so cross-reference checks work. All issues aggregate into a
    //     single OVERRIDE_VALIDATION 400 per the locked v0.1 contract.
    //     See PHASE_2_SPEC.md §"v0.1 coordination contract".
    // --------------------------------------------------------------
    const validationIssues = validateOverrides(body, courseManifest.modules);
    if (validationIssues.length > 0) {
      return jsonError(400, 'override validation failed', {
        code: 'OVERRIDE_VALIDATION',
        issues: validationIssues,
      });
    }

    // Apply title/description overrides to the manifest. These work
    // identically on dryRun and publish phases.
    if (body.title !== undefined) {
      courseManifest.title = body.title;
    }
    if (body.description !== undefined) {
      courseManifest.description = body.description;
    }

    // Apply briefingHtml overrides with server-side sanitization.
    // Strict allowlist <p, strong, em, h3, ul, li> with zero allowed
    // attributes. Stripping is silent (no 400) but emits a non-blocking
    // BRIEFING_HTML_SANITIZED warning per module so admin knows what
    // changed. Post-sanitize empty -> 400 OVERRIDE_VALIDATION (matches
    // the locked spec rule "non-empty after sanitization").
    const sanitizationWarnings: Array<Record<string, unknown>> = [];
    const sanitizationEmptyIssues: ValidationIssue[] = [];
    if (body.briefingHtml) {
      for (const [moduleId, html] of Object.entries(body.briefingHtml)) {
        const mod = courseManifest.modules.find((m) => m.id === moduleId);
        if (mod && mod.type === 'briefing') {
          const { sanitized, didStrip } = sanitizeBriefingHtml(html);
          if (sanitized.length === 0) {
            sanitizationEmptyIssues.push({
              path: `briefingHtml.${moduleId}`,
              message:
                'must be non-empty after sanitization (all content stripped by allowlist)',
            });
            continue;
          }
          mod.html = sanitized;
          if (didStrip) {
            sanitizationWarnings.push({
              level: 'info',
              code: 'BRIEFING_HTML_SANITIZED',
              message:
                'Stripped non-allowlisted content from briefing HTML override.',
              moduleId,
            });
          }
        }
      }
    }
    if (sanitizationEmptyIssues.length > 0) {
      return jsonError(400, 'override validation failed', {
        code: 'OVERRIDE_VALIDATION',
        issues: sanitizationEmptyIssues,
      });
    }

    // Apply quizQuestions overrides (full-array replacement, validated).
    if (body.quizQuestions) {
      for (const [moduleId, questions] of Object.entries(body.quizQuestions)) {
        const mod = courseManifest.modules.find((m) => m.id === moduleId);
        if (mod && mod.type === 'quiz') {
          mod.questions = questions;
        }
      }
    }

    // Module ids that are skipped during enhance (per-module skip,
    // course-level description handled via the slots filter below).
    const overrideBriefingIds = Object.keys(body.briefingHtml ?? {});
    const overrideQuizIds = Object.keys(body.quizQuestions ?? {});
    const skipModuleIds = new Set<string>([
      ...overrideBriefingIds,
      ...overrideQuizIds,
    ]);

    // --------------------------------------------------------------
    // 9.5 Optional AI enhancement (Steps 5+6).
    //     Single call to enhanceCourse with whatever slots the body
    //     opts into. Per-slot failures are non-fatal -- the enhancer
    //     keeps the template-derived field and emits a warning. Image
    //     bytes returned in result.assets are appended to the assets
    //     array and land in the existing asset-upload loop below; we
    //     intentionally do NOT pass uploadToAcademy=true because the
    //     edge function already writes to media-assets via the service
    //     role (the vendored academy-uploader is a stub for this very
    //     reason).
    // --------------------------------------------------------------
    const enhanceWarnings: typeof transformWarnings = [];
    const wantsText = body.enhanceText === true;
    const wantsCover = body.enhanceCover === true;

    if (wantsText || wantsCover) {
      const anthropicKey = wantsText ? Deno.env.get('ANTHROPIC_API_KEY') : undefined;
      const openaiKey = wantsCover ? Deno.env.get('OPENAI_API_KEY') : undefined;

      if (wantsText && !anthropicKey) {
        enhanceWarnings.push({
          level: 'warn',
          code: 'ENHANCER_KEY_MISSING',
          message:
            'enhanceText=true but ANTHROPIC_API_KEY not in edge env. Skipping text enhancement.',
        });
      }
      if (wantsCover && !openaiKey) {
        enhanceWarnings.push({
          level: 'warn',
          code: 'ENHANCER_IMAGE_KEY_MISSING',
          message:
            'enhanceCover=true but OPENAI_API_KEY not in edge env. Skipping cover enhancement.',
        });
      }

      const slots: ('description' | 'briefingHtml' | 'quizQuestions' | 'coverImage')[] = [];
      if (wantsText && anthropicKey) {
        // v0.1: course-level description slot is filtered out when
        // admin provided an override (no module-id granularity here;
        // it's a course-scope field).
        if (body.description === undefined) slots.push('description');
        // briefingHtml + quizQuestions slots stay; per-module skipping
        // is via skipModuleIds passed to enhanceCourse below.
        slots.push('briefingHtml', 'quizQuestions');
      }
      // v0.1: dryRun never triggers enhanceCover. Cover regen is
      // expensive ($0.04-0.08 + 30-60s per call) and admins iterating
      // through preview cycles would burn tokens for no UX win since
      // covers don't depend on text edits. Cover regen runs once on
      // publish (dryRun: false) if requested. See PHASE_2_SPEC.md
      // §"Cover image in v0.1".
      if (wantsCover && openaiKey && !body.dryRun) {
        slots.push('coverImage');
      }

      if (slots.length > 0) {
        try {
          const result = await enhanceCourse(courseManifest, {
            slots,
            ...(skipModuleIds.size > 0 ? { skipModuleIds } : {}),
            ...(anthropicKey ? { apiKey: anthropicKey } : {}),
            ...(openaiKey
              ? {
                  openai: {
                    apiKey: openaiKey,
                    ...(body.imageModel ? { model: body.imageModel } : {}),
                  },
                  imageQuality: (body.imageQuality ?? 'medium') as ImageQuality,
                  imageSize: (body.imageSize ?? '1536x1024') as ImageSize,
                }
              : {}),
            // uploadToAcademy intentionally omitted -- existing asset
            // upload loop below handles cover storage. The vendored
            // academy-uploader.ts is a stub.
          });
          courseManifest = result.course;
          assets = [...assets, ...result.assets];
          enhanceWarnings.push(...result.warnings);
        } catch (err) {
          enhanceWarnings.push({
            level: 'warn',
            code: 'ENHANCER_FAILED',
            message: `AI enhancement threw: ${err instanceof Error ? err.message : String(err)}. Course is published with template-derived fields.`,
          });
        }
      }
    }

    // --------------------------------------------------------------
    // 9.7 v0.1 dryRun: short-circuit before persistence.
    //     Returns the enhanced manifest so the Course Builder UI can
    //     render the editable preview pane. No storage uploads, no
    //     scorm_courses upsert, no ZIP packaging, no cover regen
    //     (suppressed at slot push above). Override application from
    //     §9.4 has already mutated courseManifest in place.
    // --------------------------------------------------------------
    if (body.dryRun === true) {
      return jsonOk({
        status: 'preview',
        manifest: courseManifest,
        warnings: [...transformWarnings, ...enhanceWarnings, ...sanitizationWarnings],
      });
    }

    // --------------------------------------------------------------
    // 10. Upload assets[] (cover image, etc.) to media-assets/
    //     scorm-courses/<courseId>/<asset.path>.
    // --------------------------------------------------------------
    for (const asset of assets) {
      const objectPath = `${storagePrefix}/${asset.path}`;
      const { error: assetErr } = await adminSupabase.storage
        .from('media-assets')
        .upload(objectPath, asset.bytes, {
          contentType: asset.mimeType,
          upsert: true,
          cacheControl: '31536000', // 1 year, content-addressed prefix
        });
      if (assetErr) {
        return jsonError(
          500,
          `failed to upload asset ${asset.path}: ${assetErr.message}`,
        );
      }
    }

    // --------------------------------------------------------------
    // 11. Upload course.json. Short cache so admin regenerates land
    //     fast (the actual asset bytes under assets/ are
    //     content-addressed by their path-extension and can cache
    //     long; the manifest changes on every regen).
    // --------------------------------------------------------------
    const courseJsonBytes = new TextEncoder().encode(
      JSON.stringify(courseManifest, null, 2),
    );
    const { error: manifestErr } = await adminSupabase.storage
      .from('media-assets')
      .upload(`${storagePrefix}/course.json`, courseJsonBytes, {
        contentType: 'application/json',
        upsert: true,
        cacheControl: 'no-cache',
      });
    if (manifestErr) {
      return jsonError(500, `failed to upload course.json: ${manifestErr.message}`);
    }

    const { data: manifestPub } = adminSupabase.storage
      .from('media-assets')
      .getPublicUrl(`${storagePrefix}/course.json`);
    const manifestUrl = manifestPub.publicUrl;

    // --------------------------------------------------------------
    // 12. Build the absolute cover_image_url for the DB row. The
    //     manifest carries a relative path (e.g., "assets/cover.jpg")
    //     which works for both the SCORM ZIP (sibling to course.json)
    //     and the native player (URL-resolved against manifest_url).
    //     For the Learning Resource card on the Work Order page we
    //     need an absolute URL the <img> tag can load directly.
    // --------------------------------------------------------------
    let absoluteCoverUrl: string | null = null;
    if (courseManifest.coverImageUrl) {
      const { data: coverPub } = adminSupabase.storage
        .from('media-assets')
        .getPublicUrl(`${storagePrefix}/${courseManifest.coverImageUrl}`);
      absoluteCoverUrl = coverPub.publicUrl;
    }

    // --------------------------------------------------------------
    // 13. Upsert the scorm_courses row. Service role bypasses RLS;
    //     we set generated_by explicitly to the calling admin's
    //     user.id for provenance.
    // --------------------------------------------------------------
    const dbRow = {
      id: courseId,
      work_order_id: wo.id,
      destination: body.destination,
      title: courseManifest.title,
      description: courseManifest.description ?? null,
      cover_image_url: absoluteCoverUrl,
      scorm_version: courseManifest.scormVersion,
      manifest_url: manifestUrl,
      zip_url: null, // Step 4.5+ will populate this
      bundle_id: courseManifest.id,
      is_published: true,
      published_at: new Date().toISOString(),
      generated_by: user.id,
      source_challenge_id: wo.source_challenge_id,
      ai_enhanced: courseManifest.aiEnhanced ?? null,
    };

    if (existing) {
      // Replace the existing row in place. updated_at handled by
      // the trigger.
      const { id: _id, ...updateRow } = dbRow;
      const { error: updateErr } = await adminSupabase
        .from('scorm_courses')
        .update(updateRow)
        .eq('id', existing.id);
      if (updateErr) {
        return jsonError(
          500,
          `failed to update scorm_courses row: ${updateErr.message}`,
        );
      }
    } else {
      const { error: insertErr } = await adminSupabase
        .from('scorm_courses')
        .insert(dbRow);
      if (insertErr) {
        return jsonError(
          500,
          `failed to insert scorm_courses row: ${insertErr.message}`,
        );
      }
    }

    // --------------------------------------------------------------
    // 14. Phase 2 v0 step 4.5 -- package the SCORM ZIP for download.
    //     Uses the redirect-ZIP pattern: index.html redirects to the
    //     fgn.academy native player URL. Trade-off: SCORM API progress
    //     tracking doesn't work cross-origin, but content delivery
    //     does, and we avoid having to host the ~1MB compiled player
    //     HTML somewhere accessible to every build invocation.
    //     v0.x will add a self-contained ZIP variant.
    //
    //     ZIP packaging failure is non-fatal: course is published,
    //     native player works, only the download button is missing.
    // --------------------------------------------------------------
    let zipUrl: string | null = null;
    const packagingWarnings: typeof transformWarnings = [];

    try {
      const redirectHtml = buildRedirectIndexHtml(courseId, courseManifest.title);
      const packageResult = await packageCourse({
        course: courseManifest,
        playerHtml: redirectHtml,
        brandAssets: {
          whiteSvg: PLACEHOLDER_WHITE_SVG,
          inkSvg: PLACEHOLDER_INK_SVG,
        },
        media: assets.map((a) => ({ path: a.path, content: a.bytes })),
      });

      const zipPath = `scorm-bundles/${courseId}.zip`;
      const { error: zipUploadErr } = await adminSupabase.storage
        .from('media-assets')
        .upload(zipPath, packageResult.zip, {
          contentType: 'application/zip',
          upsert: true,
          cacheControl: 'no-cache',
        });

      if (zipUploadErr) {
        packagingWarnings.push({
          level: 'warn',
          code: 'ZIP_UPLOAD_FAILED',
          message: `Failed to upload SCORM ZIP: ${zipUploadErr.message}. Course is published; native player works; ZIP download not available.`,
        });
      } else {
        const { data: zipPub } = adminSupabase.storage
          .from('media-assets')
          .getPublicUrl(zipPath);
        zipUrl = zipPub.publicUrl;

        // Update the row with the zip_url. Don't fail the whole
        // build if this update errors -- the artifact is in storage,
        // we just couldn't link it to the row.
        const { error: zipRowErr } = await adminSupabase
          .from('scorm_courses')
          .update({ zip_url: zipUrl })
          .eq('id', courseId);
        if (zipRowErr) {
          packagingWarnings.push({
            level: 'warn',
            code: 'ZIP_ROW_UPDATE_FAILED',
            message: `ZIP uploaded but scorm_courses.zip_url stamp failed: ${zipRowErr.message}.`,
          });
        }
      }
    } catch (err) {
      packagingWarnings.push({
        level: 'warn',
        code: 'ZIP_PACKAGE_FAILED',
        message: `SCORM packaging failed: ${err instanceof Error ? err.message : String(err)}. Course is published; ZIP download not available.`,
      });
    }

    // --------------------------------------------------------------
    // 15. Return success payload. playerUrl is only meaningful for
    //     fgn-academy destination (where the native /scorm-player/
    //     route renders the course); external destinations rely on
    //     zipUrl for download distribution.
    // --------------------------------------------------------------
    const playerUrl =
      body.destination === 'fgn-academy'
        ? `https://fgn.academy/scorm-player/${courseId}/launch`
        : null;
    const workOrderUrl = `https://fgn.academy/work-orders/${wo.id}`;

    return jsonOk({
      status: 'ok',
      courseId,
      manifestUrl,
      zipUrl,
      playerUrl,
      workOrderUrl,
      coverImageUrl: absoluteCoverUrl,
      title: courseManifest.title,
      isReplacement: existing !== null && existing !== undefined,
      warnings: [...transformWarnings, ...enhanceWarnings, ...sanitizationWarnings, ...packagingWarnings],
    });
  } catch (err) {
    console.error('scorm-build unexpected error:', err);
    return jsonError(
      500,
      `internal error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
});
