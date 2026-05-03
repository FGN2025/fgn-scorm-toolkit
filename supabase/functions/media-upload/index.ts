/**
 * media-upload — fgn.academy edge function for storing AI-generated
 * cover images (and future SCORM-related media) in the media-assets
 * Supabase Storage bucket.
 *
 * Phase 1.4.6 v0 — only the `cover-image` slot is supported. Bytes
 * arrive as base64-encoded JSON (multipart was deferred). Service
 * role writes the bytes to a content-addressed path under
 * `scorm-covers/`. Public URL is returned to the toolkit, which
 * stamps it on `course.coverImageRemoteUrl`.
 *
 * Authn: same X-App-Key pattern as scorm-publish (verify_app_api_key
 * RPC, app_slug must be 'fgn-scorm-toolkit').
 *
 * Bucket: `media-assets` (already public, used by the existing site
 * media library on fgn.academy — see useMediaLibrary.ts).
 *
 * One endpoint:
 *
 *   POST /media-upload
 *     Headers: X-App-Key (fgn-scorm-toolkit)
 *     Body: {
 *       courseId: string,         // used in storage path
 *       slot: 'cover-image',      // reserved for future thumbnails
 *       filename: string,         // hint only; storage path uses sha256
 *       mimeType: 'image/png' | 'image/jpeg' | 'image/webp',
 *       bytes: string             // base64-encoded image bytes
 *     }
 *     Returns: {
 *       url: string,              // public URL on fgn.academy storage
 *       storagePath: string,      // path within the bucket
 *       bytes: number,            // decoded byte count
 *       mimeType: string
 *     }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { decodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-app-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const REQUIRED_APP_SLUG = 'fgn-scorm-toolkit';
const BUCKET = 'media-assets';
const PATH_PREFIX = 'scorm-covers/';
const MAX_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_SLOTS = new Set(['cover-image']);
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);

interface UploadRequest {
  courseId: string;
  slot: string;
  filename: string;
  mimeType: string;
  bytes: string;
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonError(405, 'POST only');
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Auth — same pattern as scorm-publish.
    const apiKey = req.headers.get('x-app-key');
    if (!apiKey) return jsonError(401, 'Missing X-App-Key header');
    const { data: appData, error: appError } = await supabase.rpc(
      'verify_app_api_key',
      { p_api_key: apiKey },
    );
    if (appError || !appData || !Array.isArray(appData) || appData.length === 0) {
      return jsonError(401, 'Invalid API key');
    }
    const app = appData[0] as { app_slug: string };
    if (app.app_slug !== REQUIRED_APP_SLUG) {
      return jsonError(
        403,
        `App ${app.app_slug} is not authorized for media-upload. Required: ${REQUIRED_APP_SLUG}`,
      );
    }

    // Parse body.
    let body: UploadRequest;
    try {
      body = (await req.json()) as UploadRequest;
    } catch {
      return jsonError(400, 'Invalid JSON body');
    }

    // Validate.
    if (!body?.courseId || typeof body.courseId !== 'string') {
      return jsonError(400, 'courseId required');
    }
    if (!ALLOWED_SLOTS.has(body.slot)) {
      return jsonError(400, `unknown slot: ${body.slot}`);
    }
    if (!ALLOWED_MIME.has(body.mimeType)) {
      return jsonError(400, `unsupported mimeType: ${body.mimeType}`);
    }
    if (!body.bytes || typeof body.bytes !== 'string') {
      return jsonError(400, 'bytes required (base64-encoded)');
    }

    // Decode + size check.
    let bytes: Uint8Array;
    try {
      bytes = decodeBase64(body.bytes);
    } catch {
      return jsonError(400, 'invalid base64 in bytes');
    }
    if (bytes.byteLength > MAX_BYTES) {
      return jsonError(
        413,
        `bytes too large: ${bytes.byteLength} > ${MAX_BYTES}`,
      );
    }

    // Hash for stable, content-addressed storage path. We use only the
    // first 4 bytes of the sha256 as a short suffix — full hashes
    // create unwieldy file names; collisions within a single courseId
    // bucket are vanishingly unlikely with 32 bits over a small N.
    const hashBuf = await crypto.subtle.digest('SHA-256', bytes);
    const hashHex = Array.from(new Uint8Array(hashBuf))
      .slice(0, 4)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const ext =
      body.mimeType === 'image/png'
        ? 'png'
        : body.mimeType === 'image/webp'
          ? 'webp'
          : 'jpg';
    const safeCourseId = body.courseId.replace(/[^a-zA-Z0-9_-]/g, '-');
    const storagePath = `${PATH_PREFIX}${safeCourseId}-${hashHex}.${ext}`;

    // Upload via service role. upsert=true so re-uploading identical
    // bytes (same hash) is idempotent — re-runs of `enhance
    // --upload-to-academy` on the same course don't error out.
    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, bytes, {
        contentType: body.mimeType,
        upsert: true,
        cacheControl: '31536000', // 1 year — content-addressed, safe to cache hard
      });

    if (uploadErr) {
      return jsonError(500, `storage write failed: ${uploadErr.message}`);
    }

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);

    return jsonOk({
      url: pub.publicUrl,
      storagePath,
      bytes: bytes.byteLength,
      mimeType: body.mimeType,
    });
  } catch (err) {
    console.error('media-upload unexpected error:', err);
    return jsonError(
      500,
      `internal error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
});
