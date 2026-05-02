# Supabase migrations

SQL migrations for the **fgn.academy Supabase project** (`vfzjfkcwromssjnlrhoo`). These tables back the FGN SCORM toolkit's bridge into fgn.academy.

**These files are not auto-applied.** They are checked in for review and applied manually via your normal feature-branch flow per the deploy-safety rule. Never apply directly to the live project without preview.

## Migrations

| Timestamp | File | Purpose |
|---|---|---|
| 20260429120000 | scorm_authoring_init.sql | `scorm_launch_tokens` table + `provision_fgn_scorm_toolkit_app()` provisioning function |

## How to apply

### Recommended: Supabase CLI on a feature branch of stratify-workforce

```bash
# from the stratify-workforce repo (the fgn.academy Lovable project)
supabase link --project-ref vfzjfkcwromssjnlrhoo
# Copy this migration file into stratify-workforce/supabase/migrations/
# (Lovable manages migrations there; the toolkit is read-only for fgn.academy.)
supabase db diff -f scorm_authoring_init     # preview
supabase db push --dry-run                   # validate
supabase db push                             # apply (after review)
```

### Manual: SQL editor in Supabase dashboard

1. Open the fgn.academy project in Supabase
2. SQL Editor → New query
3. Paste the migration file contents
4. Run on a non-production database first if available
5. Run on production only after Darcy explicit OK

## Post-apply: provision the app key (run once)

After the migration is applied, capture the plaintext API key:

```sql
SELECT public.provision_fgn_scorm_toolkit_app();
```

The returned text is the plaintext key. **Capture it immediately** — it is never stored in plaintext, only hashed. Store it as `FGN_ACADEMY_APP_KEY` in:

- The toolkit's `.env.local` for local CLI testing
- The Supabase edge-function secret store on the toolkit's home Supabase project (the SCORM packager edge function will use it to call back to fgn.academy when needed)
- Any deployment env where the SCORM Player or scorm-launch-status edge function runs

To rotate later:
```sql
DELETE FROM public.authorized_apps WHERE app_slug = 'fgn-scorm-toolkit';
SELECT public.provision_fgn_scorm_toolkit_app();
```

## What the migration installs

### `scorm_launch_tokens` table
Bridge between SCORM packages and play.fgn.gg challenge attempts. Service-role-only access. Indexed by `(scorm_student_id, challenge_id)` for fast correlation when `sync-challenge-completion` fires from play.fgn.gg.

### `purge_expired_scorm_launch_tokens()` function
Lightweight cleanup utility. Returns count of purged rows. Wire to pg_cron later if accumulation becomes a concern.

### `provision_fgn_scorm_toolkit_app()` function
One-shot app registration. Inserts a row in `authorized_apps` with the toolkit's slug and a hashed API key, returns the plaintext for one-time capture.

## What this migration does NOT do

- Does NOT touch existing tables (`work_orders`, `lessons`, `courses`, `authorized_apps`, `user_roles`, etc.) — the toolkit reads/writes these via existing ecosystem APIs, never directly.
- Does NOT add Course Builder tables (`scorm_courses`, `scorm_course_modules`, `scorm_exports`, `course_media`). Those land in Phase 2 when the Course Builder UI actually drives them.
- Does NOT modify `sync-challenge-completion` or any other existing fgn.academy edge function.
- Does NOT touch play.fgn.gg's Supabase project (zero changes there per architecture directive).

## Hash algorithm note

The `provision_fgn_scorm_toolkit_app()` function hashes the API key with **SHA-256 hex** before storing. This must match what `verify_app_api_key` (the existing RPC on fgn.academy) uses to validate incoming `X-App-Key` headers. If `verify_app_api_key` uses a different algorithm (e.g. bcrypt), update the hash construction inside `provision_fgn_scorm_toolkit_app()` before applying.
