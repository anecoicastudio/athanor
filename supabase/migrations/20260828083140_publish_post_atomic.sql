-- publish_post — a post row and its media set written as ONE transaction (#588).
--
-- The composer made two round trips: `createPost` (upsert on the PK) and then
-- `replacePostMedia` (upsert on `(post_id, position)`, then sweep every position the new set
-- does not fill). Both converge under a retry, but BETWEEN them sits a committed `posts` row
-- whose `type` claims media with no `post_media` behind it — and the feed card renders zero
-- rows as nothing, so a media write that failed for any reason published a silently text-only
-- card. That is #579's headline defect. PR 585 moved the UPLOAD in front of both writes, which
-- closed the upload half and only that half; nothing could close the WRITE half from the
-- client, because PostgREST has no client-side transaction. The two statements have to move
-- behind one function, which is this one.
--
-- SECURITY INVOKER, and that is the whole decision rather than a detail. Every statement below
-- runs as the caller, so `posts_insert_own` / `posts_update_own`,
-- `post_media_insert_post_author` / `_update_post_author` / `_delete_post_author` and #106's
-- restrictive `active_write_*` net all still decide who may write what — this function adds
-- atomicity, not privilege (`confirm_milestone_help`'s shape, 20260614140546). A DEFINER
-- version would change two things silently: a suspended member would publish, because
-- `athanor.is_active()` is an RLS predicate and RLS is what DEFINER bypasses; and the
-- soft-delete edge below would stop raising and start succeeding, writing media rows under a
-- tombstone and toasting success over a post nobody can see.
--
-- It is also why this migration changes no grant. The RPC needs precisely the privileges the
-- caller already held — `authenticated` keeps `select, insert, update` on `posts` and
-- `select, insert, update, delete` on `post_media` — so `0121_grant_catalog_sweep`'s declared
-- table surface is untouched. What 0121 does need is the `revoke execute … from public, anon`
-- below: PostgreSQL grants EXECUTE to PUBLIC on every new function and the `pg_default_acl`
-- 'f' row adds anon on top, and 0121 pins both allow-lists by name.
--
-- `author_id` is not a parameter. It is `auth.uid()`, the way an edge function derives
-- `profile_id` from `getUser()` rather than from the request body. The policies would refuse a
-- lie anyway; a parameter nobody may set is a parameter that should not exist. `post_id` is
-- gone from the media payload for the same reason — the function assigns it, so a row aimed at
-- someone else's post is not refused, it is unrepresentable.

create function public.publish_post(
  p_category public.post_category,
  p_body     text,
  p_id       uuid             default null,
  p_type     public.post_type default 'text',
  p_is_step  boolean          default false,
  p_tags     text[]           default '{}'::text[],
  p_media    jsonb            default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_post_id   uuid := coalesce(p_id, gen_random_uuid());
  v_positions int[];
  v_post      public.posts%rowtype;
begin
  if v_uid is null then
    raise exception 'publish_post: authentication required' using errcode = '42501';
  end if;

  if p_media is null or jsonb_typeof(p_media) <> 'array' then
    raise exception 'publish_post: p_media must be a json array'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Positions first, because three of the four guards below are about them and all three must
  -- refuse BEFORE anything is written. Read from the same `jsonb_to_recordset` shape the
  -- insert uses, so the set the guards judge is the set the insert writes.
  select coalesce(array_agg(m.position), '{}'::int[])
    into v_positions
    from jsonb_to_recordset(p_media) as m("position" int);

  if array_position(v_positions, null) is not null then
    raise exception 'publish_post: a media row carries no position'
      using errcode = 'not_null_violation';
  end if;

  -- The one input ON CONFLICT cannot take: Postgres refuses to affect a row twice in the same
  -- command, and says so in a message about the statement rather than about the caller's set.
  if cardinality(v_positions) <> (select count(distinct p) from unnest(v_positions) as p) then
    raise exception 'publish_post: two media rows share a position'
      using errcode = 'unique_violation';
  end if;

  -- #588's invariant, stated where it can be held: a post is text if and only if it carries no
  -- media. Atomicity closes the FAILURE path to a text-only card; this closes the caller-error
  -- path to the same card. It is the degenerate case of `derivePostType` (`@athanor/core`), not
  -- a second copy of it — the precedence video > audio > image is the client's to apply, and
  -- duplicating it here would be two rules to keep in step instead of one.
  if (p_type = 'text') <> (cardinality(v_positions) = 0) then
    raise exception 'publish_post: type % does not match a media set of % row(s)',
      p_type, cardinality(v_positions) using errcode = 'check_violation';
  end if;

  -- UPSERT on the PK, never delete-and-reinsert: `subscribeNewPosts` filters `event: 'INSERT'`,
  -- so a converge must emit UPDATE or a retry re-fires the "Nuovi passi ›" banner for a post
  -- the feed already showed (#579).
  --
  -- `where p.deleted_at is null` is the soft-delete edge, closed by construction rather than by
  -- luck. Republishing into a tombstone is not a converge, and without this the media upsert
  -- below would meet it as a 42501 from an unrelated policy: ON CONFLICT DO UPDATE must reach
  -- the conflicting row through `post_media_select_authenticated`, whose predicate carries
  -- `posts.deleted_at is null` — which `post_media_update_post_author` does not. Refusing here
  -- makes that unreachable and says what actually happened. It cannot be raced, either: this
  -- statement locks the post row, so a concurrent soft-delete waits for this transaction.
  --
  -- A colliding id belonging to someone ELSE is refused rather than merged, and by a different
  -- mechanism: `posts_update_own` carries the ownership predicate in USING as well as WITH
  -- CHECK, so the DO UPDATE raises before this WHERE is ever consulted, and nothing of theirs
  -- is returned either way.
  insert into public.posts as p (id, author_id, category, type, body, is_step, tags)
  values (v_post_id, v_uid, p_category, p_type, p_body, p_is_step, p_tags)
  on conflict (id) do update
     set category = excluded.category,
         type     = excluded.type,
         body     = excluded.body,
         is_step  = excluded.is_step,
         tags     = excluded.tags
   where p.deleted_at is null
  returning * into v_post;

  if not found then
    raise exception 'publish_post: post % has been deleted', v_post_id
      using errcode = 'no_data_found';
  end if;

  -- Upsert on `post_media_post_position`, the (post_id, position) unique index and NOT the
  -- primary key: the payload carries no `id`, so the default conflict target would make every
  -- row new and hand a retry the 23505 this exists to stop. Every writable column is set from
  -- `excluded`, so a surviving row is rewritten whole — kind, path, poster, dimensions,
  -- duration — which is what makes a re-tap converge on the draft as it stands NOW rather than
  -- as the failed attempt left it. The storage key is `{uid}/{postId}/{position}.{ext}`, so the
  -- retry's uploads have already overwritten the bytes at every shared position holding the
  -- same kind; a row that described the old file there would describe a file that is gone.
  insert into public.post_media as pm
    (post_id, kind, storage_path, thumb_path, "position", width, height, duration_s)
  select v_post_id, m.kind, m.storage_path, m.thumb_path, m."position",
         m.width, m.height, m.duration_s
    from jsonb_to_recordset(p_media) as m(
           kind         public.media_kind,
           storage_path text,
           thumb_path   text,
           "position"   int,
           width        int,
           height       int,
           duration_s   int)
  on conflict (post_id, "position") do update
     set kind         = excluded.kind,
         storage_path = excluded.storage_path,
         thumb_path   = excluded.thumb_path,
         width        = excluded.width,
         height       = excluded.height,
         duration_s   = excluded.duration_s;

  -- Then sweep every position the new set does not fill. An EMPTY set deletes them all — that
  -- is the case a caller-side `if (rows.length > 0)` guard can never see (#586), and it is what
  -- a member who removed every attachment between two taps is asking for. `= any('{}')` is
  -- false for every row, so the empty case needs no branch of its own.
  --
  -- The BYTES are not swept. Objects the previous set uploaded and this one does not reference
  -- stay in the `post-media` bucket, the same trade the composer already makes for an abandoned
  -- draft. Erasure still reaches them: `gdpr_storage_footprint` sweeps by `{uid}/` prefix.
  delete from public.post_media pm
   where pm.post_id = v_post_id
     and not (pm."position" = any (v_positions));

  -- The media half is read back from the table rather than from the upsert's RETURNING: only
  -- the sweep knows the final set, and PostgREST hands an upsert's rows back in no defined
  -- order anyway. Ordered by position, which is the order the card renders in.
  return jsonb_build_object(
    'post', to_jsonb(v_post),
    'media', coalesce(
      (select jsonb_agg(to_jsonb(pm) order by pm."position")
         from public.post_media pm
        where pm.post_id = v_post_id),
      '[]'::jsonb)
  );
end;
$$;

comment on function public.publish_post(
  public.post_category, text, uuid, public.post_type, boolean, text[], jsonb) is
  'Publishes a post and its media set in ONE transaction (#588), so a failing media write can no longer leave a posts row whose type claims media with nothing behind it. SECURITY INVOKER: adds atomicity, not privilege — RLS and #106''s active_write_* net still decide. author_id is auth.uid(); the media payload carries no post_id. Writes no aura (rule #1).';

revoke execute on function public.publish_post(
  public.post_category, text, uuid, public.post_type, boolean, text[], jsonb) from public, anon;
grant  execute on function public.publish_post(
  public.post_category, text, uuid, public.post_type, boolean, text[], jsonb) to authenticated;
