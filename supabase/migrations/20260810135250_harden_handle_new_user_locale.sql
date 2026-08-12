-- handle_new_user v4 — survive an OAuth provider's `locale` claim, and keep a broken referral
-- helper from taking signup down with it.
--
-- Two defects, both latent while Email is the only enabled provider, both reachable the moment
-- Google is turned on (RELEASE-RUNBOOK B-10):
--
--   1. profiles.locale is `check (locale in ('it','en'))` (20260612172941_init_profiles.sql:7),
--      but v3 inserted `coalesce(nullif(raw_user_meta_data ->> 'locale', ''), 'it')` — which
--      only guards NULL and the empty string. Every other value went in verbatim. Google's
--      OIDC `locale` claim is a BCP-47 tag: sometimes bare ('en', 'it' — fine), sometimes
--      region-tagged ('en-GB', 'it-IT' — 23514, surfaced by GoTrue as "Database error saving
--      new user"). That makes it fail PER ACCOUNT, which reads as intermittent rather than
--      broken. The email path never sends `locale` at all ((auth)/welcome.tsx sends only
--      display_name + referral_code), which is why nothing has hit it yet.
--
--      Fixed by normalising instead of trusting: lowercase, take the primary subtag, and
--      accept it only if it is one the CHECK allows. Anything else falls back to 'it'. The
--      fallback must stay inside this function rather than lean on the column default — the
--      insert names the column, so a bad value is a constraint violation, not an omission.
--
--   2. `perform athanor.redeem_referral(...)` sat outside any exception block in both
--      handle_new_user and handle_user_confirmed. The fail-open handler lives INSIDE
--      redeem_referral (20260707093739:27-39), so it protects against bad referral data but
--      not against the function being missing or unexecutable — in which case the trigger
--      raises 42883 and every signup fails.
--
--      Reachability, stated precisely: `db push` applies one file in one implicit transaction,
--      and redeem_referral ships in the same file as the trigger that calls it, so a
--      file-level abort cannot leave the pair half-applied. What can is a file applied BY HAND
--      minus a statement — which is exactly the recovery performed on production on 2026-08-10
--      (MIGRATIONS-ERRATA.md L19-53, `20260617155346` applied minus line 8, then
--      `migration repair --status applied`). So the gap is narrow but it is a path this
--      project has actually walked.
--
--      Caught NARROWLY (undefined_function / insufficient_privilege) and logged, not swallowed
--      with `when others then null`: redeem_referral already fail-opens on bad data, so the
--      only escapes are structural, and a silent catch-all would mean referral activation
--      could die in production with nothing anywhere recording it.
--
-- Trigger definitions are unchanged — on_auth_user_created and on_auth_user_confirmed still
-- point at these same two functions.

-- ── athanor.normalize_locale — an arbitrary locale claim → a value profiles.locale accepts.
-- Separate function so the mapping can be asserted directly, without a signup round trip.
-- IMMUTABLE: pure string mapping, no I/O. `search_path = ''` is safe for a SQL body — lower()
-- and split_part() live in pg_catalog, which stays implicitly first even when the path is empty.
-- translate() folds '_' to '-' so an underscore-style tag (Facebook sends en_US) is handled too;
-- trim() because a stray space would otherwise silently demote a good tag to the fallback.
create or replace function athanor.normalize_locale(p_raw text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case lower(split_part(translate(trim(coalesce(p_raw, '')), '_', '-'), '-', 1))
    when 'en' then 'en'
    when 'it' then 'it'
    else 'it'
  end;
$$;

comment on function athanor.normalize_locale(text) is
  'Map an arbitrary locale claim (BCP-47 or underscore-style, any case, possibly null) onto the two values profiles.locale permits. Unknown languages fall back to it, the column default. Exists because an OAuth provider supplies this value and a CHECK violation there aborts signup.';

revoke execute on function athanor.normalize_locale(text) from public, anon, authenticated;

-- ── handle_new_user v4
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, locale)
  values (
    new.id,
    athanor.normalize_locale(new.raw_user_meta_data ->> 'locale')
  );

  if new.email_confirmed_at is not null then
    begin
      perform athanor.redeem_referral(new.id, new.raw_user_meta_data);
    exception when undefined_function or insufficient_privilege then
      -- Structural, not data: redeem_referral fail-opens on junk itself. Log rather than
      -- swallow, so a referral path that has stopped working is discoverable.
      raise log 'handle_new_user: athanor.redeem_referral unavailable for %', new.id;
    end;
  end if;

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'auth.users INSERT trigger: create the profile row, then redeem a referral when the user is born already-confirmed (confirmations-OFF). Locale is normalised, not trusted — an OAuth provider sends BCP-47 tags the profiles.locale CHECK would reject. A missing redeem_referral is logged, never fatal.';

-- ── handle_user_confirmed — same guard on the confirmations-ON path, which is the one the
-- hosted projects actually run.
create or replace function public.handle_user_confirmed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    begin
      perform athanor.redeem_referral(new.id, new.raw_user_meta_data);
    exception when undefined_function or insufficient_privilege then
      raise log 'handle_user_confirmed: athanor.redeem_referral unavailable for %', new.id;
    end;
  end if;
  return new;
end;
$$;

comment on function public.handle_user_confirmed() is
  'auth.users UPDATE-of-email_confirmed_at trigger: redeem a referral on the confirmations-ON path. A missing redeem_referral is logged, never fatal.';

-- create-or-replace preserves existing privileges, so these two are already locked down by
-- 20260612172941 / 20260707093739. Restated so a replay from zero cannot depend on that.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.handle_user_confirmed() from public, anon, authenticated;
