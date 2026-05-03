# Phase 1.4.6 — `--upload-to-academy`: server-side cover upload

**Status:** spec drafted, ready for review and Lovable deployment.

**Scope:** add a CLI flag that uploads generated cover images to fgn.academy's `media-assets` Supabase Storage bucket and stamps the resulting public URL onto `course.coverImageRemoteUrl`.

This closes the **Decision C: both** vote we made in Phase 1.4.5 — covers will be both ZIP-embedded (offline-safe) AND fgn.academy-hosted (catalog/admin UI accessible).

## Architecture

Same pattern as `scorm-publish`: toolkit → X-App-Key edge function → Supabase Storage with service role.

```
@fgn/scorm-builder CLI
       ↓ (POST /functions/v1/media-upload + X-App-Key)
       ↓ multipart or base64-JSON body: { courseId, slot: 'cover-image', filename, bytes, mimeType }
       ↓
fgn.academy edge function: media-upload
       ↓ validates app key against authorized_apps table
       ↓ writes to media-assets bucket: scorm-covers/<courseId>-<sha256-prefix>.png
       ↓ returns { url: 'https://vfzj…/storage/v1/object/public/media-assets/scorm-covers/…' }
       ↓
@fgn/scorm-builder CLI
       ↓ stamps course.coverImageRemoteUrl = url
       ↓ writes updated course.enhanced.json
```

## Edge function spec — `media-upload`

Goes on `FGN2025/stratify-workforce` at `supabase/functions/media-upload/index.ts`.

### Endpoint

`POST https://vfzjfkcwromssjnlrhoo.supabase.co/functions/v1/media-upload`

### Auth

Header: `X-App-Key: <fgn-scorm-toolkit-app-key>` — same key already provisioned for `scorm-publish` via `provision_fgn_scorm_toolkit_app()`. Validates against the `authorized_apps` table; rejects if `app_slug != 'fgn-scorm-toolkit'` or key hash mismatches.

### Request body (JSON, base64 bytes inline)

Use JSON with base64-encoded bytes rather than multipart — simpler to implement, easier to test with `fetch`, and the size overhead (~33%) is acceptable for sub-MB images. Multipart can be a future optimization.

```jsonc
{
  "courseId": "bundle-ff3ea57d",            // string, used in storage path
  "slot": "cover-image",                    // enum: only 'cover-image' for v0; reserve for future thumbnails
  "filename": "cover.png",                  // hint only; storage path uses sha256 of bytes
  "mimeType": "image/png",
  "bytes": "iVBORw0KGgoAAAANSUhEUg…"        // base64-encoded PNG
}
```

### Response

```jsonc
// 200 OK — success
{
  "url": "https://vfzjfkcwromssjnlrhoo.supabase.co/storage/v1/object/public/media-assets/scorm-covers/bundle-ff3ea57d-7357751.png",
  "storagePath": "scorm-covers/bundle-ff3ea57d-7357751.png",
  "bytes": 1784812,
  "mimeType": "image/png"
}

// 401 Unauthorized — bad/missing X-App-Key
{ "error": "missing or invalid X-App-Key" }

// 400 Bad Request — validation failure
{ "error": "bytes field too large; max 10MB" }

// 413 Payload Too Large — body exceeds Supabase edge function limit (~10MB after base64)
{ "error": "request body exceeds 10MB limit; reduce image size" }

// 500 Internal Server Error
{ "error": "storage write failed: <details>" }
```

### Implementation sketch (Deno / Supabase edge function)

