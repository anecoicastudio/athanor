-- 0085_handle_new_user_locale.test.sql
-- handle_new_user v4 (20260810135250_harden_handle_new_user_locale.sql) — a signup must
-- survive whatever an OAuth provider puts in the `locale` claim, and must survive the
-- referral helper being unavailable.
--
-- Why this exists: profiles.locale is `check (locale in ('it','en'))`, and v3 inserted the
-- claim verbatim after guarding only NULL and ''. Google's OIDC `locale` is BCP-47 — bare
-- ('en') for some accounts, region-tagged ('en-GB') for others — so a region tag raised 23514
-- and GoTrue reported "Database error saving new user". Per account, hence intermittent.
-- Invisible until an OAuth provider is enabled, because (auth)/welcome.tsx's email signup
-- sends only display_name + referral_code and never a locale at all. Every pre-existing
-- fixture in this suite passes '{"locale":"it"}', which is exactly the value that always
-- worked — so the suite could not have caught it.
--
-- The inserts are wrapped in lives_ok rather than left bare: "the insert does not raise" IS
-- the claim under test, and a bare insert that regresses aborts the transaction and bails the
-- plan instead of failing one readable assertion.
--
-- CI-only (hosted lacks pgtap).

begin;

create extension if not exists pgtap with schema extensions;

select plan(19);

-- ── the mapping, asserted directly ───────────────────────────────────────────────────────
select is(athanor.normalize_locale('it'), 'it', 'bare it is kept');
select is(athanor.normalize_locale('en'), 'en', 'bare en is kept');
select is(
  athanor.normalize_locale('en-GB'),
  'en',
  'a region-tagged en collapses to its primary subtag — the case that raised 23514'
);
select is(athanor.normalize_locale('it-IT'), 'it', 'a region-tagged it collapses too');
select is(
  athanor.normalize_locale('EN-gb'),
  'en',
  'matching is case-insensitive — providers are not consistent about case'
);
select is(
  athanor.normalize_locale('fr-FR'),
  'it',
  'an unsupported language falls back to it, never to a value the CHECK rejects'
);
select is(
  athanor.normalize_locale(' en_US '),
  'en',
  'underscore-style tags and stray whitespace normalise too'
);

-- ── through a real signup: each of these would have aborted the insert under v3 ──────────
select lives_ok(
  $$
    insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
    values
      ('00000000-0000-0000-0000-000000000000', 'aaaa0085-0000-0000-0000-000000000085',
       'authenticated', 'authenticated', 'locale_gb@test.athanor', '{"locale":"en-GB"}'::jsonb, now(), now()),
      ('00000000-0000-0000-0000-000000000000', 'bbbb0085-0000-0000-0000-000000000085',
       'authenticated', 'authenticated', 'locale_itit@test.athanor', '{"locale":"it-IT"}'::jsonb, now(), now()),
      ('00000000-0000-0000-0000-000000000000', 'cccc0085-0000-0000-0000-000000000085',
       'authenticated', 'authenticated', 'locale_fr@test.athanor', '{"locale":"fr-FR"}'::jsonb, now(), now()),
      ('00000000-0000-0000-0000-000000000000', 'dddd0085-0000-0000-0000-000000000085',
       'authenticated', 'authenticated', 'locale_none@test.athanor', '{}'::jsonb, now(), now())
  $$,
  'no locale claim aborts the signup insert'
);

select is(
  (select count(*) from public.profiles
    where id in ('aaaa0085-0000-0000-0000-000000000085', 'bbbb0085-0000-0000-0000-000000000085',
                 'cccc0085-0000-0000-0000-000000000085', 'dddd0085-0000-0000-0000-000000000085')),
  4::bigint,
  'every signup created a profile'
);

select is(
  (select locale from public.profiles where id = 'aaaa0085-0000-0000-0000-000000000085'),
  'en',
  'en-GB signup lands as en'
);
select is(
  (select locale from public.profiles where id = 'bbbb0085-0000-0000-0000-000000000085'),
  'it',
  'it-IT signup lands as it'
);
select is(
  (select locale from public.profiles where id = 'cccc0085-0000-0000-0000-000000000085'),
  'it',
  'fr-FR signup falls back to it rather than failing'
);
select is(
  (select locale from public.profiles where id = 'dddd0085-0000-0000-0000-000000000085'),
  'it',
  'a claim-less signup still defaults to it (the email path sends no locale)'
);

-- ── referral plumbing is fail-open even when the helper is gone ──────────────────────────
-- v3 called athanor.redeem_referral outside any exception block; the fail-open handler lives
-- inside that function, so its ABSENCE raises 42883 and kills signup. Drop it inside this
-- transaction and prove BOTH trigger paths still land. plpgsql late-binds, so the drop is not
-- blocked by a pg_depend edge, and none of the rows above took the perform branch.
select lives_ok(
  $$ drop function athanor.redeem_referral(uuid, jsonb) $$,
  'redeem_referral can be dropped — nothing holds a hard dependency on it'
);

-- path A: confirmations-OFF, user born already-confirmed → handle_new_user calls it
select lives_ok(
  $$
    insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data,
                            email_confirmed_at, created_at, updated_at)
    values
      ('00000000-0000-0000-0000-000000000000', 'eeee0085-0000-0000-0000-000000000085',
       'authenticated', 'authenticated', 'locale_noref@test.athanor',
       '{"locale":"en","referral_code":"WHATEVER"}'::jsonb, now(), now(), now())
  $$,
  'signup survives a missing redeem_referral on the confirmations-OFF path'
);
select is(
  (select locale from public.profiles where id = 'eeee0085-0000-0000-0000-000000000085'),
  'en',
  'that profile still landed, with its locale normalised'
);

-- path B: confirmations-ON — the branch the hosted projects actually run. The insert leaves
-- email_confirmed_at null (so handle_new_user skips redemption), then the UPDATE fires
-- on_auth_user_confirmed, which is the call site rewritten alongside handle_new_user.
select lives_ok(
  $$
    insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
    values
      ('00000000-0000-0000-0000-000000000000', 'ffff0085-0000-0000-0000-000000000085',
       'authenticated', 'authenticated', 'locale_confirm@test.athanor',
       '{"locale":"it-IT","referral_code":"WHATEVER"}'::jsonb, now(), now())
  $$,
  'an unconfirmed signup lands'
);
select lives_ok(
  $$
    update auth.users set email_confirmed_at = now()
    where id = 'ffff0085-0000-0000-0000-000000000085'
  $$,
  'confirmation survives a missing redeem_referral on the confirmations-ON path'
);
select is(
  (select locale from public.profiles where id = 'ffff0085-0000-0000-0000-000000000085'),
  'it',
  'the confirmed profile is intact after the confirmation trigger ran'
);

select * from finish();
rollback;
