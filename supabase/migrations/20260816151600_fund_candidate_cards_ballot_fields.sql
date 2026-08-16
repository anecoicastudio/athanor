-- #227 — the ballot card carries the numbers and the evidence the vote is actually about.
-- FUND-09/FUND-10/FUND-11/FUND-50 · decisions D10–D13, D43 (docs/FUND-DECISIONS.md).
--
-- #225 put budget_cents, min_viable_cents, skills_needed and dream_id on
-- dream_candidacies; nothing carried them to the reader. `fund_candidate_cards` is the
-- ONLY row the ballot and the detail screen read (getCandidates / getCandidateById both
-- `select('*')` from it), so a column that never reached the view is a column no voter can
-- see — the same defect shape as #282's poster.
--
-- Two halves here:
--   (1) four columns appended to the view — pure passthrough from dream_candidacies.
--   (2) the linked dream's CONFIRMED history, which cannot be a plain join. See §1.

-- ── 1. athanor.dream_confirmed_counts — why a DEFINER aggregate ─────────────────────────
-- `milestone_helps` is party-scoped: milestone_helps_select_party (20260614131843) admits
-- the helper or the dream owner and nobody else. A voter is neither, so joining it into a
-- security_invoker view returns ZERO helps for every third-party reader — not an error, an
-- empty count that reads as «this candidate has been helped by no one». That is a false
-- claim about a member, produced by RLS rather than by the facts.
--
-- Same shape, same remedy as public.profile_stat_counts (20260704085845): a DEFINER
-- function that exposes AGGREGATES ONLY — never a row, never an id, never a helper's
-- identity. The private negotiation the helps table protects stays protected; what crosses
-- the boundary is two integers about work that was completed.
--
-- Only CONFIRMED states count (the issue's whole argument, and rule #3's line): a milestone
-- is 'done', a help is 'completed'. An 'offered' help is a promise, not history — and it is
-- also the number a candidate could inflate by asking friends to offer. The two enums are
-- the same ones the M6 engine scores on (+10 own-milestone, +40 helper), so «confirmed»
-- here means exactly what it means to Aura.
--
-- Lives in `athanor`, not `public`: the schema is not exposed to PostgREST, so this is not a
-- client-callable RPC — it exists for the view. EXECUTE still has to be granted to
-- authenticated, because security_invoker=true means the VIEW runs as its caller and the
-- caller must be able to call what the view calls.
--
-- Returns NO ROW (→ null columns via the LEFT JOIN LATERAL) when there is no dream to speak
-- for: p_dream_id null, caller unauthenticated, or the dream soft-deleted. That is
-- deliberately distinct from returning (0,0), which means «a live linked dream with nothing
-- confirmed yet». The reader needs both states and they are not the same sentence.
create function athanor.dream_confirmed_counts(p_dream_id uuid)
returns table (milestones_done integer, helps_confirmed integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*)::int
       from public.dream_milestones m
      where m.dream_id = p_dream_id
        and m.status = 'done'
        and m.deleted_at is null),
    (select count(*)::int
       from public.milestone_helps h
       join public.dream_milestones m on m.id = h.milestone_id
      where m.dream_id = p_dream_id
        and m.deleted_at is null
        and h.status = 'completed'
        and h.deleted_at is null)
  where p_dream_id is not null
    and (select auth.uid()) is not null
    and exists (
      select 1 from public.dreams d
      where d.id = p_dream_id and d.deleted_at is null
    )
$$;

comment on function athanor.dream_confirmed_counts(uuid) is
  '#227/FUND-50: aggregate-only confirmed history of a linked dream (milestones done, helps completed). SECURITY DEFINER because milestone_helps is party-scoped and a voter is neither party — a plain join would silently count zero. Exposes counts only; no row returned when the dream is absent, soft-deleted or the caller is anonymous.';

revoke execute on function athanor.dream_confirmed_counts(uuid) from public, anon;
grant execute on function athanor.dream_confirmed_counts(uuid) to authenticated;

-- Index support: dream_milestones_by_dream (dream_id, position, created_at, id) WHERE
-- deleted_at is null covers the milestone count; milestone_helps_by_milestone
-- (milestone_id, …) WHERE deleted_at is null covers the join. Both already exist
-- (20260614101747 / 20260614131843) — no new index, and the per-row cost on a ≤20-card
-- keyset page is two index scans over a member's own handful of tappe.

-- ── 2. the view ─────────────────────────────────────────────────────────────────────────
-- Appended LAST, for the reason 20260812120121 records: `create or replace view` may only
-- ADD columns, never reorder or retype existing ones, and a drop+create would discard the
-- `revoke all from anon` / `grant select to authenticated` pair plus the view comment.
-- security_invoker is restated — omitting it silently turns this into a definer view and
-- the ballot stops composing with dream_candidacies RLS (pgTAP 0045 asserts the option).
--
-- The lateral is LEFT JOIN … on true so an unlinked candidacy keeps its row and simply
-- carries null history.
create or replace view public.fund_candidate_cards
with (security_invoker = true)
as
  select
    c.id          as candidacy_id,
    c.edition_id,
    c.profile_id,
    p.handle,
    d.text        as title,
    c.city,
    c.category,
    c.status,
    c.video_url,
    c.created_at,
    c.thumb_path,
    c.budget_cents,
    c.min_viable_cents,
    c.skills_needed,
    c.dream_id,
    h.milestones_done   as dream_milestones_done,
    h.helps_confirmed   as dream_helps_confirmed
  from public.dream_candidacies c
  join public.profiles p on p.id = c.profile_id
  left join public.dreams d
    on d.profile_id = c.profile_id and d.status = 'active' and d.deleted_at is null
  left join lateral athanor.dream_confirmed_counts(c.dream_id) h on true
  where c.deleted_at is null;
