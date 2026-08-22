# staging-seed — a populated world on the staging project

`seed-staging.sql` fills the **hosted staging project** with twelve people who have
dreams, milestones, events, posts, conversations, Momenti, a moderation queue and a
fund edition — enough that a real phone build has something to walk through.

This is not `supabase/seed.sql`. That one is the two-user seed wired to `[db.seed]`
in `config.toml`, it runs on `supabase db reset` against a local Docker stack, and it
is deliberately disabled (a public demo profile polluted the anon-visibility pgTAP
tests). The two files never run in the same place and neither replaces the other.

## Why this cannot run on production

**Two gates, both required**, in the first statement of the file:

1. **The environment marker** — `athanor.runtime_setting('environment')` must equal
   `staging`. That resolver reads the `app.settings.environment` GUC if one is set,
   else the Vault secret of the same name. Staging carries the Vault secret;
   production carries neither, so the resolver returns NULL and the file raises before
   touching a table.
2. **A typed confirmation** — `app.settings.seed_confirm` must be `yes` **in the
   session running the file**.

Gate 2 is not ceremony. Gate 1's marker travels: a dump, a PITR restore or a clone
carries Vault contents with it, so restoring staging into production would silently
make gate 1 true. A session setting cannot travel — someone has to type it, against
the connection they are about to seed.

So: **never create the `app.settings.environment` secret on the production project**,
not even briefly. And do not weaken gate 2 into a database-level setting to save
keystrokes; that is the one thing it exists to not be.

## Running it

Once per project, as the operator — a Vault secret, not a GUC:

```sql
select vault.create_secret('staging', 'app.settings.environment');
```

> A hosted project **cannot** set `app.settings.*` as a database GUC any more:
> `alter database postgres set app.settings.environment = 'staging'` fails with
> **42501 permission denied to set parameter**, because supautils allows only a fixed
> list of parameters and no custom prefix is on it. That is why the marker lives in
> Vault and the gate reads it through `athanor.runtime_setting`. On a local stack the
> GUC still works and still wins, so `alter database … set` remains fine there.

Then run the file with both gates in one session:

```bash
psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 \
  -c "set app.settings.seed_confirm = 'yes'" \
  -f supabase/staging-seed/seed-staging.sql
```

`-c` and `-f` share a session, which is what gate 2 needs — two separate `psql`
invocations will fail. If you have no database password (the CLI authenticates with
its own token and never stores one), the fallback is a **single** Management-API call
with the `set` prepended to the file body:

```
POST https://api.supabase.com/v1/projects/<ref>/database/query
{"query": "set app.settings.seed_confirm = 'yes';\n<contents of seed-staging.sql>"}
```

One call is one session. The endpoint takes the whole 44 KB file; a 403 with
`error code: 1010` there is the WAF objecting to long runs of repeated characters, not
a size limit.

Order matters if you want Aura to appear: deploy the edge functions and create the
eight `app.settings.*_url` / `*_key` **Vault secrets first** (see
`docs/PRODUCTION-READINESS.md` Appendix A). The M6 award triggers fire on the content
this file inserts, and they reach the score-engine over `pg_net`; unconfigured, those
calls no-op quietly and you get a populated world with an empty `aura_events`. Seeding
again afterwards will not retry them — the inserts are already done. To get Aura on an
already-seeded database, act in the app instead.

The engine writes asynchronously, so the summary the file prints at the end shows
`aura_events` and `notifications` at 0 even on a healthy run. Re-count them a few
seconds later: on the 2026-08-10 staging run they settled at 3 `aura_events`,
3 `aura_scores` and 20 `notifications`. Expect **6 and 6** from a fresh seed since
#448 — the three paid-event organisers are `identity_verified` now, because
`events_enforce_paid_gate` refuses a paid event whose organiser is not, and each
verification carries the same disclosed +50 the three candidacy authors do.

## Signing in

Every account uses one password:

|          |                                  |
| -------- | -------------------------------- |
| email    | `<handle>@staging.athanor.local` |
| password | `Athanor2026!`                   |

