/**
 * scorm-build — fgn.academy edge function for the Course Builder UI.
 *
 * Phase 2 v0 spec: docs/PHASE_2_SPEC.md in the FGN SCORM toolkit repo.
 *
 * STATUS: Step 3 skeleton.
 *
 * What this skeleton does:
 *   - Validates the request shape
 *   - Authenticates the caller via the standard Supabase session JWT
 *     (Authorization: Bearer <token>)
 *   - Checks that the calling user is an admin or super_admin via
 *     the public.user_roles table
 *   - Looks up the requested Work Order, confirms it is_active and
 *     has a source_challenge_id
 *   - Returns a stub response with the validated inputs
 *
 * What this skeleton does NOT do (yet — coming in steps 4-6):
 *   - Run transform() against play.fgn.gg
 *   - Run enhance() (text or cover slots)
 *   - Run packageCourse() to produce a SCORM ZIP
 *   - Write artifacts to Supabase Storage
 *   - Insert/update scorm_courses row
 *
 * The vendored toolkit source is at ./_lib/. It's not yet imported
 * here — keeping the skeleton minimal lets us validate the auth
 * chain end-to-end before plumbing the build code through.
 *
 * Deploy on FGN2025/stratify-workforce. Same Lovable-managed Supabase
 * project as scorm-publish, scorm-launch-status, media-upload.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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
    // 2. Authenticate the caller. Phase 2 v0 spec — session-based JWT.
    // --------------------------------------------------------------
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return jsonError(401, 'unauthenticated: missing Bearer token');
    }
    const jwt = authHeader.slice('Bearer '.length);

    // Use a service-role client to call auth.getUser(jwt) — this
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

    // Optional fields — validate enums where present
    if (body.scormVersion && !ALLOWED_SCORM_VERSIONS.has(body.scormVersion)) {
      return jsonError(400, `scormVersion must be one of [${Array.from(ALLOWED_SCORM_VERSIONS).join(', ')}]`);
    }
    if (body.imageQuality && !ALLOWED_IMAGE_QUALITIES.has(body.imageQuality)) {
      return jsonError(400, `imageQuality must be one of [${Array.from(ALLOWED_IMAGE_QUALITIES).join(', ')}]`);
    }
    if (body.imageSize && !ALLOWED_IMAGE_SIZES.has(body.imageSize)) {
      return jsonError(400, `imageSize must be one of [${Array.from(ALLOWED_IMAGE_SIZES).join(', ')}]`);
    }

    // Image options without enhanceCover is suspicious — warn loudly
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
      // Not fatal — table might not exist yet (pre-migration). Log,
      // continue with isReplacement=false.
      console.warn('scorm_courses lookup failed (table missing?):', existingErr.message);
    }

    // --------------------------------------------------------------
    // 7. STUB RESPONSE — Step 3 ends here. Step 4 wires in
    //    transform/enhance/package and replaces this stub.
    // --------------------------------------------------------------
    return jsonOk({
      status: 'stub',
      message:
        'Skeleton edge function — auth + validation passed. Build implementation lands in Step 4 of Phase 2 v0 implementation order.',
      validated: {
        userId: user.id,
        userEmail: user.email,
        workOrderId: wo.id,
        workOrderTitle: wo.title,
        workOrderGameTitle: wo.game_title,
        sourceChallengeId: wo.source_challenge_id,
        destination: body.destination,
        brandMode: body.brandMode,
        scormVersion: body.scormVersion ?? '1.2',
        enhanceText: body.enhanceText ?? false,
        enhanceCover: body.enhanceCover ?? false,
      },
      isReplacement: existing !== null && existing !== undefined,
      existing: existing
        ? {
            id: existing.id,
            title: existing.title,
            isPublished: existing.is_published,
            createdAt: existing.created_at,
            updatedAt: existing.updated_at,
          }
        : null,
    });
  } catch (err) {
    console.error('scorm-build unexpected error:', err);
    return jsonError(
      500,
      `internal error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
});
