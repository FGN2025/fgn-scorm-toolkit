/**
 * publish() — POST a CourseManifest to fgn.academy's scorm-publish edge
 * function. The edge function handles all the actual database writes
 * server-side using its auto-injected service role; this client never
 * sees that key.
 *
 * What the edge function does on receipt:
 *   - Authenticates X-App-Key against authorized_apps (must be fgn-scorm-toolkit)
 *   - Resolves work_orders by source_challenge_id for every challenge module
 *   - INSERTs a courses row, a modules row, and lessons rows
 *   - Reuses existing work_orders (never creates them)
 *   - Emits MISSING_WORK_ORDER and EXISTING_CE_LESSON_PRESENT warnings
 *
 * The publisher API is intentionally identical in shape to the previous
 * direct-Supabase implementation — only the authentication path
 * changed (was: service role key on client; now: app key + edge function).
 */

import type { CourseManifest, CourseWarning } from '@fgn/course-types';

export interface PublishOptions {
  /**
   * Edge function URL. Default:
   * https://vfzjfkcwromssjnlrhoo.supabase.co/functions/v1/scorm-publish
   */
  endpoint?: string;
  /** X-App-Key value. Should be the fgn-scorm-toolkit's API key. */
  appKey: string;
  /**
   * Tenant assignment for the new course. SCORM-derived courses are
   * FGN-canonical and tenant-unaligned per architecture decision —
   * pass null. Override only if you know what you're doing.
   */
  tenantId?: string | null;
  /**
   * Whether to mark the course as published immediately. Default: false
   * (admin reviews in fgn.academy UI before flipping the published bit).
   */
  isPublished?: boolean;
  /**
   * Estimated hours for the course. Default: 1 hour per challenge module.
   */
  estimatedHours?: number;
  /**
   * Difficulty level. Default: 'intermediate'.
   */
  difficultyLevel?: 'beginner' | 'intermediate' | 'advanced';
  /** Optional fetch override for testing. */
  fetchImpl?: typeof fetch;
}

export interface PublishResult {
  courseId: string;
  moduleIds: string[];
  lessonIds: string[];
  warnings: CourseWarning[];
}

const DEFAULT_ENDPOINT =
  'https://vfzjfkcwromssjnlrhoo.supabase.co/functions/v1/scorm-publish';

export class PublishError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown,
  ) {
    super(message);
    this.name = 'PublishError';
  }
}

export async function publishCourse(
  course: CourseManifest,
  options: PublishOptions,
): Promise<PublishResult> {
  if (course.schemaVersion !== 1) {
    throw new Error(
      `publishCourse: unsupported course.schemaVersion ${course.schemaVersion}. The publisher handles schemaVersion 1.`,
    );
  }
  if (!options.appKey) {
    throw new Error('publishCourse: options.appKey is required (FGN_ACADEMY_APP_KEY).');
  }

  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  const fetchFn = options.fetchImpl ?? fetch;

  const requestBody = {
    course,
    options: {
      ...(options.tenantId !== undefined ? { tenantId: options.tenantId } : { tenantId: null }),
      ...(options.isPublished !== undefined ? { isPublished: options.isPublished } : {}),
      ...(options.estimatedHours !== undefined ? { estimatedHours: options.estimatedHours } : {}),
      ...(options.difficultyLevel !== undefined
        ? { difficultyLevel: options.difficultyLevel }
        : {}),
    },
  };

  const res = await fetchFn(endpoint, {
    method: 'POST',
    headers: {
      'X-App-Key': options.appKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new PublishError(
      `scorm-publish returned non-JSON response (status ${res.status})`,
      res.status,
      text,
    );
  }

  if (!res.ok) {
    const errMsg =
      (parsed as { error?: string })?.error ?? `scorm-publish returned ${res.status}`;
    throw new PublishError(errMsg, res.status, parsed);
  }

  const result = parsed as PublishResult;
  if (!result.courseId || !Array.isArray(result.moduleIds) || !Array.isArray(result.lessonIds)) {
    throw new PublishError(
      'scorm-publish returned an unexpected response shape',
      res.status,
      parsed,
    );
  }

  return {
    courseId: result.courseId,
    moduleIds: result.moduleIds,
    lessonIds: result.lessonIds,
    warnings: result.warnings ?? [],
  };
}
