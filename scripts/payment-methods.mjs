#!/usr/bin/env node
// scripts/payment-methods.mjs — which payment rails actually reach a buyer, and did one settle?
//
//   pnpm payments offers
//   pnpm payments accounts
//   pnpm payments mint contribution --profile <uuid> --edition <uuid> [--amount 500]
//   pnpm payments mint ticket       --profile <uuid> --event <uuid> --dest acct_… [--price 2000 --fee 200]
//   pnpm payments mint circle       --profile <uuid> --price price_…
//   pnpm payments check cs_test_…
//   pnpm payments recent [n]
//   pnpm payments expire cs_test_…
//
// TEST MODE ONLY, enforced: the run refuses unless the resolved Stripe key is `sk_test_…`, and
// the Supabase ref is the staging constant. There is no flag that lifts either.
//
// WHY THIS EXISTS. Nothing in this repo selects payment methods — `create-ticket-checkout`,
// `create-contribution-session` and `create-circle-checkout` pass neither `payment_method_types`
// nor `payment_method_configuration`, which `supabase/functions/stripe-webhook/handlers.ts`
// documents at `assertSettled`. The Stripe Dashboard's payment-method configuration is therefore
// the ONLY control, it is account state rather than repo state, and CI cannot see it. Worse, the
// set a buyer is shown is not the set the Dashboard has enabled: Stripe filters it per Session by
// currency, by mode, and by charge shape. A destination charge silently drops PayPal, and
// subscription mode silently drops every bank redirect. Both filters are invisible until someone
// opens Checkout, and neither raises an error.
//
// So `offers` mints one throwaway Session per surface with the same shape its builder uses, reads
// back the `payment_method_types` Stripe computed, and expires it. That is the only honest answer
// to "which methods do our buyers see" — the Dashboard's list answers a different question.
//
// `mint` and `check` are the other half: a rail is not verified because Checkout drew its button.
// `mint` produces a real Session carrying real `metadata.kind` / `metadata.profile_id`, so paying
// it drives the real webhook against staging; `check` then reconciles three things that fail
// independently — Stripe's `payment_status`, the `stripe_webhook_events` row's `processed_at`,
// and the row the handler was supposed to write. Two out of three is a failure.
//
// `check` also prints the wallet type off the charge (`payment_method_details.card.wallet.type`).
// Apple Pay and Google Pay never appear in `payment_method_types` — they ride `card` — so that
// field is the only proof a wallet walk actually exercised the wallet.
//
// READ-MOSTLY, and never near production. It creates and expires Checkout Sessions in test mode
// and reads staging over the Management API. It never links, never deploys, and never touches
// `supabase/.temp/linked-project.json` — that file is a single global which `db push` and
// `functions deploy` both obey, so the staging ref is a constant here and the request names it,
// exactly as `scripts/deploy-check.mjs` does. Nothing here refunds, captures, or transfers.
//
// NO DEPENDENCIES, ON PURPOSE — same reasoning as staging-refresh.mjs / deploy-check.mjs: a
// repo-root script cannot import from the workspace under node-linker=hoisted, and fetch needs no
// library.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const STAGING_REF = 'eralyiwkfrpqsawivegz';
const PRODUCTION_REF = 'kwzeiqvrnnaagccyoose';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP_BASE = process.env.ATHANOR_APP_BASE ?? 'https://www.athanor.world/';

const die = (msg) => {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
};

// ── credentials ────────────────────────────────────────────────────────────────

/**
 * The Stripe TEST secret key, from $STRIPE_SECRET_KEY or `supabase/.env`.
 *
 * The `sk_test_` assertion is the whole safety model of this file. Every other guard here is
 * about aiming at the right project; this one is about the difference between minting a
 * throwaway Session and charging a member's card. It is not overridable.
 */