```ts
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { decode as decodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts';
import { createHash } from 'https://deno.land/std@0.224.0/crypto/mod.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BUCKET = 'media-assets';
const PATH_PREFIX = 'scorm-covers/';
const MAX_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_SLOTS = new Set(['cover-image']);
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);

interface RequestBody {
  courseId: string;
  slot: string;
  filename: string;
  mimeType: string;
  bytes: string;
}

async function validateAppKey(req: Request): Promise<boolean> {
  const key = req.headers.get('X-App-Key');
  if (!key) return false;
  // Hash the key the same way scorm-publish does, compare to authorized_apps.key_hash
  // (omitted for brevity — copy exact pattern from scorm-publish/index.ts)
  return true;
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405 });
  }

  if (!(await validateAppKey(req))) {
    return new Response(JSON.stringify({ error: 'missing or invalid X-App-Key' }), { status: 401 });
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid JSON body' }), { status: 400 });
  }

  // Validate
  if (!body.courseId || typeof body.courseId !== 'string') {
    return new Response(JSON.stringify({ error: 'courseId required' }), { status: 400 });
  }
  if (!ALLOWED_SLOTS.has(body.slot)) {
    return new Response(JSON.stringify({ error: `unknown slot: ${body.slot}` }), { status: 400 });
  }
  if (!ALLOWED_MIME.has(body.mimeType)) {
    return new Response(JSON.stringify({ error: `unsupported mimeType: ${body.mimeType}` }), { status: 400 });
  }
  if (!body.bytes) {
    return new Response(JSON.stringify({ error: 'bytes required' }), { status: 400 });
  }

  // Decode + size check
  const bytes = decodeBase64(body.bytes);
  if (bytes.byteLength > MAX_BYTES) {
    return new Response(JSON.stringify({ error: `bytes too large: ${bytes.byteLength} > ${MAX_BYTES}` }), { status: 413 });
  }

  // Hash for stable storage path
  const hashBuf = await crypto.subtle.digest('SHA-256', bytes);
  const hashHex = Array.from(new Uint8Array(hashBuf))
    .slice(0, 4)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const ext = body.mimeType === 'image/png' ? 'png' : body.mimeType === 'image/webp' ? 'webp' : 'jpg';
  const storagePath = `${PATH_PREFIX}${body.courseId}-${hashHex}.${ext}`;

  // Upload via service role
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { error: uploadErr } = await sb.storage
    .from(BUCKET)
    .upload(storagePath, bytes, {
      contentType: body.mimeType,
      upsert: true, // re-upload if same hash already exists
      cacheControl: '31536000', // 1 year — content-addressed
    });

  if (uploadErr) {
    return new Response(JSON.stringify({ error: `storage write failed: ${uploadErr.message}` }), { status: 500 });
  }

  const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(storagePath);

  return new Response(
    JSON.stringify({
      url: pub.publicUrl,
      storagePath,
      bytes: bytes.byteLength,
      mimeType: body.mimeType,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});
```

### Storage policies

The `media-assets` bucket is already public (per `useMediaLibrary` patterns we observed). No RLS changes needed — the edge function uses service role to write, public read is already enabled.

### Deploy

Same Lovable workflow as `scorm-publish` and `scorm-launch-status`:
1. Push the function file to `FGN2025/stratify-workforce`
2. Ask Lovable chat to "deploy media-upload edge function"
3. Test with cURL:

```bash
curl -X POST https://vfzjfkcwromssjnlrhoo.supabase.co/functions/v1/media-upload \
  -H "X-App-Key: $FGN_ACADEMY_APP_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "courseId": "test-001",
    "slot": "cover-image",
    "filename": "test.png",
    "mimeType": "image/png",
    "bytes": "iVBORw0KGgo…"
  }'
```

## Toolkit-side spec

### New helper in `@fgn/course-enhancer`

`packages/course-enhancer/src/academy-uploader.ts`:

```ts
export interface UploadCoverOptions {
  /** App key for fgn.academy. Defaults to FGN_ACADEMY_APP_KEY env var. */
  appKey?: string;
  /** Endpoint base URL. Defaults to vfzjfkcwromssjnlrhoo.supabase.co/functions/v1. */
  endpoint?: string;
  /** Course ID to use in the storage path. */
  courseId: string;
}

export interface UploadCoverResult {
  url: string;
  storagePath: string;
}

export async function uploadCoverToAcademy(
  bytes: Buffer,
  mimeType: string,
  opts: UploadCoverOptions,
): Promise<UploadCoverResult> {
  const appKey = opts.appKey ?? process.env.FGN_ACADEMY_APP_KEY;
  if (!appKey) {
    throw new Error('FGN_ACADEMY_APP_KEY required for uploadCoverToAcademy');
  }
  const endpoint = opts.endpoint ?? 'https://vfzjfkcwromssjnlrhoo.supabase.co/functions/v1';
  const res = await fetch(`${endpoint}/media-upload`, {
    method: 'POST',
    headers: {
      'X-App-Key': appKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      courseId: opts.courseId,
      slot: 'cover-image',
      filename: 'cover.png',
      mimeType,
      bytes: bytes.toString('base64'),
    }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`media-upload failed: HTTP ${res.status} — ${errBody}`);
  }
  const json = await res.json();
  return { url: json.url, storagePath: json.storagePath };
}
```

### Wire-in to `enhance.ts`

