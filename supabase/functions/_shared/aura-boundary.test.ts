// deno test supabase/functions/stripe-webhook/ — runs in CI (edge job) and locally.
// Needs --allow-read (already in the documented run command).
//
// SPEC-FIRST, CROSS-LAYER. stripe-webhook/handlers.test.ts ("paying money writes ZERO score
// events, on every paying branch") proves the webhook writes no Aura when money arrives. That is
// only half the claim: the webhook writes ROWS, and a row can grant
// Aura without the webhook knowing, because `20260701124122_m6_aura_award_triggers.sql` mints
// the ledger from database triggers. So "Circle membership and fund contributions yield zero
// points" (docs/PRD.md:191, "Enforced in engine, asserted in tests") is a statement about the
// TRIGGER SET, not about handlers.ts — and nothing asserted it.
//
// This file reads supabase/migrations and asserts the boundary from the other side.
import { assert, assertEquals } from 'jsr:@std/assert@1';

const MIGRATIONS = new URL('../../migrations/', import.meta.url);

const files = [...Deno.readDirSync(MIGRATIONS)]
  .filter((e) => e.isFile && e.name.endsWith('.sql'))
  .map((e) => e.name)
  .sort(); // timestamp-prefixed → chronological, which is what publication membership needs

const sql = files.map((name) => Deno.readTextFileSync(new URL(name, MIGRATIONS)));
const allSql = sql.join('\n');

/** A function is score-granting if it enqueues an award or writes the ledger directly. */
function scoreGrantingFunctions(text: string): Set<string> {
  const out = new Set<string>();
  // chunk on `create function` so each chunk is one definition (dollar-quoted bodies keep
  // their own semicolons, so splitting on ';' is not an option)
  const chunks = text.split(/create\s+(?:or\s+replace\s+)?function\s+/i).slice(1);
  for (const chunk of chunks) {
    const name = chunk.match(/^(?:\w+\.)?(\w+)/)?.[1];
    if (!name) continue;
    const body = chunk.split(/create\s+trigger\s+/i)[0];
    if (/enqueue_score_award|insert\s+into\s+(?:public\.)?aura_events/i.test(body)) out.add(name);
  }
  return out;
}

const SCORE_FNS = scoreGrantingFunctions(allSql);

/** table -> trigger functions that grant Aura when that table changes. */
function scoreTriggersByTable(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const re =
    /create\s+trigger\s+(\w+)\s+[^;]*?\bon\s+(?:\w+\.)?(\w+)[^;]*?execute\s+(?:function|procedure)\s+(?:\w+\.)?(\w+)/gi;
  for (const m of text.matchAll(re)) {
    const [, , table, fn] = m;
    if (!SCORE_FNS.has(fn)) continue;
    out.set(table, [...(out.get(table) ?? []), fn]);
  }
  return out;
}

const SCORE_TRIGGERS = scoreTriggersByTable(allSql);

/** Final membership of the supabase_realtime publication after replaying every migration. */
function realtimeTables(): Set<string> {
  const out = new Set<string>();
  for (const text of sql) {
    for (const m of text.matchAll(
      /alter\s+publication\s+supabase_realtime\s+(add|drop)\s+table\s+(?:\w+\.)?(\w+)/gi,
    )) {
      if (m[1].toLowerCase() === 'add') out.add(m[2]);
      else out.delete(m[2]);
    }
  }
  return out;
}

// ── parser self-guard ────────────────────────────────────────────────────────

Deno.test('the migration parser actually found the Aura award triggers', () => {
  // Guards the guard. If a refactor renames enqueue_score_award, every assertion below would
  // pass vacuously and the anti-buyability boundary would stop being checked in silence.
  assert(files.length > 20, `expected the migration tree, got ${files.length} files`);
  assert(SCORE_FNS.size >= 6, `expected ≥6 score-granting functions, got ${[...SCORE_FNS]}`);
  assert(
    SCORE_TRIGGERS.size >= 5,
    `expected award triggers on ≥5 tables, got ${JSON.stringify([...SCORE_TRIGGERS])}`,
  );
});

