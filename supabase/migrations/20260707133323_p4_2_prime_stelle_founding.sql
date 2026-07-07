-- P4.2 — Prime Stelle founding cohort: profiles.founding_member.
-- COSMETIC ONLY (PRD §4.12 / frontend 10 §3.6 PS-2/PS-5): the founding badge is granted,
-- never earned, and confers ZERO Aura — no aura_events type exists for it (rule #1).
-- Distinct from circle_memberships.founding_member (the M8 Circle-billing perk).

alter table public.profiles add column founding_member boolean not null default false;

comment on column public.profiles.founding_member is
  'Prime Stelle founding-cohort badge (launch cohort, PS-2). Cosmetic only — ZERO Aura, no feed/Momenti priority (PS-5, rule #1). Set by service_role ops when the cohort is chosen; NOT in the m7 client column grants, so clients can never write it (identity_verified precedent). Distinct from circle_memberships.founding_member.';

-- No grant changes: authenticated already has table-wide SELECT on profiles (members-wide
-- read); the m7 column-locked INSERT/UPDATE grants deliberately do not include this column;
-- the anon column-scoped SELECT grant (id, handle, visibility, updated_at) is untouched.
