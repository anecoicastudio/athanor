-- #336 — profile hard-delete aborts on messages_user_shape (23514).
--
-- The collision: messages.sender_id is `on delete set null` (20260616123408:57), but
-- messages_user_shape required `kind='user' → sender_id is not null`. Deleting an
-- auth.users row cascades to profiles, and inside that same statement TWO referential
-- actions race over the member's messages: conversations.participant_a/b CASCADE (which
-- deletes the whole conversation and its messages) and sender_id SET NULL. When the
-- SET NULL update reaches a user-kind row before the conversation cascade removes it, the
-- CHECK rejects the transient shape and the entire erasure transaction aborts — the exact
-- 23514 reproduced on staging (issue #336).
--
-- Fix: align the CHECK with the FK's declared intent. A user message may have a null
-- sender — that is the deleted-member shape the FK already encodes. Client inserts lose no
-- ground: messages_insert_own_user (RLS) still pins kind='user' AND sender_id = auth.uid(),
-- so only a referential action (or the trusted service role) can produce a null-sender user
-- row. The body requirement stays.
--
-- End-state note (mechanics only, policy untouched): TODAY a hard-delete still removes the
-- member's conversations entirely via the participant cascade, so null-sender user rows are
-- transient within the delete statement. They become durable only if a future, counsel-gated
-- decision (#184) preserves counterpart conversations — this shape is forward-compatible
-- with that outcome without pre-deciding it. The erasure-job legal gate is untouched.
--
-- The stale `-- NULL for system/prompt` comment on sender_id (20260616123408:57) is
-- corrected in supabase/MIGRATIONS-ERRATA.md; pgTAP 0097 asserts the behaviour.

alter table public.messages drop constraint messages_user_shape;
alter table public.messages add constraint messages_user_shape check (
  (kind = 'user' and char_length(coalesce(body, '')) > 0) or
  (kind in ('system', 'prompt') and sender_id is null)
);

comment on constraint messages_user_shape on public.messages is
  '#336: user messages need a non-empty body; system/prompt rows are senderless. A null sender on kind=user is the deleted-member shape produced by the sender_id ON DELETE SET NULL action — RLS (messages_insert_own_user) still forces sender = self on every client insert.';
