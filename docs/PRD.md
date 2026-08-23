# ATHANOR — Product Requirements Document

**Version:** 1.0 · 2026-06-12
**Source:** ATHANOR Concept Document v1.4 (2026)
**Status:** Draft for review
**Build scope:** Fase 1 (MVP Community) — full vision documented, later phases marked `[FASE 2+]`

---

## 1. Product Overview

### 1.1 Vision

Athanor is a digital ecosystem where people, professionals, companies and creatives connect to evolve together and generate real projects. Not a social network: an evolution of digital communities uniting personal growth, professional networking, business, events, marketplace, collaborations and authentic relationships in a single space.

> Traditional social networks are Chronos: time consumed.
> Athanor is Kairos: time invested.

### 1.2 Problem

| Problem                | Detail                                                              |
| ---------------------- | ------------------------------------------------------------------- |
| Followers ≠ trust      | Numbers don't tell who is reliable, competent or generous           |
| Infinite scroll        | Time consumed without generating anything real                      |
| Superficial networking | Thousands of contacts, zero real collaborations                     |
| Fragmented tools       | Community, events, marketplace, projects live on separate platforms |
| No personal growth     | No platform unites business and human evolution                     |

### 1.3 Target

- **Primary (25–55):** entrepreneurs, freelancers, professionals, coaches, creatives, artists, trainers, innovators. Too professional for Instagram, too human for LinkedIn.
- **Secondary:** people seeking personal growth, evolutionary networking, events, ethical business, modern spirituality, real collaborations.

### 1.4 Differentiators

1. **Aura** — reputation that grows only through real, verifiable actions. Cannot be bought, inflated or faked.
2. **Il Sogno** — every profile carries its owner's dream with a "Make this dream happen" button and concrete milestones.
3. **Dai Vita al Tuo Sogno** — community fund (€1+ contributions) that concretely realizes a member's dream, one cycle at a time. Always-visible countdown to the announcement = the app's heartbeat.
4. **Meritocracy is untouchable** — Athanor Circle (premium) sells tools, never position. No subscription affects score or visibility.

### 1.5 The Six Pillars

| Pillar         | What it is                                                     | Build phase                           |
| -------------- | -------------------------------------------------------------- | ------------------------------------- |
| Community      | Evolutionary feed: ideas, business, art, science, inspiration  | **Fase 1**                            |
| Athanor Live   | Online + physical events: calendar, map, streams, Athanor Days | **Fase 1**                            |
| Momenti        | Intelligent networking: the right person at the right moment   | **Fase 1**                            |
| Costellazioni  | Collaborations, project board, Tempo Bank                      | **Fase 1** (board v1) / Fase 2 (rest) |
| Marketplace    | Services, consulting, products, courses, talents               | Fase 3                                |
| Athanor Circle | Premium membership: belonging, not paywall                     | Fase 1 (sub) / Fase 4 (full)          |

Cross-cutting: **Aura** (Fase 1, v1), **Il Sogno** (Fase 1), **Dai Vita al Tuo Sogno** (Fase 1, first edition).

---

## 2. Goals & Success Metrics (Fase 1)

| Goal            | Metric                                      | Target (6 months post-launch) |
| --------------- | ------------------------------------------- | ----------------------------- |
| Activation      | % signups completing onboarding incl. dream | ≥ 60%                         |
| Core loop       | Momenti acceptance rate                     | ≥ 35%                         |
| Retention       | D30 retention                               | ≥ 25%                         |
| Real encounters | Event attendances / MAU                     | ≥ 0.3                         |
| Revenue         | Circle conversion                           | ≥ 3% of MAU                   |
| Belonging       | Fund participants per cycle                 | ≥ 10% of MAU                  |

North-star: **completed dream milestones per month** (real value generated, not time spent).

---

## 3. Scope

### 3.1 Fase 1 — IN

