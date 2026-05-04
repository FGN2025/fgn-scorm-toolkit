/**
 * scorm-build -- fgn.academy edge function for the Course Builder UI.
 *
 * Phase 2 v0 spec: docs/PHASE_2_SPEC.md in the FGN SCORM toolkit repo.
 *
 * STATUS: Step 4 -- transform + storage + DB upsert wired in.
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
 * Not yet wired -- coming in subsequent steps:
 *   - Step 4.5: packageCourse() into a downloadable ZIP. Requires
 *     vendored or storage-hosted scorm-player HTML + brand SVGs.
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
import type { ScormDestination } from './_lib/brand-tokens.ts';

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
      .select('id, title, description, game_title, is_active, source_challenge_id, cover_image_url, difficulty')
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
          challengeIds: [wo.source_challenge_id],
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

    const courseManifest = transformResult.course;
    const assets = transformResult.assets;
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
    // 14. Return success payload. playerUrl is only meaningful for
    //     fgn-academy destination (where the native /scorm-player/
    //     route renders the course); external destinations rely on
    //     the (future) zipUrl for download distribution.
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
      zipUrl: null, // Step 4.5 will populate after wiring packageCourse()
      playerUrl,
      workOrderUrl,
      coverImageUrl: absoluteCoverUrl,
      title: courseManifest.title,
      isReplacement: existing !== null && existing !== undefined,
      warnings: transformWarnings,
    });
  } catch (err) {
    console.error('scorm-build unexpected error:', err);
    return jsonError(
      500,
      `internal error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
});