After `runImageSlot` succeeds, optionally call `uploadCoverToAcademy` if `opts.uploadToAcademy === true`:

```ts
if (slots.includes('coverImage') && imageClient) {
  // ...existing image generation...
  if (result.asset && opts.uploadToAcademy) {
    try {
      const uploaded = await uploadCoverToAcademy(
        result.asset.bytes,
        result.asset.mimeType,
        { courseId: course.id },
      );
      draft.coverImageRemoteUrl = uploaded.url;
    } catch (err) {
      warnings.push({
        level: 'warn',
        code: 'ENHANCER_UPLOAD_FAILED',
        message: `Cover image generated but upload to fgn.academy failed: ${stringifyError(err)}. Local cover.png still embedded in ZIP.`,
      });
    }
  }
}
```

Note that upload failure is **non-fatal** — the ZIP-embedded cover still works. We just don't get the remote URL stamp.

### CLI flag

Add to `cmdEnhance` in `packages/scorm-builder/src/cli.ts`:

```ts
const uploadToAcademy = args.flags['upload-to-academy'] === 'true';

if (uploadToAcademy && !process.env.FGN_ACADEMY_APP_KEY) {
  console.error('FGN_ACADEMY_APP_KEY env var is required when --upload-to-academy is set.');
  process.exit(2);
}

// ...pass through to enhanceCourse:
const result = await enhanceCourse(course, {
  // ...existing opts...
  ...(uploadToAcademy ? { uploadToAcademy: true } : {}),
});
```

Update CLI doc header + help block to mention the flag.

## End-to-end test sequence

1. Edge function deployed and verified via cURL
2. Toolkit-side rebuilt: `pnpm --filter @fgn/course-enhancer build && pnpm --filter @fgn/scorm-builder build`
3. Set both keys: `set-keys.ps1` for AI, plus `$env:FGN_ACADEMY_APP_KEY = "..."` for upload
4. Run:
   ```powershell
   node packages\scorm-builder\dist\cli.js enhance `
     .\acceptance\gold-challenge-v15.json `
     --slots coverImage `
     --upload-to-academy `
     --cache-dir .\.enhancer-cache
   ```
5. Verify:
   - `course.enhanced.json` has both `coverImageUrl: "assets/cover.png"` and `coverImageRemoteUrl: "https://…"`
   - The remote URL resolves in a browser to the actual cover image
   - The image appears in fgn.academy's media library admin UI under `scorm-covers/`

## Open questions

1. **Storage path collisions across tenants** — current path is `scorm-covers/<courseId>-<hash>.png`. If two tenants generate covers for the same `courseId` (unlikely but possible), they'd collide. Mitigation: include tenant id in path, or rely on the hash since identical bytes → same path is fine. *Recommend: leave as-is for v0; revisit when multi-tenant lands.*

2. **Image size limits** — Supabase edge functions cap request body at ~10MB after base64 decoding. Our medium-quality 1536x1024 PNGs run ~2.5MB → fits. High-quality could exceed if we ever support `--image-quality high`. Mitigation: switch to multipart upload OR use signed-URL upload pattern (toolkit gets a presigned URL, uploads directly to storage). *Recommend: leave as-is for v0; multipart is a future optimization.*

3. **Caching of remote URLs** — the toolkit currently caches generated bytes locally. Should the remote URL be part of that cache? Otherwise re-running with `--upload-to-academy` re-uploads bytes we've already uploaded. *Recommend: yes, but as part of v0.1; not blocking initial ship.*

## Effort estimate

| Step | Owner | Hours |
|---|---|---|
| Edge function source written | Claude | 1 |
| Edge function deployed via Lovable | User | 0.5 |
| Toolkit-side `uploadCoverToAcademy` helper | Claude | 0.5 |
| Wire-in to `enhance.ts` + CLI flag | Claude | 0.5 |
| End-to-end test | User | 0.5 |
| **Total** | | **3 hours** |

Comparable in scope to the `scorm-launch-status` deployment from Phase 1.5.

## Decision points before starting implementation

1. **Confirm path** — `scorm-covers/<courseId>-<hash>.<ext>` good?
2. **Confirm allowed mimeTypes** — `image/png`, `image/jpeg`, `image/webp`?
3. **Confirm upload failure is non-fatal** — image still ships in ZIP, warning emitted, no error exit?
4. **Confirm flag name** — `--upload-to-academy` or `--upload-cover`?

Once those are answered, I implement the toolkit side and you deploy the edge function.
