-- #430 — handles nobody may claim.
--
-- WHAT THIS IS NOT. The issue was filed as a routing bug: a handle equal to a literal `apps/web`
-- route was said to shadow that route. It does not. `apps/web/lib/resolve-handle.ts` returns NULL
-- for any segment without a leading `@`, so public profiles live at `/@handle` and the two
-- namespaces are disjoint — `resolve-handle.test.ts` asserts exactly that for `admin`, `terms`
-- and `privacy`. That has been true since the resolver's first commit (bc44bf2, 2026-06-14).
--
-- WHAT IT IS. Impersonation. `@supporto` or `@athanor_support`, with a chosen display name and
-- avatar, is a credible-looking official account that anyone can create for free, and no URL
-- namespace can fix that. Italian words as well as English ones: IT is the canonical catalogue,
-- so `@supporto` reads as official to this member base exactly as `@support` does.
--
-- WHY THE DATABASE, AND NOT THE CLIENT. `profiles.handle` carries INSERT and UPDATE for
-- `authenticated` — verified against this project's `information_schema.column_privileges`, not
-- inferred from the migrations, which never mention the grant (rules/supabase-db.md: hosted
-- projects drift wider than the migrations that declare them). A client can therefore set a
-- handle and change it later without passing through any Zod schema of ours, which makes a
-- client-side check worth nothing on its own. `packages/schemas/src/reserved-handles.ts` is the
-- authored home of the list and refuses early with a message; THIS is the enforcement, and
-- `packages/schemas/src/reserved-handles.mirror.test.ts` fails when the two drift.
--
-- WHY A CHECK AND NOT A LOOKUP TABLE. A table would need RLS policies, an explicit grant, a row
-- in 0121_grant_catalog_sweep.test.sql and a pgTAP file of its own — a standing surface for a
-- list that changes about once a year. A CHECK on the existing table adds no object at all, so
-- 0121 is untouched by this migration.
--
-- TWO CLAUSES, AND THE SECOND IS NOT DECORATIVE. Exact membership stops `athanor`; it does not
-- stop `athanor_support`, which is the realistic impersonation. The brand name is therefore a
-- prefix rule. Only the brand gets that treatment: `admin` is reserved, `admin_luna` is a person.
--
-- CASE IS NOT HANDLED HERE BECAUSE IT CANNOT ARISE. The column's original CHECK
-- (`handle ~ '^[a-z0-9_]{3,30}$'`, 20260612172941) admits lowercase only, so a `lower()` here
-- would compare a value against itself. If that regex is ever relaxed, this constraint has to be
-- revisited in the same migration.
--
-- VALIDATING, NOT `NOT VALID`. Existing rows are checked, so this migration ASSERTS the empty
-- state rather than assuming it: production holds 1 profile and 0 handles, and staging's 13
-- seeded handles collide with nothing (both queried 2026-08-18). If either is ever wrong, the
-- push fails loudly instead of leaving an impersonating handle grandfathered in.
--
-- NULL passes, as it must: `handle_new_user` inserts every profile with `handle` NULL, and a
-- CHECK that refused NULL would abort signup itself.

alter table public.profiles
  add constraint profiles_handle_not_reserved check (
    handle is null
    or (
      handle not like 'athanor%'
      and handle <> all (array[
        'abuse',
        'admin',
        'administrator',
        'aiuto',
        'amministratore',
        'assistenza',
        'contact',
        'contatto',
        'help',
        'info',
        'legal',
        'legale',
        'mod',
        'moderator',
        'moderatore',
        'no_reply',
        'noreply',
        'official',
        'root',
        'security',
        'sicurezza',
        'staff',
        'support',
        'supporto',
        'system',
        'team',
        'ufficiale'
      ])
    )
  );

comment on constraint profiles_handle_not_reserved on public.profiles is
  '#430: role words and the athanor% brand prefix cannot be claimed as a handle. Impersonation guard, not a routing one — public profiles resolve at /@handle, disjoint from the literal web routes. Mirrored by packages/schemas/src/reserved-handles.ts; widening it takes a new migration that drops and re-adds this constraint whole.';