// ── the boundary: docs/PRD.md:191, :220, :386, :387 ──────────────────────────

Deno.test('NO Aura award trigger fires on a money table', () => {
  // docs/PRD.md:191 — "Aura never purchasable. Athanor Circle membership and fund contributions
  // yield **zero** points." docs/PRD.md:220 — Circle grants "never: score boost".
  // These are the exact tables docs/PRD.md:385-387 tell the webhook to write. If an award
  // trigger ever lands on one of them, paying becomes earning and nothing else in the repo
  // would notice.
  const MONEY_TABLES = [
    'event_tickets',
    'fund_contributions',
    'circle_memberships',
    'stripe_webhook_events',
    'fund_aggregates',
    'fund_editions',
    'payout_accounts', // W13 writes it (#246); pgTAP 0111 asserts the same boundary in-db
    'fund_payout_ledger', // W14/W15 write it (#247); pgTAP 0112 asserts the same boundary in-db
  ];
  for (const table of MONEY_TABLES) {
    // A name no migration creates would pass the assertion below for free. Check it is a real
    // table first, so a typo fails loudly instead of quietly covering nothing.
    assert(
      new RegExp(
        `create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(?:public\\.)?${table}\\b`,
        'i',
      ).test(allSql),
      `${table} is in MONEY_TABLES but no migration creates it — the assertion is vacuous`,
    );
    assertEquals(
      SCORE_TRIGGERS.get(table) ?? [],
      [],
      `${table} grants Aura on write — money would buy score (docs/PRD.md:191)`,
    );
  }
});

Deno.test('event Aura is earned at the door, not at the checkout', () => {
  // docs/PRD.md:153 — "organizer scans attendee QR → attendance recorded → score event".
  // docs/PRD.md:181 — "+15 Event attended (checked-in)". Buying and not showing up is worth 0,
  // which is only true while the trigger sits on event_attendance and NOT on event_tickets.
  assert(
    (SCORE_TRIGGERS.get('event_attendance') ?? []).length > 0,
    'no award trigger on event_attendance — the +15 for attending never fires',
  );
  assertEquals(SCORE_TRIGGERS.get('event_tickets') ?? [], []);
});

Deno.test('the identity +50 is wired to the flag the webhook flips', () => {
  // docs/PRD.md:388 — "identity.verified → verifications → badge + score event".
  // docs/PRD.md:180 — "+50, once". The webhook only flips profiles.identity_verified
  // (spec-conformance.test.ts); this is the other end of that wire. Break either end and a
  // person completes a paid Identity check for nothing.
  const fns = SCORE_TRIGGERS.get('profiles') ?? [];
  assert(fns.length > 0, 'no award trigger on profiles — the identity +50 has no source');
  const body = allSql.split(new RegExp(`function\\s+(?:\\w+\\.)?${fns[0]}\\b`, 'i'))[1] ?? '';
  assert(
    /identity_verified/.test(body.slice(0, 1500)),
    `${fns[0]} does not key off identity_verified`,
  );
});

// ── the Realtime leg of docs/PRD.md:386 ──────────────────────────────────────

Deno.test('the fund ticker the webhook recomputes is published to Realtime', () => {
  // docs/PRD.md:386 — "checkout.completed(fund) → fund_contributions + edition totals →
  // Realtime". docs/PRD.md:209 — "fund total, contributors count — realtime, visible app-wide".
  // handleContribution's recompute lands in fund_aggregates (metadata-contract.test.ts asserts
  // the rpc + its edition arg); the "→ Realtime" arrow is this publication membership, and it
  // is the only part of the arrow that is not otherwise tested.
  const live = realtimeTables();
  assert(
    live.has('fund_aggregates'),
    `fund_aggregates is not in supabase_realtime — the ticker cannot move live. published: ${[
      ...live,
    ]
      .sort()
      .join(', ')}`,
  );
  // raw contribution rows are NOT published: amounts are private, only the aggregate is public
  // (docs/PRD.md:210 "Split fixed & displayed", not per-donor amounts).
  assertEquals(live.has('fund_contributions'), false);
});
