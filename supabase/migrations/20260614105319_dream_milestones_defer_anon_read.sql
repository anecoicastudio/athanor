-- M2 milestones-crud — defer the anon public-@handle read of tappe.
-- dream_milestones_select_anon_public (migration 20260614101747) joins dreams + profiles,
-- but neither table grants anon SELECT yet (backend 02 §2.1 Delta B / §2.2 add those in the
-- public-handle-ssr slice). Under the anon role the subquery references anon-denied tables →
-- permission error, so the anon read path is non-functional. Remove it until the web slice
-- wires the anon SELECT across profiles + dreams + dream_milestones together.
drop policy if exists "dream_milestones_select_anon_public" on public.dream_milestones;
revoke select on table public.dream_milestones from anon;