- Onboarding (3 questions: who are you, what do you seek, what is your dream)
- Profilo Evolutivo: bio, mission, skills, badges, Aura, events, contributions, Il Sogno
- Il Sogno + Dream Milestones + "Make this dream happen" (help = skills/connections/opportunities, **never money**)
- Home Dashboard with always-visible countdown
- Community feed: post / video / audio / evolutionary stories; tabs Tutti · Business · Human · Creativi · Evoluzione · Eventi
- Athanor Live: event calendar, map, nearby events, online streams (external link v1), tickets (Stripe)
- Momenti: affinity matching, swipe interface, "Ti potrebbe interessare", guided ice-breaker conversation
- 1:1 Messaging (realtime)
- Aura v1 + the Six Stars badges
- Verified identity (Stripe Identity)
- Dai Vita al Tuo Sogno: countdown, €1+ contributions, dream candidacies, community votes, first edition
- Athanor Circle subscription (Stripe Billing): advanced filters, analytics-lite, premium event access
- Notifications: push (mobile) + in-app
- Moderation: reports, score penalties, admin panel
- i18n: IT + EN
- GDPR: consent, field-level visibility, approximate location, export/erasure
- Costellazioni board v1 + Passa il Favore + explicit connections (§4.15 — deliberate early delivery of concept ch. 11, ruled in #148)
- Personal media gallery on the profile (§4.2)
- Aura tiers + tier-up celebration (§4.9 — presentation only)
- Athanor Days: platform-official gatherings (§4.6)
- Email waitlist + admin export (GTM surface; feeds Prime Stelle onboarding, M10)
- Prime Stelle `founding_member` cosmetic (§4.2 — never affects score)
- Remote config: server kill-switches + minimum-version boot gate (§9)
- Marketing site + legal pages (privacy, terms, cookie notice) on `apps/web`

### 3.2 Fase 1 — OUT (designed for, not built)

- Costellazioni digital coworking + Tempo Bank `[FASE 2]` — the project board itself shipped in Fase 1 (§4.15)
- Public web pages for sogni and eventi `[FASE 2]` — Fase-1 public web is @handle profiles + marketing/legal only (re-scopes #159)
- Marketplace, professional cards, reviews on transactions `[FASE 3]`
- Dream Fund (peer-to-peer milestone funding — the `contribution` help type, legal-gated, §4.3) `[FASE 3]`
- AI Assistant, Athanor Academy, full Athanor Circle business tools `[FASE 4]`
- In-app live streaming infrastructure (v1 links to external stream URL)
- Local Circles city chapters (GTM feature; schema has `city`, chapters later)

### 3.3 Explicit non-goals

- No follower counts, no vanity metrics, ever
- No ads, no attention selling
- No pay-for-visibility of any kind
- No public post pages — feed content is members-only; `/post/{id}` gets no anon grant (ruled in #148, settling #268)

---

## 4. Feature Specification (Fase 1)

### 4.1 Onboarding

Three questions, full-screen, one at a time: «Chi sei?» (role/identity tags) → «Cosa cerchi?» (goals) → «Qual è il tuo sogno?» (free text, becomes profile dream draft).

- Auth: email + password + OAuth Google (Supabase Auth). Apple sign-in is built (provider-agnostic code path) but hard-disabled (`APPLE_ENABLED = false`) pending a paid Apple Developer account; still required before App Store submission (guideline 4.8 — third-party login parity). _(Superseded from an earlier email-magic-link design — see `docs/MILESTONES.md` M0/M1.)_
- Dream skippable but heavily encouraged (activation metric). Skipped → recurring gentle prompt.
- Locale picker IT/EN (default from device).
- Acceptance: new user reaches Home with profile ≥ 70% complete in < 3 min.

### 4.2 Profilo Evolutivo

Bio, mission, skills (tags), city (approximate), badges, Aura with breakdown, events attended, contributions, Il Sogno block at top.

- Field-level visibility controls (public / members / private). Location approximate by default.
- Public web version at `www.athanor.workers.dev/@handle` (SSR, SEO, OG image with dream quote) — only fields marked public. (The domain settled on `https://www.athanor.workers.dev`, not the aspirational `athanor.app`: `apps/web/lib/site.ts:10` holds the canonical origin, and `apps/web/lib/site.test.ts:32-41` asserts it equals the host `apps/native/app.json` associates with, so the two cannot drift. Deep links only work on that host — AASA, `assetlinks` and `app.json` move together with it or not at all.)
- Personal media gallery (grid) on the profile. The backing table is `moments`, which collides with the Momenti matching pillar (whose table is `momento_proposals`) — known naming debt, rename deferred (#148).
- `profiles.founding_member` renders the Prime Stelle cosmetic card/badge — granted to the founding cohort at launch (concept ch. 21). Cosmetic only; never touches score (§4.9).
- A fully-private profile still renders a minimal public shell at `/@handle` (handle + whatever is public) rather than a 404 (#251). The per-handle OG image with dream quote is spec; currently regressed to the generic site card (#157).
- Acceptance: profile renders identically (data parity) on mobile and web; visibility flags enforced by RLS, verified by tests.

### 4.3 Il Sogno + Dream Milestones

- One active dream per profile, owner's words, visible per visibility flag. History kept.
- Milestones: discrete needs («un logo», «un mentor», «il primo cliente»). Status: open / in-progress / done.
- «Fai accadere questo sogno» → pick a milestone → offer help (skill, connection, opportunity — text + optional link). Owner accepts/declines. Completed help → score event for both + helper's star progress.
- **No money flows between members in Fase 1.** UI copy states it.
- ⚠️ **Legal gate:** the fourth help type, **contribution** — money toward another member's milestone — is the peer-to-peer Dream Fund path (`[FASE 3]`, §3.2) and carries the same fiscal/regulatory implications (IT/EU) as the pooled fund (§4.11), plus peer-to-peer questions of its own. Legal review required before it exists at all. The enum is deliberately three-valued — `20260614131843_milestone_helps.sql` («NO 'contribution' (Fase 1)») is the decision point.
- Acceptance: helper flow ≤ 3 taps from any profile; both parties notified on accept/complete.

### 4.4 Home Dashboard

Always-visible countdown widget (days to the announcement event, fund total €, contributors count — realtime), recommended events, activity, badges progress, suggested Momenti, friend invite («Porta una stella nella tua costellazione»).

### 4.5 Community Feed

- Formats: text post, image(s), video (≤ 3 min v1), audio, evolutionary story (24h+pinned-to-journey).
- Tabs: Tutti / Business / Human / Creativi / Evoluzione / Eventi. Author picks 1 category + free tags.
- Ranking v1: **chronological within tab**, light boost for first-degree connections (people you had Momenti/events with). No engagement-bait ranking. Revisit post-launch with data.
- Reactions: single «✦» (light a star) + comments. No counts displayed publicly except to author (anti-vanity); reaction feeds score capped.
- Acceptance: feed loads < 1s p75 on 4G; infinite scroll paginated 20/page.

### 4.6 Athanor Live (Events)

- Create event: title, category (business, networking, spiritualità, formazione, musica, arte, benessere), online (stream URL) or physical (venue, map pin), capacity, price (free or paid).
- Views: calendar, list, nearby. Filter by category/city/date on the calendar (#151). The map render is deferred post-launch — v1 ships the nearby list; a native maps dependency stays out of the launch path (#151, which absorbed #150).
- Paid tickets: Stripe Checkout; platform fee on top or absorbed (config per event; default 10%). Free events: 1-tap RSVP.
- Check-in: organizer scans attendee QR → attendance recorded → score event for both.
- Athanor Days: flagged platform-official gatherings (`events.is_athanor_day` + interest list), premium/Athanor Circle early access. Renamed from this doc's earlier «Kairos Days» — the concept doc names the physical gatherings Athanor Days (ch. on events, ch. 21 Local Circles); «Kairos» remains the moment register (the ✦ mark, Momenti).
- Acceptance: ticket purchase → QR in app ≤ 30s; webhook-confirmed, idempotent.

### 4.7 Momenti (Intelligent Networking)

- Nightly matcher computes affinity per active user pair: profession complementarity, shared skills/interests tags, city proximity, dream-keyword ↔ skills overlap, mutual activity. Threshold → propose max 3 Momenti/user/day (scarcity = quality).
- Push: «Hai un Momento.» Swipe interface: accept / pass. Mutual accept → conversation opens with guided ice-breaker (3 prompts auto-inserted: chi sei, cosa cerchi, qual è il tuo sogno).
- «Ti potrebbe interessare»: small curated list, refreshed daily.
- v1 deterministic SQL scoring; `[FASE 2]` pgvector embeddings, same tables.
- Acceptance: match reasons stored and displayed («Siete entrambi a Milano · design ↔ il suo sogno»). Pass = no re-propose for 90 days.

### 4.8 Messaging

1:1 realtime chat (Supabase Realtime). Text + image v1. Unread badges, push on new message. Block + report inline. Group chat `[FASE 2]`.

### 4.9 Aura v1

Aura 0–1000, profile-visible with transparent breakdown by source. Append-only ledger; nightly recompute with decay. Display **tiers** band the 0–1000 range, with a realtime tier-up celebration (glow-grade moment per `docs/DESIGN.md`) — presentation only, tiers grant nothing.

**Earning (v1 weights, tunable server-side):**

| Action                                          | Points   | Caps / rules       |
| ----------------------------------------------- | -------- | ------------------ |
| Identity verified                               | +50      | once               |
| Event attended (checked-in)                     | +15      | max 4/week count   |
| Event organized (≥5 attendees)                  | +30      | max 2/month count  |
| Momento → conversation ≥ 10 messages both sides | +5       | max 10/month       |
| Milestone help completed (owner-confirmed)      | +40      | uncapped           |
| Dream milestone completed (own dream)           | +10      | per milestone      |
| Post receives ✦ from member with score > 300    | +3       | max 10/day counted |
| Report upheld against user                      | −50…−200 | severity-based     |

**Integrity rules (from concept doc):**

- Reviews/ratings count only after verified collaborations `[FASE 2+ surface; ledger supports]`
- Weighted judgment: actions from high-score members weigh more; reciprocal exchanges dampened (pairwise diminishing returns). For the ✦ row only, the weighting multiplies a **base of 2** that is never itself awarded: the gate is score > 300, the lowest reactor who clears it already weighs ≈1.263, and rounding would reach **+4** only from a reactor at ≈1118 — a score no member can hold, because Aura is clamped to 1000 (`SCORE_MAX` in `packages/core/src/score/clamp.ts`, mirrored by the `aura_scores` 0–1000 check constraint). **A ✦ therefore always awards +3.** Earlier revisions of this table stated a **+2 base** (which no member can observe) and a **{3, 4}** band (whose 4 arm is dead); #55 tracks aligning `award.test.ts`, which still samples reviewer scores above the clamp.
- **Decay:** after 30 days without qualifying action, score ×0.98/week. Floor: 40% of lifetime peak.
- Aura never purchasable. Athanor Circle membership and fund contributions yield **zero** points. Enforced in engine, asserted in tests.
- **Nor does money earn Aura in the other direction:** being selected for, or paid from, the fund yields **zero** points. Aura for collaboration is awarded only on a _verified completed collaboration_ — the `milestone_help` shape (+40 to the helper on owner confirmation, with pairwise counterparty dampening). Being hired earns nothing; delivering, confirmed by the counterparty, earns. (Source doc §15 asks for the opposite — see §13 Open Questions.)
- Clients have no write path to score tables (RLS deny-all writes; only `score-engine` service role writes).

### 4.10 The Six Stars (Badges)

Earned, never chosen. v1 criteria (auto-granted by engine):

| Star            | Earned by (v1)                                                                  |
| --------------- | ------------------------------------------------------------------------------- |
| ★ Visionario    | dream published + 3 milestones defined + 10 own Evoluzione posts each with ≥1 ✦ |
| ★ Creatore      | 2 own milestones completed                                                      |
| ★ Mentor        | 3 milestone helps completed for others                                          |
| ★ Innovatore    | 5 posts in Evoluzione with ✦ from 10 distinct members                           |
| ★ Collaboratore | 5 accepted Momenti with active conversations                                    |
| ★ Ambasciatore  | 5 activated invites (invitee completes onboarding)                              |

Visionario counts **starred posts**, not reactions — sustained dream-narration in Evoluzione («sogni in corso e traguardi raggiunti»), each chapter resonating with at least one member, which is the concept doc's «indica nuove direzioni e ispira gli altri a seguirle». Innovatore counts **distinct reactors** — breadth of audience. Earlier revisions said «10 ✦ on own posts»; ruled 2026-08-13 under #148 (resolving the #55/#122 disagreement in favour of the shipped criterion — the progress label that says `reazioni` while counting posts is still a bug, tracked in #122).

### 4.11 Dai Vita al Tuo Sogno (Fund Cycles)

Governing source: `docs/Il Fondo dei Sogni della Community.md`. Where that doc and this section once disagreed, the doc won (revised 2026-08-11) — this section was annual-edition-based before. The implementable form is `docs/FUND-SPEC.md`; the decisions behind it are `docs/FUND-DECISIONS.md`.

**The cycle.** The fund runs in cycles, not calendar years. A cycle collects contributions, selects one dream, realizes it, then closes and opens the successor. **Only realization resets the counter** — a voided cycle closes too, but carries its money forward instead (see «When the money falls short»). One active cycle at a time; one dream realized per cycle.

```
CYCLE N
 candidacy ──► screening ──► voting ──► announcement ──► realization ──► closed
  window       eligibility    decisive   target date      plan+progress   counter → 0
  open         fixes ballot   tally      (COUNTDOWN)      published       CYCLE N+1 opens
                                         POOL SNAPSHOT
  └── contributions accepted continuously, open to closure ──────────────────────┘
```

Two dates per cycle: the **announcement**, declared when the cycle opens and fixed, and **closure**, which is event-driven — it happens when the dream is delivered, on no schedule.

**The pool is snapshotted, never frozen.** At announcement the raised total is recorded as `confirmed_pool_cents`: that is the number the funding floor is judged against and the number the winner confirms the dream is deliverable at. **Contributions do not stop** — the counter keeps growing through realization, and everything arriving after the snapshot carries into the next cycle at closure. The winner still sees a fixed amount, which was the whole purpose of freezing it, without the fund going shut for the years a realization takes (**D34**, replacing the earlier closed-from-announcement window).

- **Contributions:** €1+ one-off via Stripe Checkout (**web checkout sheet on iOS** to respect IAP rules). Any amount from €1; the strength of the fund is collective participation, not large individual sums. **Members only** — a contribution always carries a `profile_id`, since anonymity contradicts doc §2 and would make the contributor count describe a different population than the total raised. **Accepted continuously, from cycle open to closure** — including throughout realization; the announcement snapshot fixes the winner's amount without closing the gate. Money arriving after the snapshot lands in the same cycle and **carries forward to the successor**; the realization plan is never re-costed upward mid-flight, because the per-phase amounts a tranche release is verified against would stop meaning anything. `fund_editions.contributions_enabled` is the **single** kill switch — one gate, not two, so there is no ambiguity about what stops a live collection.
- **Counter:** total raised + contributor count, realtime, public, visible app-wide. Never hidden, never reported only periodically — the counter is the commitment. One hero figure — the cycle total, always growing; carried-in and the announcement snapshot are secondary and contextual. **Before any cycle exists the surfaces render an explicit «no active cycle» state, never €0** — an empty pot motivates nobody to fill it, and at launch there is no counter, only the announcement of one.
- **Countdown:** to the announcement event. Remains the app's heartbeat.
- **Candidacies:** personal story, goal, real impact, video, concrete plan, **required budget**, **people and skills needed**, project category. Window-based. Identity verification required.
- **Selection.** Eligibility screening comes _first_ and fixes the ballot, on **objective criteria only**: identity verified, proposal complete (budget and minimum viable amount declared), no moderation sanction, and a plan concrete enough that a tranche release could be verified against it. **No Aura threshold on a candidacy** — reputation must not gate who may _ask_ the community for money, and every criterion above is something a rejected candidate can be told and can fix. Applied by the internal team plus Ambasciatori, who cannot touch the result once the ballot opens. Then the community votes — **1 member = 1 vote, every voice weighing the same**. Aura gates _who may vote_ (a floor of at least one earned Aura event, deferred until the engine has scored the member base), never _how much a vote counts_ (see §4.9). A candidate may vote for their own candidacy. **The tally decides. It cannot be overturned by ATHANOR.** The cycle then moves to the live announcement event. Athanor does not choose the dream; the community does.
- **A cycle must be decisive to be binding.** Each cycle declares, before contributions open, a **minimum turnout** and a **minimum funding floor** — both published, both frozen. Three voters must not be able to commit the community to real money, and a collection that never gathered must not be spent.
- **When the money falls short.** The cycle's `goal_cents` is the collection target; the winner's budget is what the dream needs. The floor is judged against `confirmed_pool_cents`, the announcement snapshot — not against whatever the counter reads later. If that amount clears the floor, the winner is declared and the realization plan is **re-costed to the money that actually exists** — the winner confirms at announcement that the project is deliverable at that amount. If it does not clear the floor, if turnout misses quorum, or if the winner declines as undeliverable, the cycle is **voided**: no winner, the reason is published, the funds **carry forward** into the next cycle shown as a distinct carried-in amount, and the counter does **not** reset. The reset belongs to realization alone.
- **What a contribution is not:** it buys no quota of the winning project, creates no right to a refund if another dream wins, and guarantees nothing about the contributor's own dream. A contribution may fund another member's dream — that is the mechanism, not a side effect. All of it MUST be disclosed **before** payment is taken — **sixteen disclosures**: the eleven facts of source doc §17, a grouped block covering the four ways a cycle can fall short, and the optional processing-fee coverage. Sixteen flat bullets in front of a pay button is wallpaper, so the shortfall cases share one heading. §17's «new contributions for the next cycle» fact now also carries D34's consequence — **contributing once a dream is in realization funds the next dream, not that one** — which is a plainer sentence than the pooled default, because the destination is at least named. The equality-of-voice statement belongs on the ballot, not in checkout.
- **Participation beyond money:** the vote, offered skills, and sharing the project all count as participation. The value of the fund is the network, not only the euros in it.
- **Professionals `[FASE 2+]`:** community professionals may be engaged on the winning project, with a transparent, agreed fee paid from the fund — creating work inside the network. Requires a payout rail (Stripe Connect) that does not exist today.
- **Realization:** the winner's plan is published — objective, available budget, expected costs, professionals, suppliers, timeline, phases, verification method, expected result — and progress is reported publicly for the rest of the cycle. **Money is released in tranches against the plan's phases, each on verification** — never as a lump transfer, which would be unenforceable against the approved plan of doc §10. Athanor declares the dream realized against that plan and publishes the declaration with its evidence; that is an accountable admin act, not a second community vote — the community chose the dream, it cannot audit delivery.
- **Platform economics:** ATHANOR's percentage is **declared and frozen when the cycle opens** and published for that cycle; 90% dream / 10% operations is the default. Operating costs and service fees stated up front. Where the dream becomes a real business and its legal structure allows, ATHANOR may take an equity participation — always agreed in advance and published, never retroactive.
- **Re-candidacy:** a dream that did not win stays eligible in later cycles. Losing a cycle is not exclusion.
- **Transparency (per cycle):** amount raised · counter state · selected dream · economic goal · selection criteria · vote results · project progress · main expense categories · fees and management costs · any ATHANOR stake. Public reporting page. Transparency is part of the product, not an accessory to it.
- Fund managed by platform (Fase 1). Peer-to-peer Dream Fund `[FASE 3]`.
- ⚠️ **Legal gate:** pooled public fund-raising has fiscal/regulatory implications (IT/EU). Legal review required before contributions go live. Until cleared: countdown + candidacies + votes ship, contributions behind feature flag.
- 🚧 **Payouts gate the fund opening, not merely a later phase.** Stripe Connect is a **hard prerequisite** for `contributions_enabled` ever flipping: money must be able to _leave_ the platform through a ledgered path before it is allowed in. Collecting a pooled fund with no built route out would be taking money against a promise the system cannot yet keep — so «payouts are Fase 2+» describes the _professional engagement_ surface, never a licence to open the collection first.
- 📋 **Build state:** M7 shipped the counter, candidacies, voting and contributions against the _annual_ model. Equal vote landed on `dev` 2026-08-11 (PR #205). The cycle engine, winner declaration, budget/skills fields, payouts, realization plan and public reporting are **unbuilt**. **`docs/FUND-SPEC.md` is the specification** — `FUND-01`…`FUND-53`, each with an acceptance criterion and an owning issue; `docs/FUND-DECISIONS.md` carries the D-numbered reasoning (**D34–D47 supersede parts of D1–D33**); `docs/FUND-DIVERGENCE.md` is the dated snapshot of where code contradicts the spec. The work is milestones `fund-cycle-1-open` · `payouts-v1` · `fund-cycle-1-close` · `fund-later`, ordered in #249 — membership _is_ the schedule. The fund is **post-launch** and correctly absent from #186's waves, with one exception: #224's no-active-cycle state ships at launch.

### 4.12 Athanor Circle (Subscription)

- Monthly/annual via Stripe Billing + Customer Portal.
- Fase 1 benefits: advanced search filters, personal analytics-lite (own impact/growth data), premium event & Athanor Day access, founding-member (Prime Stelle) badge cosmetic.
- Never: score boost, feed boost, Momenti priority. Stated in UI.
- `[FASE 4]` full business tools, AI assistant, reduced marketplace fees.

### 4.13 Trust, Safety, Moderation

- Stripe Identity verification → verified badge. Required for: creating paid events, candidating a dream. Optional elsewhere (rewarded +50).
- Ethical guidelines enforced: no aggressive selling, no guaranteed-income promises, no MLM recruiting. Report categories aligned.
- Reports → admin queue (Next.js `/admin`, role-gated) → actions: dismiss, warn, score penalty, suspend, ban. Audit log.
- Misconduct lowers Aura before exclusion (per concept doc).

### 4.14 Notifications

- Push (Expo Push) — mobile: Hai un Momento, new message, milestone help received/accepted, event reminders, countdown milestones. Per-category opt-out.
- In-app notification center — both platforms. Web push `[FASE 2]`.
- Voice & tone: Athanor voice («Hai un Momento», never «Hai una nuova notifica»). Copy catalog in i18n package.
- `notifications.type` values `review` and `projectResponse` are declared but producer-less — reserved for `[FASE 2+]` verified-collaboration reviews and Costellazioni board responses. No Fase-1 promise.
- Fund countdown/milestone notifications are spec (the «countdown milestones» category above) but unbuilt — #127, sequenced with the post-launch fund milestones (#249).

### 4.15 Costellazioni (board v1) + connections

Deliberate early delivery of concept ch. 11 — the concept roadmap placed Costellazioni in F2; the board shipped in Fase 1 (ruled in #148). Backed by `projects`, `favor_offers`, `connection_requests`.

- **Board:** publish a project, pick a category (startup, artistico, business, scientifico, volontariato), filter tabs, cursor-paginated scroll. Responding opens a DM.
- **Passa il Favore** (concept «Pay It Forward»): offer or ask concrete help; accept; «Scrivi» opens the conversation. Non-monetary, like milestone help (§4.3).
- **Explicit connections:** request → accept → connection (+ conversation). This is the first-degree signal §4.5's ranking boost will consume — the graph is shipped, the boost is not yet wired (#152, ranking is pure chronological today).
- Still `[FASE 2]`: digital coworking, Tempo Bank.

---

## 5. System Architecture

```
                    ┌────────────────────┐   ┌────────────────────┐
                    │   MOBILE (iOS/And) │   │     WEB (desktop)  │
                    │   Expo React Native│   │  Next.js 16 App R. │
                    │  tabs: Home · Comm │   │  marketing + legal │
                    │  Costellazioni ·   │   │  SSR @handle pages │
                    │  Momenti · Profilo │   │  (SEO/OG) · /admin │
                    │  Expo Push         │   │  no parity routes  │
                    └─────────┬──────────┘   └─────────┬──────────┘
                              │   supabase-js + @athanor/api (shared)
                              └───────────┬────────────┘
                                          ▼
            ┌─────────────────────────────────────────────────────┐
            │                      SUPABASE                       │
            │ ┌─────────────┐ ┌──────────┐ ┌────────────────────┐ │
            │ │  Auth       │ │ Postgres │ │  Edge Functions    │ │
            │ │ password    │ │  + RLS   │ │  stripe-webhook    │ │
            │ │ Google      │ │ pg_cron  │ │  score-engine      │ │
            │ └─────────────┘ │ pgvector │ │  momenti-matcher   │ │
            │ ┌─────────────┐ │ [fase 2] │ │  identity-webhook  │ │
            │ │  Realtime   │ └──────────┘ │  push-dispatch     │ │
            │ │ chat ·      │ ┌──────────┐ │  erasure-job       │ │
            │ │ countdown   │ │ Storage  │ │  media-process     │ │
            │ └─────────────┘ │ media    │ └────────────────────┘ │
            └─────────────────┴──────────┴────────────────────────┘
            (Auth box: email+password + Google OAuth; Apple built but disabled — `APPLE_ENABLED=false`.)
                       │                          │
                       ▼                          ▼
            ┌────────────────────────┐   ┌────────────────────┐
            │        STRIPE          │   │   EXPO PUSH (FCM/  │
            │ Billing → Athanor Circle │   │   APNs)            │
            │ Checkout → fondo,      │   │ «Hai un Momento»   │
            │   ticket eventi        │   │ messaggi · eventi  │
            │ Identity → badge       │   └────────────────────┘
            │ Webhooks ──────────────┼──► stripe-webhook fn → DB
            └────────────────────────┘

   Hosting: web → Cloudflare Workers (@opennextjs/cloudflare) · mobile → EAS Build/Submit · backend → Supabase
   Observability: Sentry (apps + edge fns) · Cloudflare Web Analytics · Supabase logs
```

**Rules of the architecture:**

1. Clients ↔ Postgres directly via supabase-js + RLS for all CRUD. No middle API tier.
2. Edge Functions only for privileged logic: payments, score writes, matching, push fan-out, erasure.
3. Score tables: client write = RLS deny. Single writer = `score-engine` (service role).
4. Next.js = presentation + SSR/SEO only. Zero business logic duplication.
5. All money state cached from Stripe webhooks; Stripe is source of truth.

## 6. Monorepo

```
athanor/
├── apps/
│   ├── native/                 # Expo SDK 54, expo-router, NativeWind v5
│   │   └── src/app/(tabs)/     # home · community · costellazioni · momenti · profilo
│   └── web/                    # Next.js App Router, Tailwind, shadcn/ui
│       └── app/                # marketing + legal · [handle] public pages · admin/
├── packages/
│   ├── core/                   # domain logic: score engine, badge rules,
│   │   │                       #   matching heuristics — pure TS, max test coverage
│   ├── api/                    # typed Supabase client, queries, mutations,
│   │   │                       #   Realtime subscriptions (TanStack Query)
│   ├── schemas/                # Zod schemas — single validation source
│   ├── i18n/                   # IT/EN catalogs, Athanor voice & tone copy
│   └── config/                 # ts/eslint presets, design tokens:
│       │                       #   background #000206 · foreground #ECEEF6 · aura #2BD0D2
├── supabase/
│   ├── migrations/             # SQL, RLS policies
│   ├── functions/              # edge functions (Deno)
│   ├── tests/                  # pgTAP RLS tests
│   └── seed.sql
├── turbo.json · pnpm-workspace.yaml
└── docs/                       # this PRD, ADRs
```

Tooling: pnpm + Turborepo, TypeScript strict everywhere, Zod at every boundary.

## 7. Data Model

```
profiles ──1:1── auth.users
   │  handle, bio, mission, skills[], city_geohash(≈), locale,
   │  visibility jsonb, push_token, peak_score
   │
   ├──1:N── dreams (one active) ──1:N── dream_milestones
   │                                        └──1:N── milestone_helps
   │                                             (helper_id, type: skill|connection|
   │                                              opportunity,  -- NO 'contribution'
   │                                              (Fase-3 Dream Fund, legal-gated §4.3)
   │                                              status: offered|accepted|completed)
   ├──1:N── badges            (star enum, earned_at)
   ├──1:N── aura_events       (type, points, ref_id, created_at)  ◄ append-only
   ├──1:1── aura_scores       (score, breakdown jsonb, computed_at) ◄ engine-only
   ├──1:N── verifications     (stripe_session, status)
   ├──1:1── circle_memberships(stripe_sub_id, status, period_end)  ◄ webhook-cached
   ├──1:N── invites           (code, invitee_id, activated_at)
   └──1:N── notifications

posts (author, category enum, tags[], media[], story bool, expires_at)
   └──1:N── post_reactions (✦) · post_comments

events (organizer, category, online|physical, venue, geo, stream_url,
   │    capacity, price_cents, is_athanor_day, fee_pct)
   ├──1:N── event_tickets   (stripe_payment_id, qr_token, status)
   └──1:N── event_attendance (checked_in_at → score event)

momento_proposals (user_a, user_b, affinity_score, reasons jsonb, status:
   │     proposed|accepted|passed, proposed_at)
   └──1:1── conversations ──1:N── messages (realtime)

moments — personal profile media gallery, NOT matching (§4.2 naming debt)
projects — Costellazioni board (§4.15)
favor_offers · connection_requests (→ connections)
email_waitlist · remote_config (kill switches, minimum version)

fund_editions (cycle_number*, target_at, goal_cents, closed_at*,
   │           phase: candidacy|screening|voting|announcement|realization|closed *,
   │           split_dream_pct*, split_ops_pct*,
   │           min_funding_cents* NOT NULL, min_voters* NOT NULL,
   │           carried_in_cents*, closure_reason*:
   │             realized|voided_underfunded|voided_quorum|voided_declined,
   │           candidacy_window_open, contributions_enabled, winner_candidacy_id)
   ├──1:1── fund_aggregates    (raised_cents, contributor_count — webhook-recomputed cache)
   ├──1:N── fund_contributions (amount_cents, stripe_checkout_session_id, status)
   ├──1:N── dream_candidacies  (story, goal, impact, video_url, plan,
   │            │               budget_cents*, skills_needed*, category,
   │            │               status: submitted|screening|shortlisted|
   │            │                       rejected|winner|voided*)
   │            └──1:N── candidacy_votes (1 per member per cycle, weight = 1.0*
   │                       — equal vote; the column and its tamper-guard survive
   │                         as an enforced invariant, not as a multiplier)
   └── public_reports* (per-cycle split accounting + expense categories)

reports (target_type, target_id, category, status) · audit_log
stripe_webhook_events (event_id unique → idempotency)
```

Conventions: UUID PKs, `created_at/updated_at` everywhere, soft-delete `deleted_at` on user content, RLS on every table, erasure-job cascades GDPR deletes.

`*` = specified by §4.11, **not yet built**. M7 shipped `fund_editions` keyed by `year` with phases `community|reputation|ethics|event|closed`; the cycle model replaces both. Everything unmarked exists today — verify against `packages/api/src/database.types.ts`, never against this diagram.

## 8. Key Flows

**Momento end-to-end:**

```
pg_cron (nightly) ─► momenti-matcher fn
  ├─ candidate pairs (active, same/near city, not passed <90d)
  ├─ affinity = profession-complementarity + tag overlap
  │            + dream-keywords ↔ skills + activity
  ├─ top ≤3/user → INSERT moments
  └─► push-dispatch: «Hai un Momento.»
user A accepts ──► waits  · user B accepts ──► conversation created
  └─ ice-breaker prompts injected (chi sei · cosa cerchi · il tuo sogno)
  └─ ≥10 msgs both sides ──► score-engine: +5 / +5
```

**Stripe (all three flows, one webhook):**

```
client ─► Checkout/Billing session (created by edge fn, never client-side keys)
Stripe ─► stripe-webhook fn
  ├─ dedup on stripe_webhook_events.event_id
  ├─ checkout.completed(ticket)  → event_tickets + QR
  ├─ checkout.completed(fund)    → fund_contributions + cycle aggregate → Realtime
  ├─ subscription.* (Athanor Circle) → circle_memberships cache
  └─ identity.verified           → verifications → badge + score event
```

**Aura recompute:**

```
aura_events (ledger, append-only)
  ─► score-engine fn (on event + nightly pg_cron)
       ├─ apply caps, reciprocal dampening, reviewer-weighting
       ├─ decay: inactive >30d → ×0.98/wk, floor 40% of peak
       └─ UPSERT aura_scores {score 0–1000, breakdown jsonb}
```

## 9. Non-Functional Requirements

| Area          | Requirement                                                                                                                                                                                                    |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GDPR          | EU region (Supabase Frankfurt). Consent at signup. Field visibility user-controlled. Location approximate by default. Data export (self-serve) + erasure job ≤ 30 days. No data sold, no third-party trackers. |
| Security      | RLS on all tables, deny-by-default. Secrets in Supabase/Cloudflare/EAS vaults. Stripe keys server-side only. Webhooks signature-verified + idempotent. Rate limits on writes.                                  |
| Performance   | Feed p75 < 1s on 4G. Cold start < 3s mobile. Public pages SSG/ISR. Images via Supabase Storage transforms.                                                                                                     |
| Availability  | Managed-only stack; no self-hosted services. Status visibility via Sentry alerts.                                                                                                                              |
| Operability   | Remote config: server-driven kill switches + minimum-version boot gate (`remote_config`) — any surface can be switched off without a store release.                                                            |
| Media privacy | Uploaded images re-encoded + EXIF-stripped client-side, then byte-level metadata strip server-side (`media-process` edge function) before serving.                                                             |
| Accessibility | WCAG 2.1 AA web; RN accessibility props; contrast-checked palette (aura on background verified).                                                                                                               |
| i18n          | IT + EN day one, catalogs in `packages/i18n`, no hardcoded strings (lint rule).                                                                                                                                |
| Brand         | The `aura` cyan accent reserved for moments that matter (new Momento, dream helped, star lit). Calm-but-powerful, no mystical effects. Two-weight humanist sans (Hanken Grotesk).                              |

## 10. Testing & CI

- `packages/core` (score engine, badge rules, matching): Vitest, ≥ 90% coverage — heaviest investment, it's the trust product.
- `packages/schemas`: contract tests.
- RLS: pgTAP suite — every table, every role, including "client cannot write score" assertion.
- Web: Playwright smoke — signup → dream → feed → event ticket → Athanor Circle checkout (Stripe test mode).
- Mobile: Maestro happy path pre-store-submission.
- CI (GitHub Actions): typecheck · lint · unit on every PR, pgTAP when the PR touches `supabase/**`, `packages/schemas/**`, `database.types.ts` or the CI workflow itself (always on pushes to dev/main); Cloudflare Workers deploy on push to main (behind all CI gates); EAS Build on release tags; migrations applied via Supabase CLI in pipeline.

## 11. Milestones (build order)

| #   | Milestone      | Contents                                                                                           |
| --- | -------------- | -------------------------------------------------------------------------------------------------- |
| M0  | Foundation     | Monorepo scaffold, CI, Supabase project, design tokens, auth                                       |
| M1  | Identity       | Onboarding 3 questions, Profilo Evolutivo, visibility/RLS                                          |
| M2  | Il Sogno       | Dreams, milestones, help flow, public @handle pages (SEO)                                          |
| M3  | Community      | Feed, tabs, posts/stories, ✦ reactions, comments                                                   |
| M4  | Athanor Live   | Events CRUD, calendar/map, RSVP, Stripe tickets, QR check-in                                       |
| M5  | Momenti        | Matcher, swipe UI, conversations, messaging, push                                                  |
| M6  | Aura           | Ledger, engine, decay, breakdown UI, Six Stars                                                     |
| M7  | Il Cuore       | First fund cycle, countdown realtime, candidacies, votes, contributions (behind legal flag)        |
| M8  | Athanor Circle | Stripe Billing, gates (filters, premium events), portal                                            |
| M9  | Trust          | Stripe Identity, reports, admin panel, GDPR export/erasure                                         |
| M10 | Launch         | i18n audit, a11y pass, beta (TestFlight/internal track), store submission, Prime Stelle onboarding |

Sequencing rationale: M1–M2 deliver the differentiator (dream) early; M5 needs profiles+events data for matching quality; M6 needs actions to score; M7 before launch because countdown is the app's heartbeat.

## 12. Risks

| Risk                                                                | Mitigation                                                                                                                   |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Pooled community fund = regulatory exposure (IT/EU fundraising law) | Legal review gate; contributions feature-flagged; per-cycle declared split, published before contributions open              |
| Apple IAP rules on fund contributions                               | Contributions via web checkout sheet (external purchase link), not in-app purchase                                           |
| Cold-start: matching needs density                                  | Prime Stelle founding cohorts per city; Momenti quality threshold relaxed under low density; invite loop (Ambasciatore star) |
| Aura gaming                                                         | Ledger + caps + reciprocal dampening + decay + weighted reviewers; weights server-side tunable                               |
| Solo-dev scope                                                      | Strict milestone order; Fase 2+ features schema-ready but unbuilt; managed services only                                     |
| Chronological feed feels empty early                                | Curated seed content via Prime Stelle program; Eventi tab pulls from events automatically                                    |

## 13. Open Questions

1. Fund legal structure (platform entity vs separate non-profit vehicle) — needs counsel before M7 flag flips.
2. Event fee model final: 10% on top vs absorbed — pricing test at beta.
3. Video hosting at scale (Supabase Storage v1 → Mux/Cloudflare Stream when needed) — defer until cost signals.
4. Local Circles data model (city chapters) — design at Fase 1 end based on density data.
5. Equity participation instrument (§4.11) — which vehicle can legally hold a stake in a realized dream, and on what terms. Needs counsel; blocks the equity clause going live.
6. Paying community professionals from the fund (§4.11 `[FASE 2+]`) — needs a payout rail (Stripe Connect) that does not exist, and likely a different regulatory posture than inbound-only collection. Sequence after Q1 and Q5.
7. **Aura for engaged professionals.** Source doc §15 asks that professionals selected and paid from the fund gain Aura. That is a money→Aura path: it contradicts rule #1 and the six independent assertions that enforce it — `weights.ts`, three `packages/core` score tests, `_shared/aura-boundary.test.ts` (which parses the whole migration tree against a money-table list), and pgTAP `0041`/`0044`/`0046` §3 (R1). **Not adopted.** §4.9 states the compliant alternative — Aura on a _verified completed collaboration_, never on selection or payment. Open question is whether that alternative is the intended product behaviour, or whether §15 meant something else.

---

_Somewhere on Athanor, there is a person who is the right moment for your dream._
