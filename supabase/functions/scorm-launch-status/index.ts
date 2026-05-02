/**
 * scorm-launch-status — fgn.academy edge function for the SCORM launch-token bridge.
 *
 * THIS FILE BELONGS IN: stratify-workforce/supabase/functions/scorm-launch-status/index.ts
 * (drop in via the Lovable project; commits sync to GitHub automatically)
 *
 * Two endpoints, one function:
 *
 *   POST /scorm-launch-status/mint
 *     Body: { challengeId, scormStudentId, scormStudentName?, scormSessionId? }
 *     Auth: X-App-Key header (verified against authorized_apps via verify_app_api_key)
 *     Returns: { token, expiresAt }
 *
 *   GET /scorm-launch-status/status?token=<token>
 *     Auth: X-App-Key header
 *     Returns: { status: 'pending'|'launched'|'completed'|'failed'|'expired',
 *                preliminaryScore?: number,
 *                completedAt?: ISO string }
 *     Side-effect: if the token is pending/launched and a matching
 *                  user_work_order_completions row exists, updates the
 *                  token to mirror that completion before returning.
 *                  This means the SCORM Player gets fresh state on every
 *                  poll without any code on play.fgn.gg knowing the
 *                  token exists.
 *
 * Architecture:
 *   - The Player polls /status periodically while the learner is on play.fgn.gg
 *   - When sync-challenge-completion fires from play.fgn.gg, it creates
 *     user_work_order_completions on this database
 *   - The next /status poll detects the new completion via
 *     (user_id from email, work_order linked by source_challenge_id) and
 *     resolves the token
 *   - Zero code on play.fgn.gg needed
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-app-key',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const TOKEN_TTL_DAYS = 7;
const REQUIRED_APP_SLUG = 'fgn-scorm-toolkit';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const path = url.pathname;

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Verify X-App-Key against authorized_apps. Only fgn-scorm-toolkit
    // is allowed to call this function.
    const apiKey = req.headers.get('x-app-key');
    if (!apiKey) {
      return jsonError(401, 'Missing X-App-Key header');
    }
    const { data: appData, error: appError } = await supabase.rpc('verify_app_api_key', {
      p_api_key: apiKey,
    });
    if (appError || !appData || !Array.isArray(appData) || appData.length === 0) {
      return jsonError(401, 'Invalid API key');
    }
    const app = appData[0] as { app_slug: string };
    if (app.app_slug !== REQUIRED_APP_SLUG) {
      return jsonError(
        403,
        `App ${app.app_slug} is not authorized for scorm-launch-status. Required: ${REQUIRED_APP_SLUG}`,
      );
    }

    if (req.method === 'POST' && path.endsWith('/mint')) {
      return await mint(req, supabase);
    }
    if (req.method === 'GET' && path.endsWith('/status')) {
      return await status(req, supabase);
    }
    return jsonError(404, `No route for ${req.method} ${path}`);
  } catch (err) {
    console.error('scorm-launch-status error:', err);
    return jsonError(500, err instanceof Error ? err.message : 'Internal server error');
  }
});

// =====================================================================
// /mint — create a new launch token
// =====================================================================

interface MintBody {
  challengeId: string;
  scormStudentId: string; // typically the learner's email from cmi.core.student_id
  scormStudentName?: string;
  scormSessionId?: string;
}

async function mint(req: Request, supabase: ReturnType<typeof createClient>): Promise<Response> {
  let body: MintBody;
  try {
    body = (await req.json()) as MintBody;
  } catch {
    return jsonError(400, 'Invalid JSON body');
  }

  if (!body.challengeId || !body.scormStudentId) {
    return jsonError(400, 'challengeId and scormStudentId are required');
  }

  const token = generateSecureToken(32);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('scorm_launch_tokens')
    .insert({
      token,
      challenge_id: body.challengeId,
      scorm_student_id: body.scormStudentId,
      scorm_student_name: body.scormStudentName ?? null,
      scorm_session_id: body.scormSessionId ?? null,
      status: 'pending',
      expires_at: expiresAt,
    })
    .select('token, expires_at')
    .single();

  if (error || !data) {
    return jsonError(500, `Token mint failed: ${error?.message ?? 'unknown'}`);
  }

  return jsonOk({
    token: (data as { token: string }).token,
    expiresAt: (data as { expires_at: string }).expires_at,
  });
}

// =====================================================================
// /status — return current token status, refreshing from completions
// =====================================================================

async function status(req: Request, supabase: ReturnType<typeof createClient>): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  if (!token) return jsonError(400, 'token query parameter is required');

  const { data: tokenRow, error: tokenErr } = await supabase
    .from('scorm_launch_tokens')
    .select('*')
    .eq('token', token)
    .maybeSingle();

  if (tokenErr) return jsonError(500, `Token lookup failed: ${tokenErr.message}`);
  if (!tokenRow) return jsonError(404, 'Token not found');

  const t = tokenRow as {
    challenge_id: string;
    scorm_student_id: string;
    status: string;
    preliminary_score: number | null;
    expires_at: string;
    updated_at: string;
  };

  // Already terminal? Just return it.
  if (t.status === 'completed' || t.status === 'failed') {
    return jsonOk({
      status: t.status,
      preliminaryScore: t.preliminary_score,
      completedAt: t.updated_at,
    });
  }

  // Expired? Mark and return.
  if (new Date(t.expires_at) < new Date()) {
    await supabase
      .from('scorm_launch_tokens')
      .update({ status: 'expired' })
      .eq('token', token);
    return jsonOk({ status: 'expired' });
  }

  // Try to correlate to a fresh user_work_order_completions row.
  const completion = await findCompletion(supabase, t.challenge_id, t.scorm_student_id);
  if (completion) {
    const newStatus = completion.status === 'completed' ? 'completed' : 'failed';
    await supabase
      .from('scorm_launch_tokens')
      .update({
        status: newStatus,
        preliminary_score: completion.score,
      })
      .eq('token', token);
    return jsonOk({
      status: newStatus,
      preliminaryScore: completion.score,
      completedAt: completion.completed_at,
    });
  }

  // No completion yet — return the token's current status as-is.
  return jsonOk({ status: t.status });
}

async function findCompletion(
  supabase: ReturnType<typeof createClient>,
  challengeId: string,
  scormStudentId: string,
): Promise<{ status: string; score: number | null; completed_at: string | null } | null> {
  // 1. Resolve user_id by email (scorm_student_id is the learner's email).
  const { data: userId, error: userErr } = await supabase.rpc('get_user_id_by_email', {
    p_email: scormStudentId,
  });
  if (userErr || !userId) return null;

  // 2. Find the work_order by source_challenge_id.
  const { data: wo, error: woErr } = await supabase
    .from('work_orders')
    .select('id')
    .eq('source_challenge_id', challengeId)
    .maybeSingle();
  if (woErr || !wo) return null;

  // 3. Find the most recent user_work_order_completions row.
  const { data: completion, error: cErr } = await supabase
    .from('user_work_order_completions')
    .select('status, score, completed_at')
    .eq('user_id', userId as string)
    .eq('work_order_id', (wo as { id: string }).id)
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (cErr || !completion) return null;
  return completion as { status: string; score: number | null; completed_at: string | null };
}

// =====================================================================
// Helpers
// =====================================================================

function generateSecureToken(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
