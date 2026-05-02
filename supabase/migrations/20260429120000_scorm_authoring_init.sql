-- ===================================================================
-- FGN SCORM Toolkit — fgn.academy bootstrap migration
-- Target: fgn.academy Supabase project (vfzjfkcwromssjnlrhoo)
-- ===================================================================
--
-- v0 lean schema — only what's needed for Phase 1.3:
--
--   scorm_launch_tokens   bridge tokens for play.fgn.gg deep-links
--                         from inside SCORM packages
--
--   provision_fgn_scorm_toolkit_app()
--                         one-shot function that registers the
--                         "fgn-scorm-toolkit" entry in authorized_apps
--                         and returns a fresh API key plaintext
--                         (the only opportunity to capture it)
--
-- Tables for the Course Builder admin UI (scorm_courses,
-- scorm_course_modules, scorm_exports, course_media) are deferred to
-- Phase 2 when the UI actually drives them. Adding them now would be
-- speculative.
--
-- Existing tables this migration depends on (provided by stratify-workforce):
--   authorized_apps      — apps that can call fgn.academy ecosystem APIs
--   user_roles           — admin role check for RLS
--   work_orders          — fgn.academy's challenge-as-learning-unit
--                          (joined to scorm_launch_tokens by
--                           source_challenge_id at query time)
--   user_work_order_completions
--                        — driven by sync-challenge-completion when
--                          play.fgn.gg challenges are completed
--
-- Cross-database notes:
--   scorm_launch_tokens.challenge_id is a logical reference to
--   challenges.id on play.fgn.gg (Supabase project yrhwzmkenjgiujhofucx).
--   Not FK-enforceable at the Postgres level. Correlation between an
--   SCORM Player session and a play.fgn.gg completion is by
--   (scorm_student_id, challenge_id), where scorm_student_id is the
--   learner's email captured from cmi.core.student_id in the SCORM API.
-- ===================================================================


-- Helper for updated_at triggers ------------------------------------
create or replace function public.set_scorm_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ===================================================================
-- scorm_launch_tokens — bridge tokens for play.fgn.gg deep-links
-- ===================================================================
-- Lifecycle:
--   1. SCORM Player calls scorm-launch-status mint endpoint -> row created (status='pending').
--   2. Player opens play.fgn.gg/challenges/{id}?fgnLaunchToken={token}.
--      play.fgn.gg ignores the query param (zero changes there).
--   3. Learner completes challenge on play.fgn.gg as usual.
--   4. play.fgn.gg's existing sync-to-academy fires, posting to
--      sync-challenge-completion on fgn.academy with
--      {user_email, challenge_id, score, ...}.
--   5. The Player polls scorm-launch-status status endpoint, which
--      joins to user_work_order_completions for the matching
--      (user_id from email, work_order from source_challenge_id).
--      When a completion exists, status flips to 'completed' and
--      preliminary_score is reported back.
create table public.scorm_launch_tokens (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  -- Logical reference to play.fgn.gg challenges.id
  challenge_id uuid not null,
  -- Identity from SCORM cmi.core.student_id (email is the standard practice)
  scorm_student_id text not null,
  -- Optional cosmetic display name from cmi.core.student_name
  scorm_student_name text,
  -- Optional: the SCORM session this token was minted for, useful for
  -- correlating multiple attempts.
  scorm_session_id text,
  status text not null default 'pending'
    check (status in ('pending', 'launched', 'completed', 'failed', 'expired')),
  preliminary_score integer,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index scorm_launch_tokens_token_idx on public.scorm_launch_tokens (token);
create index scorm_launch_tokens_status_idx on public.scorm_launch_tokens (status);
create index scorm_launch_tokens_correlation_idx
  on public.scorm_launch_tokens (scorm_student_id, challenge_id);
create index scorm_launch_tokens_expires_at_idx on public.scorm_launch_tokens (expires_at);

create trigger scorm_launch_tokens_updated_at
  before update on public.scorm_launch_tokens
  for each row execute function public.set_scorm_updated_at();


-- ===================================================================
-- RLS — service-role only at the row level
-- ===================================================================
-- The scorm-launch-status edge function uses the service role key, so
-- RLS does not block it. Direct client access is denied — clients
-- never read or write tokens directly; they go through the edge function.
alter table public.scorm_launch_tokens enable row level security;

create policy "scorm_launch_tokens deny all client reads"
  on public.scorm_launch_tokens for select
  to authenticated using (false);

create policy "scorm_launch_tokens deny all client writes"
  on public.scorm_launch_tokens for all
  to authenticated using (false) with check (false);


-- ===================================================================
-- Token cleanup — purge expired rows daily
-- ===================================================================
-- Lightweight cleanup function. Wire to pg_cron (or an external
-- scheduler) if/when accumulation becomes a concern. For now it just
-- exists as a callable utility.
create or replace function public.purge_expired_scorm_launch_tokens()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.scorm_launch_tokens
  where expires_at < now()
    and status in ('pending', 'launched', 'expired');
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;


-- ===================================================================
-- App registration — fgn-scorm-toolkit in authorized_apps
-- ===================================================================
-- The toolkit calls fgn.academy via existing ecosystem endpoints
-- (sync-challenge-completion, the new scorm-launch-status). All such
-- calls authenticate with X-App-Key matched against authorized_apps.
--
-- Run this function ONCE after applying the migration to provision
-- the app. It returns the plaintext API key — capture it immediately
-- and store as `FGN_ACADEMY_APP_KEY` in the toolkit's env. The
-- plaintext is never persisted; only its hash is stored.
--
-- To rotate the key: delete the existing authorized_apps row for
-- 'fgn-scorm-toolkit' and run the function again.
--
-- IMPORTANT: the hash algorithm must match what verify_app_api_key
-- uses on the receiving side. The pattern in stratify-workforce hashes
-- with sha256 hex (the standard pgcrypto/digest convention). If
-- verify_app_api_key uses a different algorithm (e.g. bcrypt), update
-- the hash construction below.
create or replace function public.provision_fgn_scorm_toolkit_app()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_hash text;
  v_existing uuid;
begin
  select id into v_existing
  from public.authorized_apps
  where app_slug = 'fgn-scorm-toolkit';

  if v_existing is not null then
    raise exception 'fgn-scorm-toolkit is already registered. To rotate, delete the row first: delete from authorized_apps where app_slug = ''fgn-scorm-toolkit'';';
  end if;

  -- 32 bytes of randomness, hex-encoded — 64 chars, ~256 bits of entropy.
  v_key := encode(gen_random_bytes(32), 'hex');
  v_hash := encode(digest(v_key, 'sha256'), 'hex');

  insert into public.authorized_apps (
    app_slug,
    app_name,
    api_key_hash,
    can_issue_credentials,
    can_read_credentials,
    credential_types_allowed,
    is_active
  ) values (
    'fgn-scorm-toolkit',
    'FGN SCORM Toolkit',
    v_hash,
    true,
    true,
    array['skill_verification', 'course_completion'],
    true
  );

  return v_key;
end;
$$;

comment on function public.provision_fgn_scorm_toolkit_app() is
  'One-shot provisioning. Returns the plaintext API key — the only opportunity to capture it. Store the result as FGN_ACADEMY_APP_KEY in the toolkit env.';