function stripeKey() {
  const fromEnv = process.env.STRIPE_SECRET_KEY?.trim();
  const envFile = join(REPO_ROOT, 'supabase', '.env');
  const fromFile = existsSync(envFile)
    ? readFileSync(envFile, 'utf8')
        .split('\n')
        .find((l) => l.startsWith('STRIPE_SECRET_KEY='))
        ?.slice('STRIPE_SECRET_KEY='.length)
        .trim()
        .replace(/^['"]|['"]$/g, '')
    : undefined;
  const key = fromEnv || fromFile;
  if (!key)
    die(
      `no Stripe key. Either export STRIPE_SECRET_KEY=sk_test_… or put it in supabase/.env.\nThis is the test-mode key; the live key must never be used with this script.`,
    );
  if (!key.startsWith('sk_test_'))
    die(
      `refusing: the resolved Stripe key is not sk_test_… . This script mints and expires Checkout\nSessions and is test-mode only. There is no flag to override this.`,
    );
  return key;
}

/** The operator's own Supabase CLI credential — never a project secret, never printed. */
function accessToken() {
  const env = process.env.SUPABASE_ACCESS_TOKEN;
  if (env) return env.trim();
  if (process.platform === 'darwin') {
    try {
      return execFileSync(
        'security',
        ['find-generic-password', '-s', 'Supabase CLI', '-a', 'supabase', '-w'],
        { encoding: 'utf8' },
      ).trim();
    } catch {
      /* fall through to the hint */
    }
  }
  die(`no Management API token. Either:

  export SUPABASE_ACCESS_TOKEN=sbp_…       # from app.supabase.com/account/tokens
  supabase login                            # stores one in the macOS keychain

This is the operator's own account credential, not a project secret.`);
}

// ── transports ─────────────────────────────────────────────────────────────────

/** Stripe form-encoded request. `body` is a flat map of already-bracketed Stripe param paths. */
async function stripe(method, path, body) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${stripeKey()}`,
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  const json = await res.json();
  if (json.error) die(`Stripe ${json.error.code ?? res.status}: ${json.error.message}`);
  return json;
}

/**
 * One read-only SQL statement against STAGING, over the Management API.
 *
 * The ref is a constant and the production check can only fail if someone edits this file —
 * which is exactly the moment it should refuse. Mirrors staging-refresh.mjs.
 */
async function stagingQuery(sql) {
  const url = `https://api.supabase.com/v1/projects/${STAGING_REF}/database/query`;
  if (url.includes(PRODUCTION_REF)) die(`refusing: ${url} is PRODUCTION.`);
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (res.status === 401)
    die(`Management API rejected the token (401). Re-run \`supabase login\`.\n${text}`);
  if (!res.ok) die(`Management API error ${res.status}:\n${text}`);
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : (parsed.result ?? parsed.rows ?? []);
  } catch {
    return die(`could not parse Management API response:\n${text}`);
  }
}

function printRows(rows) {
  if (!rows.length) return console.log('  (no rows)');
  for (const r of rows)
    console.log(
      '  ' +
        Object.entries(r)
          .map(([k, v]) => `${k}=${v === null ? 'NULL' : v}`)
          .join('  '),
    );
}

// ── the surfaces, exactly as their builders shape them ─────────────────────────

const successCancel = (ok, no) => ({
  success_url: `${APP_BASE}${ok}`,
  cancel_url: `${APP_BASE}${no}`,
});

/**
 * The three Session shapes, kept in step with the edge-function builders by hand. Only the
 * fields Stripe uses to FILTER payment methods matter for `offers` — mode, currency, recurrence,
 * and `transfer_data` — so a drift in, say, a product name changes nothing about the answer.
 */
const surfaces = {
  contribution: ({ amount = 500 }) => ({
    mode: 'payment',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'eur',
    'line_items[0][price_data][unit_amount]': String(amount),
    'line_items[0][price_data][product_data][name]': 'Dai Vita al Tuo Sogno — contributo',
  }),
  ticket: ({ price = 2000, fee = 200, dest }) => ({
    mode: 'payment',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'eur',
    'line_items[0][price_data][unit_amount]': String(price),
    'line_items[0][price_data][product_data][name]': 'payment-method matrix probe',
    // #104's destination charge. This is the field that makes Stripe drop PayPal.
    'payment_intent_data[application_fee_amount]': String(fee),
    'payment_intent_data[transfer_data][destination]': dest,
  }),
  circle: ({ price }) =>
    price
      ? { mode: 'subscription', 'line_items[0][quantity]': '1', 'line_items[0][price]': price }
      : {
          mode: 'subscription',
          'line_items[0][quantity]': '1',
          'line_items[0][price_data][currency]': 'eur',
          'line_items[0][price_data][unit_amount]': '1000',
          'line_items[0][price_data][recurring][interval]': 'month',
          'line_items[0][price_data][product_data][name]': 'payment-method matrix probe',
        },
};

// ── commands ───────────────────────────────────────────────────────────────────

