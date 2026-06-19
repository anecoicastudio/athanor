-- M8 Athanor Circle — full-text search
--
-- Adds trigram + accent-insensitive search over profiles / projects / events.
-- Security: search_all is security INVOKER → target-table RLS filters rows for free.
-- Ranking: text relevance (word_similarity) + id tie-break only — never aura/circle/entitlement (rule #1).
-- Cursor: keyset on (rank desc, id desc) — never offset (rule #9).
-- Advanced filters (f_aura_min, f_city, f_star): Circle-members only; silently dropped for non-members.
-- listings (Fase 3, spec 12): a future union-all arm added when the table ships — no signature change.
--
-- Match operator — word_similarity (`<%`), NOT plain similarity (`%`):
--   The searchable text concatenates several fields (handle+bio+tags, title+description, title+venue).
--   Plain `similarity()`/`%` measures WHOLE-string similarity, so a short needle that is a substring of
--   one field is diluted by the other fields and falls under the 0.3 threshold (e.g. 'elen' vs
--   'elena_web freelance crescita' = 0.13 → MISS). `word_similarity()`/`<%` measures the needle against
--   the best-matching word/extent of the document, which is exactly the spec's stated goal — substring +
--   typo tolerance ('videomak'→'videomaker', and the typo 'videomakr' which ILIKE alone would miss).
--   Empirically (default word_similarity_threshold 0.6): 3-char prefixes ≈0.75, longer ≈0.8–1.0.
--   Operand order is `needle <% document` (a<%b = word_similarity(a,b)); with the document = the indexed
--   expression on the RIGHT, the trigram GIN index accelerates the match.
--
-- Index/predicate parity: each arm's `<%` match-expression and its word_similarity() rank-expression are
-- written IDENTICALLY to the matching GIN index expression below so the planner can use the trigram
-- index — Postgres matches expression trees, not semantics, so `title` and `coalesce(title,'')` differ.
--
-- Immutability: index expressions must be IMMUTABLE. `unaccent()` and `array_to_string()` are both only
-- STABLE in core Postgres, so they cannot appear directly in an index. We wrap them in IMMUTABLE SQL
-- helpers (f_unaccent, f_profile_search) — the standard promise-wrapper pattern; both are genuinely
-- deterministic for text/text[] input — and index on the wrappers.
--
-- search_path='' + the pg_trgm operators: with an empty search_path the bare `<%` operator (defined in
-- the `extensions` schema) is NOT resolvable, so every trigram match uses the explicit
-- `OPERATOR(extensions.<%)` form. `extensions.word_similarity(...)` is already schema-qualified.

-- ── §2.0 extensions + immutable helpers ──────────────────────────────────────────────────────────

-- trigram matching: substring + fuzzy on short fields (handle, title, venue), IT/EN-agnostic.
create extension if not exists pg_trgm  with schema extensions;
create extension if not exists unaccent with schema extensions;  -- accent-insensitive (è≈e, à≈a)

-- immutable unaccent wrapper (the stock unaccent() is STABLE → not index-usable directly).
create function public.f_unaccent(text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$ select extensions.unaccent('extensions.unaccent', $1) $$;

-- immutable profiles search-text builder: flattens handle+bio+tag arrays to one unaccented string.
-- array_to_string() is only STABLE → wrapping it in an IMMUTABLE function makes the expression
-- index-usable (deterministic for text[]); used IDENTICALLY by the index and the RPC people arm.
create function public.f_profile_search(p_handle text, p_bio text, p_tags text[], p_seeking text[])
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select public.f_unaccent(
    coalesce(p_handle,'') || ' ' || coalesce(p_bio,'') || ' ' ||
    array_to_string(p_tags,' ') || ' ' || array_to_string(p_seeking,' ')
  )
$$;

-- ── §2.1 indexes (trigram GIN, partial on live rows) ─────────────────────────────────────────────

-- profiles: handle + bio + tag arrays (via the immutable builder).
-- profiles has no deleted_at (account removal = GDPR erasure, M9) → unpartitioned index.
create index profiles_search_trgm on public.profiles using gin (
  (public.f_profile_search(handle, bio, identity_tags, seeking)) extensions.gin_trgm_ops
);

-- events: title + venue (events have no description column — 04 §2.1)
create index events_search_trgm on public.events using gin (
  (public.f_unaccent(coalesce(title,'') || ' ' || coalesce(venue,''))) extensions.gin_trgm_ops
) where deleted_at is null;

-- projects: title + description
create index projects_search_trgm on public.projects using gin (
  (public.f_unaccent(coalesce(title,'') || ' ' || coalesce(description,''))) extensions.gin_trgm_ops
) where deleted_at is null;

-- listings (Fase 3, spec 12): add the same shape when the table ships.

-- ── §2.2 RPC — public.search_all(...) ────────────────────────────────────────────────────────────

-- one search over all in-scope entities; security invoker → target-table RLS does the filtering.
-- advanced filters (aura_min, city, star) are accepted ONLY for Circle members (§2.3).
create function public.search_all(
  q            text,
  scope        text    default 'all',     -- 'all'|'people'|'projects'|'events'|'marketplace'
  cursor_rank  real    default null,       -- keyset cursor (word_similarity rank)
  cursor_id    uuid    default null,
  page_size    integer default 20,
  -- advanced filters (Circle-gated, §2.3) — ignored for non-members:
  f_aura_min   integer default null,       -- people only
  f_city       text    default null,       -- events (venue) / people
  f_star       text    default null        -- people only (one of the six star_id values)
)
returns table (
  entity_type text,         -- 'person'|'project'|'event'
  id          uuid,
  title       text,         -- handle / project title / event title
  subtitle    text,         -- bio snippet / category / venue+date
  rank        real
)
language plpgsql
stable
security invoker             -- caller's RLS applies to every target table (visibility + not_blocked)
set search_path = ''
as $$
declare
  member boolean;
  needle text := public.f_unaccent(coalesce(q, ''));
begin
  if length(btrim(needle)) < 2 then
    return;                  -- too-short query → empty (avoid full scans)
  end if;

  -- entitlement gate: advanced filters apply ONLY for Circle members (06 §2.7, 08 §3.3).
  -- entitlements is security_invoker + self-scoped → this reads the caller's own row.
  select coalesce(bool_or(e.advanced_filters), false) into member
  from public.entitlements e;
  if not member then
    f_aura_min := null; f_city := null; f_star := null;   -- silently drop (client shows the lock pill)
  end if;

  return query
  with hits as (
    -- PEOPLE (match + rank expr === profiles_search_trgm index expr; needle <% document)
    select 'person'::text as entity_type, p.id,
           p.handle as title,
           left(coalesce(p.bio,''), 140) as subtitle,
           extensions.word_similarity(needle, public.f_profile_search(p.handle, p.bio, p.identity_tags, p.seeking)) as rank
    from public.profiles p
    where scope in ('all','people')
      and needle operator(extensions.<%) public.f_profile_search(p.handle, p.bio, p.identity_tags, p.seeking)
      -- advanced filters (members only; null when dropped):
      and (f_aura_min is null
           or coalesce((select s.score from public.aura_scores s where s.profile_id = p.id), 0) >= f_aura_min)
      and (f_star is null
           or exists (select 1 from public.stars st
                       where st.profile_id = p.id and st.star_id = f_star and st.granted_at is not null))
      and (f_city is null or p.bio ilike '%' || f_city || '%')   -- people have no geo; weak city match on bio

    union all
    -- PROJECTS (match + rank expr === projects_search_trgm index expr; needle <% document)
    select 'project', pr.id, pr.title,
           pr.category::text,
           extensions.word_similarity(needle, public.f_unaccent(coalesce(pr.title,'') || ' ' || coalesce(pr.description,'')))
    from public.projects pr
    where scope in ('all','projects')
      and pr.deleted_at is null
      and needle operator(extensions.<%) public.f_unaccent(coalesce(pr.title,'') || ' ' || coalesce(pr.description,''))

    union all
    -- EVENTS (match + rank expr === events_search_trgm index expr; needle <% document)
    select 'event', ev.id, ev.title,
           coalesce(ev.venue,'') ,
           extensions.word_similarity(needle, public.f_unaccent(coalesce(ev.title,'') || ' ' || coalesce(ev.venue,'')))
    from public.events ev
    where scope in ('all','events')
      and ev.deleted_at is null
      and needle operator(extensions.<%) public.f_unaccent(coalesce(ev.title,'') || ' ' || coalesce(ev.venue,''))
      and (f_city is null or ev.venue ilike '%' || f_city || '%')
    -- listings (Fase 3): + another union all arm here when 12 ships; scope 'marketplace'.
  )
  select h.entity_type, h.id, h.title, h.subtitle, h.rank
  from hits h
  -- keyset cursor (never offset): strictly after (cursor_rank, cursor_id)
  where cursor_rank is null
     or (h.rank, h.id) < (cursor_rank, cursor_id)
  order by h.rank desc, h.id desc
  limit least(coalesce(page_size, 20), 50);
end;
$$;

-- authenticated-only (in-app surface); NOT anon. Locked + explicit grant (00 §4.1 discipline).
revoke execute on function public.search_all(text, text, real, uuid, integer, integer, text, text) from public, anon;
grant  execute on function public.search_all(text, text, real, uuid, integer, integer, text, text) to authenticated;