Handles: `sole_designer`, `luna_dev`, `marta_ceramica`, `gio_musica`, `ele_yoga`,
`tino_chef`, `vera_erbe`, `rocco_film`, `sara_startup`, `dario_legno`, `nina_poeta`,
`bea_foto`. `sole_designer` is the richest account (public profile, three milestones,
help received, stars, invites, a conversation); start there.

The addresses are on `staging.athanor.local`, which cannot receive mail — that is the
point. If you need to test a flow that sends email, sign up a real address from the
app instead; those accounts sit alongside the seeded ones without disturbing them.

## Re-running

Idempotent. Every row's id is derived from a semantic key
(`md5('post:' || handle || ':1')::uuid`), so a second run inserts nothing.

The flip side: **editing a body and re-running does not update the row**. Delete it
first, or change the key. To start over completely, delete the twelve `auth.users`
rows — everything else cascades — and run the file again.

⚠ **Storage objects do NOT cascade.** Deleting the twelve users leaves every uploaded
photo and video orphaned in its bucket, and the re-seeded rows point at fresh keys, so
the old objects are unreachable dead weight. Empty the five buckets in the same pass.

Two exceptions to "a re-run inserts nothing": the `profiles` UPDATE in §1 (documented
below) and the story `expires_at` refresh in §6. The latter is deliberate — seeded
stories expire after 20 hours and the daily prune soft-deletes them, so without the
refresh a second run would produce a world with exactly one visible story.

## Hourly refresh (`refresh-staging.sql`)

The seeded world decays while it is tested: a swiped Momento never comes back (the
pair is unique and the matcher never re-proposes it), stories expire after 20 hours,
events drift into the past, statuses get flipped by walking the flows.
`refresh-staging.sql` installs `public.staging_refresh_world()` plus a pg_cron job
(`staging-refresh-world`, `7 * * * *`) that restores all of that every hour:

- **Momenti deck** — every persona holds 3 pending cards, scored with the matcher's
  own affinity rules from live tags. Swipe as a persona and the cards are back within
  the hour (delete + re-insert; the status guard forbids un-passing a row).
- **Stories** — the nine seeded segments get `expires_at` pushed back out to 20 hours
  once they come within 4 of expiring, and un-soft-deleted if the prune got them.
- **Events** — the four future events re-stamp to their seeded offsets (+4/+9/+16/+25
  days) once they decay within 3 days of now, with any live-window state cleared;
  `bottega-aperta` stays deliberately past.
- **Fund ballot window** — `fund_editions.voting_starts_at` / `voting_ends_at` re-stamp
  to the seeded −7/+23-day span once the ballot comes within 7 days of closing, or was
  never declared at all. `cast_vote` gates on that window, so without this the fake
  world's voting goes inert and no re-seed can reopen it (the seed writes the span once,
  behind `on conflict do nothing`). The two window columns only — the cycle's `phase`,
  `target_at` and D16 declarations are left exactly as they are.
- **Statuses & soft-deletes** — seeded dreams, milestones, helps, connection
  requests, RSVPs, posts, comments, moments, projects and favor offers return to
  their seeded states; persona `suspended_until` / `banned_at` are cleared.

**Restorative, never a wipe.** Only rows the seed created are touched. Posts,
messages, accounts and swipes you create while testing survive every run — including
swipes on a non-persona account (sign in as a persona to get the hourly deck restore,
or fall back to the full re-seed above). It is diff-aware: an untouched world
produces zero writes, so an idle hour fires no notifications; persona `moment`
notifications older than 2 hours are pruned on each run to cap the noise.

What it deliberately does **not** restore: preference toggles (consent, notification
preferences), reactions, resolved reports, conversations/messages, the GoTrue half of
a ban (clear that from the Dashboard — SQL cannot reach it), and the fund cycle's own
progress — `phase`, `candidacy_window_open` and the cosmetic `target_at` countdown.
Walking the cycle forward is real testing, not decay, and re-entering `voting` fires
the ballot-open trigger; use the full re-seed above to rewind it.

Install once (same two gates as the seed; the function additionally self-gates on the
staging Vault marker, so it is inert anywhere else):

```bash
psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 \
  -c "set app.settings.seed_confirm = 'yes'" \
  -f supabase/staging-seed/refresh-staging.sql
```

