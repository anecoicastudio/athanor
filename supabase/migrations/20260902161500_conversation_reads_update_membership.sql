-- conversation_reads: the UPDATE policy checks membership too (#637, athanor-reviewer).
--
-- 20260902153057 (this PR, already applied to staging — hence a new file rather than an edit)
-- shipped `conversation_reads_update_own` constraining `profile_id` in USING and WITH CHECK and
-- nothing else, under a table-level UPDATE grant. Its comment then claimed the opposite:
--
--   "Membership is checked on INSERT and not on UPDATE: the row can only have been created by a
--    participant, and `profile_id` is pinned by both clauses, so an update cannot move a cursor
--    onto a conversation the caller was never in."
--
-- The conclusion does not follow. `conversation_id` is pinned by neither clause, so
-- `update public.conversation_reads set conversation_id = '<a conversation I am not in>'
--  where profile_id = <me>` passes WITH CHECK, passes the FK and passes the unique constraint.
-- Membership was checked at INSERT and then never again.
--
-- Nothing leaks: `conversation_reads_select_own` keeps the row private to its owner, so the only
-- reachable outcome is self-inflicted — the member loses their own cursor and their own thread
-- re-lights. What makes it worth a migration rather than an errata line is that the INSERT
-- policy's membership check becomes decorative if the same row can be walked to any conversation
-- id afterwards, and 0142 asserted only the INSERT half, so the suite agreed with the comment
-- instead of with the schema.
--
-- The predicate is the INSERT policy's, verbatim. `alter policy` rather than drop + create so the
-- policy keeps its identity and 0142's `policies_are` list is untouched.
alter policy "conversation_reads_update_own" on public.conversation_reads
  using (profile_id = (select auth.uid()))
  with check (
    profile_id = (select auth.uid())
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_reads.conversation_id
        and (select auth.uid()) in (c.participant_a, c.participant_b)
    )
  );
