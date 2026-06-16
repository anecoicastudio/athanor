-- M5 conversations-chat follow-up (athanor-reviewer W1): make conversations read-only to clients.
-- The slice never updates conversations from the client — last_message_at / last_message_preview
-- are written ONLY by the bump_conversation_on_message SECURITY DEFINER trigger (which bypasses
-- grants + RLS). The original migration shipped a premature client UPDATE policy whose WITH CHECK
-- only re-asserted membership, so a participant could rewrite their own conversation's preview,
-- reorder their list via last_message_at, change created_from, or reassign participant_a/_b — write
-- surface with no consumer and contrary to the table's "creation + bump are server-side" invariant.
-- Drop the policy and revoke the UPDATE grant so the table is read-only to clients. A future
-- read-state slice (conversation_reads) will introduce its own narrowly-scoped policy + pgTAP.
drop policy if exists "conversations_update_participant" on public.conversations;
revoke update on table public.conversations from authenticated;
