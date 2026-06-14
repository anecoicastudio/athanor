-- email_waitlist — pre-launch interest capture from the web marketing landing.
-- Anon visitors submit an email; rows are read only via service_role (dashboard /
-- export job). Not user content: no owner, no auth, no soft-delete, no aura.
-- Deny-by-default RLS with a single anon/authenticated INSERT policy (rule #2).
-- email is stored normalized (lowercase/trim by the @athanor/schemas boundary);
-- a unique index makes re-submits a no-op the API helper swallows (23505).

create table public.email_waitlist (
  id         uuid primary key default gen_random_uuid(),
  email      text not null check (char_length(email) between 3 and 320),
  locale     text not null default 'it' check (locale in ('it', 'en')),
  source     text check (source is null or char_length(source) <= 80),
  created_at timestamptz not null default now()
);

comment on table public.email_waitlist is
  'Pre-launch email waitlist captured from the web landing. Anon insert-only; readable only via service_role. Not user content (no owner / RLS-ownership predicate).';

create unique index email_waitlist_email_key on public.email_waitlist (email);

-- privileges — anon (landing visitors) + authenticated may INSERT only; never read.
revoke all on table public.email_waitlist from anon, authenticated;
grant insert on table public.email_waitlist to anon, authenticated;
grant all on table public.email_waitlist to service_role;

alter table public.email_waitlist enable row level security;

-- INSERT: anyone (anon or member) may add an email; nothing else is permitted.
create policy "email_waitlist_insert_anon"
  on public.email_waitlist for insert
  to anon, authenticated
  with check (true);

-- no select/update/delete policy: rows are read & purged only by service_role.
