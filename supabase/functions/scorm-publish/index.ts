/**
 * scorm-publish — fgn.academy edge function for native course publishing.
 *
 * Receives a CourseManifest (course.json shape) over HTTP, looks up the
 * referenced work_orders, and writes a `courses` row + `modules` row +
 * `lessons` rows directly into fgn.academy's native schema. Replaces
 * the local-CLI-with-service-role-key approach so the service role key
 * never leaves Supabase.
 *
 * One endpoint:
 *
 *   POST /scorm-publish
 *     Headers: X-App-Key (must validate as fgn-scorm-toolkit via
 *              verify_app_api_key)
 *     Body: { course: CourseManifest, options?: PublishOptions }
 *     Returns: {
 *       courseId: string,
 *       moduleIds: string[],
 *       lessonIds: string[],
 *       warnings: CourseWarning[]
 *     }
 *
 * Behavior:
 *   - Reuses existing work_orders rows (looked up by source_challenge_id)
 *   - Never modifies existing rows (only INSERTs)
 *   - Never touches user_work_order_completions or user_lesson_progress
 *     (those are populated by sync-challenge-completion at runtime)
 *   - For challenges already mapped to curated CE lessons, emits an
 *     EXISTING_CE_LESSON_PRESENT info warning so admins are aware
 *   - For challenges with no work_order yet, emits a MISSING_WORK_ORDER
 *     warning and skips the challenge in this publish (admin must
 *     provision the work_order on fgn.academy first, then re-publish)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-app-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const REQUIRED_APP_SLUG = 'fgn-scorm-toolkit';

// Mirror of CHALLENGE_LESSON_MAP in stratify-workforce/supabase/functions/
// sync-challenge-completion/index.ts. Pre-curated lessons in the
// Challenge Enhancer course (CE_COURSE_ID dab09852-...). When a challenge
// already has a mapped lesson there, the publisher emits a warning so
// admins know not to duplicate.
const CHALLENGE_LESSON_MAP: Record<string, string> = {
  '034e8cf3-8832-4c05-a572-67af46dc9971': '2eb52508-7822-429c-b95f-be65d63bfb2d',
  'c8298ef1-d359-4536-958f-533e66f7ee4a': 'e4332a97-b389-4486-a8f0-304185c7dd52',
  '5e9ace81-fcc3-49f9-9013-5321d2e04d56': '529bb1c4-ff45-4641-840c-edce7a97c39b',
  'd8b601c3-ff40-46c6-aa4b-55da7711c8ce': 'fb955601-7957-4d05-a748-fe4c4e64d88d',
  '57da5f29-5a4e-4148-a738-319e7a33252c': '0e1a2041-ca0b-4c49-8d07-73fe1fd51d1b',
  '4ce440c1-be75-4700-a8fa-4a80f6d1fbde': '0e1a2041-ca0b-4c49-8d07-73fe1fd51d1b',
};

const CE_COURSE_ID = 'dab09852-eeb2-431f-b2f4-b881c6b4aa7f';

interface CourseWarning {
  level: 'info' | 'warn' | 'error';
  code: string;
  message: string;
  challengeIds?: string[];
  suggestion?: string;
}

interface PublishOptions {
  tenantId?: string | null;
  isPublished?: boolean;
  estimatedHours?: number;
  difficultyLevel?: 'beginner' | 'intermediate' | 'advanced';
}

interface PublishRequest {
  course: {
    schemaVersion: number;
    id: string;
    title: string;
    description?: string;
    modules: Array<Record<string, unknown> & {
      type: string;
      id: string;
      position: number;
      title: string;
    }>;
  };
  options?: PublishOptions;
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

    // Auth — only fgn-scorm-toolkit can publish.
    const apiKey = req.headers.get('x-app-key');
    if (!apiKey) return jsonError(401, 'Missing X-App-Key header');
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
        `App ${app.app_slug} is not authorized for scorm-publish. Required: ${REQUIRED_APP_SLUG}`,
      );
    }

    // Parse body.
    let body: PublishRequest;
    try {
      body = (await req.json()) as PublishRequest;
    } catch {
      return jsonError(400, 'Invalid JSON body');
    }

    if (!body?.course || body.course.schemaVersion !== 1) {
      return jsonError(400, 'Invalid course. schemaVersion must be 1.');
    }

    const course = body.course;
    const options: PublishOptions = body.options ?? {};
    const warnings: CourseWarning[] = [];

    // 1. Resolve work_orders for every challenge module up-front.
    const challengeModules = course.modules.filter((m) => m.type === 'challenge');
    const workOrders = new Map<string, { id: string; xp_reward: number; title: string }>();

    for (const m of challengeModules) {
      const challengeId = m.challengeId as string;
      if (!challengeId) continue;
      const wo = await findWorkOrder(supabase, challengeId);
      if (wo) {
        workOrders.set(challengeId, wo);
      } else {
        warnings.push({
          level: 'warn',
          code: 'MISSING_WORK_ORDER',
          message:
            `No work_orders row found on fgn.academy for challenge ${challengeId}. ` +
            `The challenge will be skipped in this publish. Provision the work_order ` +
            `(typically by completing the challenge once on play.fgn.gg) and re-publish.`,
          challengeIds: [challengeId],
          suggestion:
            'Provision the work_order via the existing fgn.academy admin flow, then retry the publish.',
        });
      }

      const existingLesson = CHALLENGE_LESSON_MAP[challengeId];
      if (existingLesson) {
        warnings.push({
          level: 'info',
          code: 'EXISTING_CE_LESSON_PRESENT',
          message:
            `Challenge ${challengeId} already has a curated lesson (${existingLesson}) ` +
            `in the Challenge Enhancer course (${CE_COURSE_ID}). The publisher will ` +
            `create a new lesson in this course alongside the existing one. To avoid ` +
            `duplication, point learners at the existing CE lesson instead.`,
          challengeIds: [challengeId],
          suggestion:
            'Either remove this challenge from the bundle (learners use the existing CE lesson) ' +
            'or proceed and accept that two lessons will exist for the same challenge.',
        });
      }
    }

    // 2. Insert the courses row.
    const { data: courseRow, error: courseErr } = await supabase
      .from('courses')
      .insert({
        title: course.title,
        description: course.description ?? null,
        difficulty_level: options.difficultyLevel ?? 'intermediate',
        estimated_hours: options.estimatedHours ?? Math.max(1, challengeModules.length),
        is_published: options.isPublished ?? false,
        tenant_id: options.tenantId ?? null,
        xp_reward: challengeModules.length * 50,
      })
      .select('id')
      .single();

    if (courseErr || !courseRow) {
      return jsonError(500, `Failed to insert course: ${courseErr?.message ?? 'unknown'}`);
    }
    const courseId = (courseRow as { id: string }).id;

    // 3. Insert one modules row (Phase 1.3 v0 — single module containing all lessons).
    const { data: moduleRow, error: moduleErr } = await supabase
      .from('modules')
      .insert({
        course_id: courseId,
        title: 'Course content',
        description: course.description ?? null,
        order_index: 0,
        xp_reward: 0,
      })
      .select('id')
      .single();

    if (moduleErr || !moduleRow) {
      return jsonError(500, `Failed to insert module: ${moduleErr?.message ?? 'unknown'}`);
    }
    const moduleId = (moduleRow as { id: string }).id;

    // 4. Insert lessons in manifest order.
    const lessonIds: string[] = [];
    let orderIdx = 0;

    for (const m of course.modules) {
      const lessonInsert = buildLessonInsert(m, moduleId, orderIdx, workOrders);
      if (!lessonInsert) continue;
      orderIdx += 1;

      const { data: row, error: lessonErr } = await supabase
        .from('lessons')
        .insert(lessonInsert)
        .select('id')
        .single();

      if (lessonErr || !row) {
        // Don't roll back here — surface as warning and continue. The
        // course + module are still useful even if individual lessons fail.
        warnings.push({
          level: 'warn',
          code: 'LESSON_INSERT_FAILED',
          message: `Lesson "${m.title}" (${m.type}) failed to insert: ${lessonErr?.message ?? 'unknown'}.`,
        });
        continue;
      }
      lessonIds.push((row as { id: string }).id);
    }

    return jsonOk({
      courseId,
      moduleIds: [moduleId],
      lessonIds,
      warnings,
    });
  } catch (err) {
    console.error('scorm-publish error:', err);
    return jsonError(500, err instanceof Error ? err.message : 'Internal server error');
  }
});

// =====================================================================
// Helpers
// =====================================================================

async function findWorkOrder(
  supabase: ReturnType<typeof createClient>,
  challengeId: string,
): Promise<{ id: string; xp_reward: number; title: string } | null> {
  const { data, error } = await supabase
    .from('work_orders')
    .select('id, xp_reward, title')
    .eq('source_challenge_id', challengeId)
    .maybeSingle();
  if (error || !data) return null;
  return data as { id: string; xp_reward: number; title: string };
}

function buildLessonInsert(
  m: Record<string, unknown> & {
    type: string;
    id: string;
    position: number;
    title: string;
  },
  moduleId: string,
  orderIdx: number,
  workOrders: Map<string, { id: string; xp_reward: number; title: string }>,
): Record<string, unknown> | null {
  switch (m.type) {
    case 'briefing':
      return {
        module_id: moduleId,
        title: m.title,
        lesson_type: 'reading',
        content: { html: m.html },
        order_index: orderIdx,
        xp_reward: 5,
      };

    case 'challenge': {
      const challengeId = m.challengeId as string;
      const wo = workOrders.get(challengeId);
      if (!wo) return null; // already warned; skip
      return {
        module_id: moduleId,
        title: m.title,
        lesson_type: 'work_order',
        content: {
          challenge_id: challengeId,
          challenge_url: m.challengeUrl,
          game: m.game,
          credential_framework: m.credentialFramework,
          tasks: m.tasks,
          preLaunchHtml: m.preLaunchHtml,
        },
        order_index: orderIdx,
        work_order_id: wo.id,
        xp_reward: wo.xp_reward,
      };
    }

    case 'quiz':
      return {
        module_id: moduleId,
        title: m.title,
        lesson_type: 'quiz',
        content: { questions: m.questions, passThreshold: m.passThreshold },
        order_index: orderIdx,
        passing_score: m.passThreshold,
        xp_reward: 10,
      };

    case 'media': {
      const mediaUrl = m.mediaUrl as string;
      const isVideo = /\.(mp4|webm|mov)$/i.test(mediaUrl);
      return {
        module_id: moduleId,
        title: m.title,
        lesson_type: isVideo ? 'video' : 'reading',
        content: { mediaUrl, caption: m.caption, posterUrl: m.posterUrl },
        order_index: orderIdx,
        xp_reward: 5,
      };
    }

    case 'completion':
      return {
        module_id: moduleId,
        title: m.title,
        lesson_type: 'reading',
        content: { html: m.html, isCompletion: true },
        order_index: orderIdx,
        xp_reward: 0,
      };

    default:
      return null;
  }
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
