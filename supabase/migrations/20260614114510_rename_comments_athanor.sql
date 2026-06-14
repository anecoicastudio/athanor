-- Repoint profiles column comments at @athanor/core after the brand rename.
-- Comment-only; no schema change. Earlier applied migrations stay frozen
-- (append-only) — their stale package refs are historical, not corrected here.
comment on column public.profiles.identity_tags is '«Chi sei?» — curated keys from @athanor/core';
comment on column public.profiles.seeking       is '«Cosa cerchi?» — curated keys from @athanor/core';