(or the single Management-API `database/query` call with the `set` prepended — one
call is one session, same as the seed.)

On demand, without waiting for the hour:

```bash
pnpm staging:refresh --confirm
```

It authenticates with your own CLI credential (`SUPABASE_ACCESS_TOKEN` or the macOS
keychain entry `supabase login` created) and prints the function's jsonb summary.

Verify: `select jobname, schedule, active from cron.job;` shows `staging-refresh-world`,
and `cron.job_run_details` keeps each run's summary in `return_message`.

**The bytes reaper cannot touch a seeded story while this job runs (#31).** Since
`20260821075230` the nightly `prune-expired-story-segments` (03:17) also asks the
`story-segment-reaper` edge function to delete, through the Storage API, every object in
`story-segments` whose row has been expired or soft-deleted for over an hour. The hourly
refresh keeps every seeded row live (`expires_at = now() + 20h`, in place, no re-upload), so
a seeded object is never a candidate — `select * from public.story_segment_reap_candidates(1000)`
on staging is the check, and it returns nothing while the refresh is healthy. If the refresh is
**off for more than ~21 h** the seeded rows expire, the next nightly pass frees their bytes, and
a later refresh or re-seed revives rows that point at nothing: re-run `pnpm staging:media`.

⚠ **Keep it in step with the seed.** The refresh function carries frozen copies of the
seed's semantic-key lists (stories, events, statuses, content ids). Any edit to those
sections of `seed-staging.sql` requires re-running `refresh-staging.sql`. The deck is
the exception — it recomputes from live profiles. And as with the seed itself: this
job must **never** be installed on production.

⚠ **gen:types picks it up.** `pnpm gen:types` reads staging, so after installing this
the generated `database.types.ts` gains a `staging_refresh_world` entry in
`Functions`. Expected, not schema drift: the RPC exists only on staging and only
`service_role` may execute it.

## Media

The seed writes the descriptor rows and the storage **keys**; it cannot write bytes.
Two commands finish the job:

```bash
./supabase/staging-seed/transcode-media.sh   # sources → docs/test-stories/derived/
pnpm staging:media --confirm                 # derived/ → the five buckets
```

The upload script never composes a key. It derives each row's id the same way the SQL
does, looks the row up, and uploads to whatever the path column literally contains — so
the two cannot drift. It then signs and fetches every object **as a seeded member**,
not as service role, because service role bypasses RLS and would have happily "verified"
the old unreadable keys.

Source media lives in `docs/test-stories/` and is not in the repo (`docs/` is
gitignored). Filenames the transcode expects, and which persona each file belongs to,
are the tables in `transcode-media.sh`.

Keys are `{uid}/{id}.{ext}` — the shape the app itself uploads at. The earlier
`<handle>/stories/<md5>.jpg` shape could never have worked: since
`20260808151808_storage_not_blocked_predicate.sql` every private bucket's SELECT policy
requires the first path segment to match a dashed-uuid regex, and a handle fails it.

## What is deliberately not seeded

These are the paths where a hand-written row would prove nothing, so they have to be
walked for real in the app:

| not seeded                                                                                            | why                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `aura_events`, `aura_scores`                                                                          | Rule 1 — only the score-engine writes them. The M6 triggers produce them from the seeded content (config from Vault via `athanor.runtime_setting()`).  |
| `event_tickets`, `circle_memberships`, `fund_contributions`, `verifications`, `stripe_webhook_events` | Stripe is the source of truth. Use test mode from the app.                                                                                             |
| `event_attendance`                                                                                    | Written by the `check-in` edge function.                                                                                                               |
| `event_live_stats`                                                                                    | Written by the `live_window_sweep()` cron (#120) — never by `check-in`, which this file used to claim. Listener count is Realtime presence, not a row. |
| `gdpr_export_jobs`                                                                                    | Written by the export job.                                                                                                                             |
| `push_tokens`                                                                                         | Needs a real device token from a real build.                                                                                                           |
| the **bytes** behind `post_media` / `moments` / `story_segments` / `dream_candidacies` / avatars      | SQL cannot write to Storage. The rows and their keys are seeded; `pnpm staging:media` puts a file at each one. See **Media** above.                    |
