-- perf(supabase): covering indexes for unindexed foreign keys
--
-- Source: Supabase performance advisor (`get_advisors(type: performance)`,
-- project kwzeiqvrnnaagccyoose, 2026-07-01) — "unindexed_foreign_keys" (INFO)
-- lints. Each of these FK columns has no covering index, which forces a
-- sequential scan on the referencing table for every parent-row UPDATE/DELETE
-- (RI check) and for any query that joins/filters on the FK column.
--
-- This migration only adds indexes — no table shape changes, so
-- `pnpm gen:types` is a no-op.

create index if not exists audit_log_actor_id_idx
  on public.audit_log (actor_id);

create index if not exists candidacy_votes_voter_id_idx
  on public.candidacy_votes (voter_id);

create index if not exists connections_source_request_id_idx
  on public.connections (source_request_id);

create index if not exists conversations_participant_b_idx
  on public.conversations (participant_b);

create index if not exists dream_candidacies_profile_id_idx
  on public.dream_candidacies (profile_id);

create index if not exists event_attendance_scanned_by_idx
  on public.event_attendance (scanned_by);

create index if not exists favor_offers_need_milestone_id_idx
  on public.favor_offers (need_milestone_id);

create index if not exists fund_editions_winner_candidacy_id_idx
  on public.fund_editions (winner_candidacy_id);

create index if not exists messages_sender_id_idx
  on public.messages (sender_id);

create index if not exists momento_proposals_candidate_id_idx
  on public.momento_proposals (candidate_id);

create index if not exists post_comments_author_id_idx
  on public.post_comments (author_id);

create index if not exists post_reactions_person_id_idx
  on public.post_reactions (person_id);

create index if not exists reports_reviewed_by_idx
  on public.reports (reviewed_by);

create index if not exists story_reactions_person_id_idx
  on public.story_reactions (person_id);
