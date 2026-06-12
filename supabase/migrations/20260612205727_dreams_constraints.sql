-- Review hardening for 20260612204606_onboarding_identity (already applied — append-only).

-- 1. Bound the tag arrays: client writes go through PostgREST, the curated
--    vocabulary lives in @kaira/core (client-side), so the DB enforces only
--    sane upper bounds against abuse.
alter table public.profiles
  add constraint profiles_identity_tags_bounds
    check (coalesce(array_length(identity_tags, 1), 0) <= 10),
  add constraint profiles_seeking_bounds
    check (coalesce(array_length(seeking, 1), 0) <= 10);

-- 2. Dreams text must not be blank (empty active dream would satisfy
--    "has a dream" checks).
alter table public.dreams
  add constraint dreams_text_not_blank
    check (char_length(btrim(text)) >= 1);

-- 3. Soft-deleted dreams must not be member-visible (GDPR job hard-deletes
--    later; until then deleted rows were readable by every member).
drop policy "dreams_select_authenticated" on public.dreams;
create policy "dreams_select_authenticated"
  on public.dreams for select
  to authenticated
  using (deleted_at is null);