async function cmdAccounts() {
  const { data } = await stripe('GET', '/accounts?limit=10');
  if (!data.length) return console.log('  (no test connected accounts — ticket probes will skip)');
  for (const a of data)
    console.log(
      `  ${a.id}  ${a.country}  charges=${a.charges_enabled}  payouts=${a.payouts_enabled}  caps=${JSON.stringify(a.capabilities ?? {})}`,
    );
}

/** Mint, read `payment_method_types`, expire. Never left behind — an open Session is payable. */
async function probe(label, params) {
  const s = await stripe('POST', '/checkout/sessions', {
    ...params,
    ...successCancel('?probe=ok', '?probe=no'),
  });
  console.log(`  ${label.padEnd(24)} ${(s.payment_method_types ?? []).join(', ')}`);
  await stripe('POST', `/checkout/sessions/${s.id}/expire`);
}

async function cmdOffers() {
  const cfgs = await stripe('GET', '/payment_method_configurations');
  console.log('\nDashboard payment-method configuration (test mode) — what is ENABLED:\n');
  for (const c of cfgs.data) {
    const on = Object.entries(c)
      .filter(([, v]) => v && typeof v === 'object' && v.display_preference?.value === 'on')
      .map(([k]) => k)
      .sort();
    console.log(`  ${c.id}  ${c.name}  default=${c.is_default}\n    ON: ${on.join(', ')}`);
  }

  const { data: accounts } = await stripe('GET', '/accounts?limit=1');
  const dest = accounts[0]?.id;

  console.log('\nWhat a buyer is actually SHOWN, per surface (EUR):\n');
  await probe('fund contribution', surfaces.contribution({}));
  await probe('circle (subscription)', surfaces.circle({}));
  if (dest) await probe('ticket (dest charge)', surfaces.ticket({ dest }));
  else console.log('  ticket (dest charge)     skipped — no test connected account');

  console.log(`
Apple Pay and Google Pay never appear above: they ride \`card\` and surface per device.
A method enabled in the configuration but missing from a surface was filtered by Stripe —
currency, mode, or charge shape. See docs/RELEASE-RUNBOOK.md §4.8.
`);
}

async function cmdMint(kind, flags) {
  const profile = flags.profile ?? die('--profile <uuid> required');
  let params, metadata;
  if (kind === 'contribution') {
    const edition = flags.edition ?? die('--edition <uuid> required');
    const amount = Number(flags.amount ?? 500);
    params = {
      ...surfaces.contribution({ amount }),
      ...successCancel('annual?contrib=success', 'annual?contrib=cancel'),
    };
    metadata = {
      'metadata[kind]': 'contribution',
      'metadata[edition_id]': edition,
      'metadata[profile_id]': profile,
      'metadata[gift_cents]': String(amount),
      'metadata[coverage_cents]': '0',
    };
  } else if (kind === 'ticket') {
    const event = flags.event ?? die('--event <uuid> required');
    const dest = flags.dest ?? die('--dest acct_… required (the organiser connected account)');
    params = {
      ...surfaces.ticket({
        price: Number(flags.price ?? 2000),
        fee: Number(flags.fee ?? 200),
        dest,
      }),
      // The builder caps the Session at Stripe's 30-minute minimum so the 35-minute seat claim
      // strictly outlives it (#105/#258). Mirrored so a probe cannot outlive a claim either.
      expires_at: String(Math.floor(Date.now() / 1000) + 30 * 60),
      ...successCancel(`event/${event}?checkout=success`, `event/${event}?checkout=cancel`),
    };
    metadata = {
      'metadata[kind]': 'ticket',
      'metadata[event_id]': event,
      'metadata[profile_id]': profile,
    };
  } else if (kind === 'circle') {
    const price = flags.price ?? die('--price price_… required (a real Circle price id)');
    params = {
      ...surfaces.circle({ price }),
      ...successCancel('circle?sub=success', 'circle?sub=cancel'),
    };
    metadata = {
      'metadata[kind]': 'subscription',
      'metadata[profile_id]': profile,
      'subscription_data[metadata][kind]': 'subscription',
      'subscription_data[metadata][profile_id]': profile,
    };
  } else {
    die('kind must be contribution | ticket | circle');
  }

  const s = await stripe('POST', '/checkout/sessions', { ...params, ...metadata });
  console.log(`\n  session : ${s.id}`);
  console.log(`  offers  : ${(s.payment_method_types ?? []).join(', ')}`);
  console.log(`\n${s.url}\n`);
  console.log(`Pay it, then:  pnpm payments check ${s.id}\n`);
}

