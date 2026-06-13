-- Refresh column comments after KAIRA → AURIA rename (@kaira/core → @auria/core).
-- Comment-only; no schema change. Source-comment refs in earlier applied
-- migrations stay frozen per the append-only rule.
comment on column public.profiles.identity_tags is '«Chi sei?» — curated keys from @auria/core';
comment on column public.profiles.seeking       is '«Cosa cerchi?» — curated keys from @auria/core';
