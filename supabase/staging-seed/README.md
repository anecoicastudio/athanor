# staging-seed — a populated world on the staging project

`seed-staging.sql` fills the **hosted staging project** with twelve people who have
dreams, milestones, events, posts, conversations, Momenti, a moderation queue and a
fund edition — enough that a real phone build has something to walk through.

This is not `supabase/seed.sql`. That one is the two-user seed wired to `[db.seed]`
in `config.toml`, it runs on `supabase db reset` against a local Docker stack, and it
is deliberately disabled (a public demo profile polluted the anon-visibility pgTAP
tests). The two files never run in the same place and neither replaces the other.

## Why this cannot run on production

The first statement aborts unless the database says it is staging:

```sql
current_setting('app.settings.environment', true) = 'staging'
```

Production has never had that GUC set, so the file raises and exits before touching a
table. There is no second safety net and there does not need to be — but that also
means **the guard is only as good as the GUC**, so never set
`app.settings.environment = 'staging'` on the production project, not even briefly.

## Running it

Once per project, as the operator:

```sql
alter database postgres set app.settings.environment = 'staging';
```

GUCs set this way apply to _new_ sessions, so reconnect before seeding. Then run the
file — via the SQL editor, `psql`, or the Supabase MCP.

Order matters if you want Aura to appear: deploy the edge functions and set the
`app.settings.*_url` / `*_key` GUCs **first**. The M6 award triggers fire on the
content this file inserts, and they reach the score-engine over `pg_net`; with the
GUCs unset those calls fail quietly and you get a populated world with an empty
`aura_events`. Seeding again afterwards will not retry them — the inserts are already
done. To get Aura on an already-seeded database, act in the app instead.

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

## What is deliberately not seeded

These are the paths where a hand-written row would prove nothing, so they have to be
walked for real in the app:

| not seeded                                                                                            | why                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `aura_events`, `aura_scores`                                                                          | Rule 1 — only the score-engine writes them. The M6 triggers produce them from the seeded content, if the function and GUCs are deployed. |
| `event_tickets`, `circle_memberships`, `fund_contributions`, `verifications`, `stripe_webhook_events` | Stripe is the source of truth. Use test mode from the app.                                                                               |
| `event_attendance`, `event_live_stats`                                                                | Written by the `check-in` edge function.                                                                                                 |
| `gdpr_export_jobs`                                                                                    | Written by the export job.                                                                                                               |
| `push_tokens`                                                                                         | Needs a real device token from a real build.                                                                                             |
| `post_media`, and the files behind `moments` / `story_segments`                                       | Need real objects in Storage. The rows point at paths that do not exist, so media will fail to load — expected.                          |