async function cmdCheck(id) {
  if (!id?.startsWith('cs_')) die('usage: pnpm payments check cs_test_…');
  const s = await stripe('GET', `/checkout/sessions/${id}?expand[]=payment_intent.latest_charge`);
  const pi = typeof s.payment_intent === 'object' ? (s.payment_intent ?? {}) : {};
  const charge = typeof pi.latest_charge === 'object' ? (pi.latest_charge ?? {}) : {};
  const details = charge.payment_method_details ?? {};
  const wallet = details.card?.wallet?.type;

  console.log(`
  status         : ${s.status}
  payment_status : ${s.payment_status}   <- must be paid | no_payment_required
  offered        : ${(s.payment_method_types ?? []).join(', ')}
  method USED    : ${details.type ?? '(none yet)'}${wallet ? `  wallet: ${wallet}` : ''}
  amount_total   : ${s.amount_total} ${s.currency}
  metadata       : ${JSON.stringify(s.metadata ?? {})}
  charge         : ${charge.id ?? '(none)'}  refunded=${charge.refunded ?? '-'}  disputed=${charge.disputed ?? '-'}
`);

  const kind = s.metadata?.kind;
  const profile = s.metadata?.profile_id;

  console.log('  staging — webhook ledger (processed_at NULL is the fail-closed alarm):');
  printRows(
    await stagingQuery(
      'select event_id, type, received_at, processed_at from stripe_webhook_events order by received_at desc limit 5;',
    ),
  );

  if (!kind || !profile) {
    console.log('\n  (no kind/profile_id in metadata — nothing to reconcile)\n');
    return;
  }

  console.log('\n  staging — the row this Session should have written:');
  const q = {
    ticket: `select id, event_id, user_id, status, stripe_payment_id, created_at from event_tickets where stripe_payment_id = '${pi.id ?? ''}' or user_id = '${profile}' order by created_at desc limit 3;`,
    contribution: `select id, edition_id, profile_id, amount_cents, coverage_cents, charged_cents, status, created_at from fund_contributions where stripe_checkout_session_id = '${s.id}' or profile_id = '${profile}' order by created_at desc limit 3;`,
    subscription: `select profile_id, plan, status, current_period_end, founding_member, created_at from circle_memberships where profile_id = '${profile}' order by created_at desc limit 3;`,
  }[kind];
  if (!q) return console.log(`  (unknown metadata.kind '${kind}')\n`);
  printRows(await stagingQuery(q));
  console.log();
}

async function cmdRecent(n) {
  const { data } = await stripe('GET', `/checkout/sessions?limit=${Number(n ?? 10)}`);
  for (const s of data)
    console.log(
      `  ${s.id}  ${(s.payment_status ?? '').padEnd(9)} ${(s.metadata?.kind ?? '-').padEnd(13)} ${(s.payment_method_types ?? []).join(', ')}`,
    );
}

async function cmdExpire(id) {
  const s = await stripe(
    'POST',
    `/checkout/sessions/${id ?? die('usage: expire cs_test_…')}/expire`,
  );
  console.log(`  ${s.id} ${s.status}`);
}

// ── entry ──────────────────────────────────────────────────────────────────────

const [command, ...rest] = process.argv.slice(2);
const positional = rest.filter((a) => !a.startsWith('--'));
const flags = Object.fromEntries(
  rest.flatMap((a, i) => (a.startsWith('--') ? [[a.slice(2), rest[i + 1]]] : [])),
);

const usage = () =>
  die(`usage:
  pnpm payments offers
  pnpm payments accounts
  pnpm payments mint contribution --profile <uuid> --edition <uuid> [--amount 500]
  pnpm payments mint ticket       --profile <uuid> --event <uuid> --dest acct_… [--price 2000 --fee 200]
  pnpm payments mint circle       --profile <uuid> --price price_…
  pnpm payments check cs_test_…
  pnpm payments recent [n]
  pnpm payments expire cs_test_…

Test mode only. See docs/RELEASE-RUNBOOK.md §4.8 for the walk each rail needs.`);

switch (command) {
  case 'offers':
    await cmdOffers();
    break;
  case 'accounts':
    await cmdAccounts();
    break;
  case 'mint':
    await cmdMint(positional[0], flags);
    break;
  case 'check':
    await cmdCheck(positional[0]);
    break;
  case 'recent':
    await cmdRecent(positional[0]);
    break;
  case 'expire':
    await cmdExpire(positional[0]);
    break;
  default:
    usage();
}
