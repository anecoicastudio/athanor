-- #721 review follow-up, same PR: a 'failed' export told the member nothing.
--
-- 20260908152740 added the fourth status and the export screen renders `gdpr.export.failed` for
-- it, but the producer 20260813162227 installed fires only on `new.status = 'ready'`. So the two
-- terminal outcomes were asymmetric: success reached the member wherever they were, failure waited
-- for them to reopen Settings → I tuoi dati and notice. #129's whole premise is that a member
-- should not have to poll that screen, and a member whose archive silently never arrives is
-- exactly the person the notification exists for.
--
-- Same producer, same notification `type` ('gdprExport') and the same `entity_ref`, so the row
-- routes to the export screen — which is where the request button that retries it lives. Only the
-- template key differs. The type CHECKs are untouched: a new type would have needed a preferences
-- row, a push category and a client visual for a state that is the same subject as the one beside
-- it.
--
-- The function keeps the name `notify_gdpr_export_ready`. Renaming it means dropping and
-- recreating the trigger for a cosmetic gain; its comment below carries the widening instead.

create or replace function athanor.notify_gdpr_export_ready() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'ready' and old.status is distinct from 'ready' then
    perform athanor.enqueue_notification(
      new.profile_id, 'gdprExport', 'notif.tpl.gdprExport',
      '{}'::jsonb,
      jsonb_build_object('kind', 'gdprExport', 'id', new.id::text)
    );
  -- 'failed' is terminal and re-requestable, so this fires at most once per job (#721). Guarded on
  -- the transition, not the value, for the same reason the 'ready' arm is: the touch trigger and
  -- the lease both write this row more than once.
  elsif new.status = 'failed' and old.status is distinct from 'failed' then
    perform athanor.enqueue_notification(
      new.profile_id, 'gdprExport', 'notif.tpl.gdprExportFailed',
      '{}'::jsonb,
      jsonb_build_object('kind', 'gdprExport', 'id', new.id::text)
    );
  end if;
  return new;
end; $$;

comment on function athanor.notify_gdpr_export_ready() is
  '#129 + #721: gdpr_export_jobs status→ready enqueues the «your archive is ready» notification (notif.tpl.gdprExport) and status→failed the «we could not prepare it, ask again» one (notif.tpl.gdprExportFailed), both type gdprExport, both to the requester via the guarded fan-out. Named for the ''ready'' arm it was born with; it now carries both terminal outcomes, because a member whose archive never arrives is the one who most needs telling. Each arm guards on the TRANSITION, so the lease''s repeated writes cannot re-notify. SECURITY DEFINER to reach athanor.enqueue_notification; search_path locked; execute revoked below (trigger-only).';

-- `create or replace` preserves the existing ACL, so this is a belt-and-braces restatement of
-- 20260813162227's revoke rather than a change: 0121 asserts that no trigger function grants
-- EXECUTE to public, anon or authenticated, and a function that gained an arm should not quietly
-- gain a caller either. service_role is untouched — it is not named here.
revoke execute on function athanor.notify_gdpr_export_ready() from public, anon, authenticated;
