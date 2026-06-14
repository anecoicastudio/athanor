-- M2 public-handle-ssr: anon may read PUBLIC profile rows + public dreams + their tappe,
-- so the Next.js athanor.app/@handle SSR page renders for logged-out visitors & crawlers.
-- Visibility is inlined (the shared athanor.is_visible_to_me / not_blocked predicates wait
-- for M9: not_blocked needs a `blocks` table that does not exist, and the block-application
-- matrix marks dreams/dream_milestones NO for not_blocked anyway — backend 10 §2A.2).
-- The authenticated SELECT policies are UNCHANGED (members read each other — M1 rule);
-- only the anon boundary is added. Data-API GRANT is separate from RLS (backend 10 §3).

-- 1) profiles: anon may read a row iff ANY section is public (row reachability;
--    per-section column shaping happens in the @athanor/api read-model, not RLS).
grant select on table public.profiles to anon;
create policy "profiles_select_anon_public"
  on public.profiles for select
  to anon
  using (
    exists (
      select 1 from jsonb_each_text(visibility) as v(k, val)
      where val = 'public'
    )
  );

-- 2) dreams: anon may read an active dream iff the owner set their `dream` section to public.
grant select on table public.dreams to anon;
create policy "dreams_select_anon_public"
  on public.dreams for select
  to anon
  using (
    deleted_at is null
    and status = 'active'
    and exists (
      select 1 from public.profiles p
      where p.id = dreams.profile_id
        and coalesce(p.visibility ->> 'dream', 'members') = 'public'
    )
  );

-- 3) dream_milestones: re-add the anon read of tappe whose parent dream is active + public
--    (migration …101747 created it; …105319 dropped it pending profiles+dreams anon grants).
grant select on table public.dream_milestones to anon;
create policy "dream_milestones_select_anon_public"
  on public.dream_milestones for select
  to anon
  using (
    deleted_at is null
    and exists (
      select 1 from public.dreams d
      join public.profiles p on p.id = d.profile_id
      where d.id = dream_milestones.dream_id
        and d.deleted_at is null and d.status = 'active'
        and coalesce(p.visibility ->> 'dream', 'members') = 'public'
    )
  );
