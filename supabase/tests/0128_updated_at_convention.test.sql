-- #180 — the updated_at / touch-trigger convention, asserted rather than audited.
--
-- rules/supabase-db.md wants created_at + updated_at + a touch trigger on every new table.
-- Fourteen tables are deliberate exceptions; each states why in its own comment, tagged
-- `CONVENTION EXEMPTION (#180)` by 20260821164731. This file makes that the rule: a new table
-- with no updated_at fails here until it either grows the column or says why not, and the
-- exempt set is pinned by name so widening it is a decision someone had to type.
--
-- Sibling coverage: 0054_notifications_rls asserts the trigger on public.notifications actually
-- fires and that a client cannot write the column. This file only asserts shape.

begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

create temporary view convention_tables as
  select c.oid,
         c.relnamespace::regnamespace::text as sch,
         c.relname as tbl,
         exists (select 1 from pg_attribute a
                  where a.attrelid = c.oid and a.attname = 'updated_at'
                    and a.attnum > 0 and not a.attisdropped) as has_updated_at,
         exists (select 1 from pg_trigger g
                  where g.tgrelid = c.oid and not g.tgisinternal
                    and g.tgfoid = 'public.touch_updated_at()'::regprocedure) as has_touch,
         coalesce(obj_description(c.oid, 'pg_class'), '') as cmt
  from pg_class c
  where c.relkind in ('r', 'p')
    and c.relnamespace::regnamespace::text in ('public', 'athanor')
    and not c.relispartition;

-- 1. A column nothing maintains is worse than no column: it looks like a timestamp and lies.
select is_empty(
  $$ select sch || '.' || tbl from convention_tables
     where has_updated_at and not has_touch order by 1 $$,
  'every table with updated_at has the touch trigger that maintains it');

-- 2. The exemption has to be written down, at the table, where the next audit will read it.
select is_empty(
  $$ select sch || '.' || tbl from convention_tables
     where not has_updated_at and cmt not like '%CONVENTION EXEMPTION (#180)%' order by 1 $$,
  'every table without updated_at states its exemption in its table comment');

-- 3. …and the set is pinned. Adding a row here is the point: it costs a sentence of thought,
--    which is exactly what #180 found missing fourteen times.
select bag_eq(
  $$ select sch || '.' || tbl from convention_tables where not has_updated_at $$,
  $$ values ('athanor.waitlist_throttle'::text),
            ('public.athanor_days_interest'),
            ('public.audit_log'),
            ('public.aura_events'),
            ('public.aura_scores'),
            ('public.blocks'),
            ('public.candidacy_votes'),
            ('public.connections'),
            ('public.email_waitlist'),
            ('public.event_attendance'),
            ('public.messages'),
            ('public.post_reactions'),
            ('public.story_reactions'),
            ('public.stripe_webhook_events') $$,
  'the exempt set is exactly these fourteen tables');

select * from finish();
rollback;
