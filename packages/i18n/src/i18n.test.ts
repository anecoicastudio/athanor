import { describe, expect, test, vi } from 'vitest';
import { NOTIFICATION_TEMPLATE_KEYS } from '@athanor/schemas';
import en from './catalogs/en.json';
import it from './catalogs/it.json';
import { t, tagLabel, tn, type MessageKey } from './t';

describe('catalog parity', () => {
  test('EN mirrors every IT key (IT is canonical)', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(it).sort());
  });
});

describe('tagLabel', () => {
  // The Momenti deck localizes tag KEYS returned by get_momenti_deck (#273 D), so the key
  // is built from data at runtime and cannot be a literal MessageKey.
  test('resolves an onboarding tag key to its label in each locale', () => {
    expect(tagLabel('identity', 'artista', 'it')).toBe('Artista');
    expect(tagLabel('identity', 'artista', 'en')).toBe('Artist');
    expect(tagLabel('seeking', 'mentorship', 'it')).toBe('Mentorship');
    // The deck's skills term (#123) resolves through the same path.
    expect(tagLabel('skill', 'illustrazione', 'it')).toBe('Illustrazione');
    expect(tagLabel('skill', 'illustrazione', 'en')).toBe('Illustration');
  });

  test('falls back to the raw key rather than rendering "undefined"', () => {
    // A tag added to the DB before the catalogs must degrade to something legible.
    expect(tagLabel('identity', 'astronauta', 'it')).toBe('astronauta');
  });
});

describe('t', () => {
  test('returns Italian copy for it locale', () => {
    expect(t('moment.new', 'it')).toBe('Hai un Momento');
  });

  test('returns English copy for en locale', () => {
    expect(t('moment.new', 'en')).toBe('You have a Moment');
  });

  test('substitutes {var} placeholders when vars provided', () => {
    const key = (Object.keys(it) as MessageKey[]).find((k) => /\{\w+\}/.test(it[k]));
    expect(key).toBeDefined();
    const name = /\{(\w+)\}/.exec(it[key!])![1]!;
    expect(t(key!, 'it', { [name]: 'X7' })).toContain('X7');
    expect(t(key!, 'it', { [name]: 'X7' })).not.toContain(`{${name}}`);
  });

  test('leaves unknown placeholders intact', () => {
    const key = (Object.keys(it) as MessageKey[]).find((k) => /\{\w+\}/.test(it[k]));
    const name = /\{(\w+)\}/.exec(it[key!])![1]!;
    // vars provided but without the matching name — placeholder survives verbatim
    expect(t(key!, 'it', { unrelated: 1 })).toContain(`{${name}}`);
  });

  // #113: callers cast server-supplied strings into MessageKey (notifications.template_key),
  // so a key outside the catalog is reachable at runtime and must degrade, never throw.
  test('missing key returns the key itself instead of throwing', () => {
    const missing = 'nope.absent' as MessageKey;
    expect(t(missing, 'it')).toBe('nope.absent');
    expect(t(missing, 'en')).toBe('nope.absent');
  });

  test('missing key with vars does not throw on interpolation', () => {
    const missing = 'nope.absent' as MessageKey;
    expect(t(missing, 'it', { name: 'X7' })).toBe('nope.absent');
  });

  test('missing key warns outside production', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      t('nope.absent' as MessageKey, 'it');
      expect(warn).toHaveBeenCalledWith('[i18n] missing key "nope.absent" (it)');
    } finally {
      warn.mockRestore();
    }
  });
});

// #634: «1 eventi» / «1 persone». The pattern, decided once: grammatical number is a key
// choice — a countable key declares a `.one` sibling in both catalogs, tn picks it at n === 1.
describe('tn', () => {
  test('picks the .one sibling at exactly n === 1', () => {
    expect(tn('profile.stat.events', 1, 'it')).toBe('evento');
    expect(tn('profile.stat.events', 1, 'en')).toBe('event');
  });

  test('keeps the base (plural) key at 0 and at 2', () => {
    expect(tn('profile.stat.events', 0, 'it')).toBe('eventi');
    expect(tn('profile.stat.events', 2, 'it')).toBe('eventi');
  });

  test('falls back to the base key when no .one sibling exists', () => {
    // comment.count has no singular variant yet — adopting the pattern is per-key.
    expect(tn('comment.count', 1, 'it')).toBe(it['comment.count'].replace('{n}', '1'));
  });

  test('countdown units inflect at n === 1 in both catalogs (#652)', () => {
    // #652: the fund grid said «1 ore» and the landing countdown «1 minuti». Pinned by name
    // because nothing else asserts a countdown key — `fund.countdown.minutes` / `.seconds`
    // are deliberately absent: «min» / «sec» are invariant abbreviations (IDENTICAL_BY_DESIGN).
    expect(tn('fund.countdown.hours', 1, 'it')).toBe('ora');
    expect(tn('fund.countdown.hours', 1, 'en')).toBe('hour');
    expect(tn('fund.countdown.hours', 2, 'it')).toBe('ore');
    expect(tn('landing.countdown.days', 1, 'it')).toBe('giorno');
    expect(tn('landing.countdown.hours', 1, 'it')).toBe('ora');
    expect(tn('landing.countdown.minutes', 1, 'it')).toBe('minuto');
    expect(tn('landing.countdown.seconds', 1, 'it')).toBe('secondo');
    expect(tn('landing.countdown.days', 1, 'en')).toBe('day');
    expect(tn('landing.countdown.hours', 1, 'en')).toBe('hour');
    expect(tn('landing.countdown.minutes', 1, 'en')).toBe('minute');
    expect(tn('landing.countdown.seconds', 1, 'en')).toBe('second');
    expect(tn('landing.countdown.seconds', 0, 'en')).toBe('seconds');
    // Pinned so a later sweep cannot «complete» #652 with dead keys: the read sites use `t()`,
    // a `.one` sibling here would never be read, and «min»/«sec» are already the singular.
    expect(tn('fund.countdown.minutes', 1, 'it')).toBe('min');
    expect(tn('fund.countdown.seconds', 1, 'en')).toBe('sec');
    expect('fund.countdown.minutes.one' in it).toBe(false);
    expect('fund.countdown.seconds.one' in en).toBe(false);
  });

  test('always exposes {n}, and merges extra vars over it', () => {
    expect(tn('story.own.stat', 3, 'it')).toBe(it['story.own.stat'].replace('{n}', '3'));
    expect(tn('story.own.stat', 1, 'it')).toBe(it['story.own.stat.one']);
    // vars win over the injected n only if the caller passes n explicitly
    expect(tn('comment.count', 2, 'it', { n: 5 })).toBe(it['comment.count'].replace('{n}', '5'));
  });
});

describe('notification template contract', () => {
  // Compile-time half: every key the schema admits is a real catalog key — a template added
  // to NOTIFICATION_TEMPLATE_KEYS without catalog copy fails typecheck here.
  const templateKeys: readonly MessageKey[] = NOTIFICATION_TEMPLATE_KEYS;

  test('every schema template key has copy in both catalogs', () => {
    for (const key of templateKeys) {
      expect(it[key], `it.${key}`).toBeTypeOf('string');
      expect(en[key], `en.${key}`).toBeTypeOf('string');
    }
  });
});

describe('fund pre-payment disclosure (FUND-18, #235)', () => {
  /**
   * The sixteen facts in six blocks (FUND-SPEC §3) plus screen chrome, EACH BY NAME —
   * deliberately never `count === 16`: a count passes on sixteen wrong keys and fails on an
   * honest merge. `MessageKey`-typed so a key missing from the IT catalog fails typecheck
   * before this even runs; the runtime half asserts both catalogs carry real copy.
   * Block membership is the spec's, not the catalog's — reordering a fact into another
   * block is a spec change and must fail here.
   */
  const DISCLOSURE_KEYS: readonly MessageKey[] = [
    // screen chrome
    'fund.disclose.title',
    'fund.disclose.lead',
    'fund.disclose.cta',
    // ① dove va il denaro
    'fund.disclose.where.title',
    'fund.disclose.where.pool',
    'fund.disclose.where.anyAmount',
    'fund.disclose.where.fees',
    // ② non è un acquisto
    'fund.disclose.notPurchase.title',
    'fund.disclose.notPurchase.noShare',
    'fund.disclose.notPurchase.noAdvantage',
    'fund.disclose.notPurchase.voteDecides',
    // ③ non c'è restituzione — nextDream is the FUND-18 line PR #375 deferred here
    'fund.disclose.noReturn.title',
    'fund.disclose.noReturn.othersDream',
    'fund.disclose.noReturn.notReturned',
    'fund.disclose.noReturn.nextDream',
    // ④ se il ciclo non riesce — every void carries the money forward (never §17's flat reset)
    'fund.disclose.ifFails.title',
    'fund.disclose.ifFails.belowFloor',
    'fund.disclose.ifFails.belowQuorum',
    'fund.disclose.ifFails.winnerDeclines',
    'fund.disclose.ifFails.shortBudget',
    // ⑤ cosa trattiene Athanor
    'fund.disclose.retains.title',
    'fund.disclose.retains.percent',
    'fund.disclose.retains.equity',
    // ⑥ conformità normativa
    'fund.disclose.compliance.title',
    'fund.disclose.compliance.law',
  ];

  test.each(DISCLOSURE_KEYS.map((k) => [k]))('%s has copy in both catalogs', (key) => {
    expect(it[key], `it.${key}`).toBeTypeOf('string');
    expect(en[key], `en.${key}`).toBeTypeOf('string');
    expect(it[key].trim().length, `it.${key} is blank`).toBeGreaterThan(0);
    expect(en[key].trim().length, `en.${key} is blank`).toBeGreaterThan(0);
  });

  test('the accept CTA carries the amount in both locales', () => {
    expect(it['fund.disclose.cta']).toContain('{amt}');
    expect(en['fund.disclose.cta']).toContain('{amt}');
  });

  /**
   * The optional fee coverage (#236 / FUND-51). NOT one of the sixteen facts — it is a
   * choice offered beneath them — so it is pinned here rather than in DISCLOSURE_KEYS,
   * which is the spec's block membership and must stay exactly sixteen.
   */
  const COVERAGE_KEYS: readonly MessageKey[] = [
    'fund.disclose.coverage.label',
    'fund.disclose.coverage.total',
    'fund.disclose.coverage.optional',
    'fund.disclose.coverage.notReturned',
  ];

  test.each(COVERAGE_KEYS.map((k) => [k]))('%s has copy in both catalogs', (key) => {
    expect(it[key], `it.${key}`).toBeTypeOf('string');
    expect(en[key], `en.${key}`).toBeTypeOf('string');
    expect(it[key].trim().length, `it.${key} is blank`).toBeGreaterThan(0);
    expect(en[key].trim().length, `en.${key} is blank`).toBeGreaterThan(0);
  });

  test('the coverage copy shows the payer every figure, in both locales', () => {
    // The consent is the number. A label that said «copri i costi» without naming the amount
    // would be asking for a blank cheque on a screen whose whole purpose is that it is not one.
    expect(it['fund.disclose.coverage.label']).toContain('{fee}');
    expect(en['fund.disclose.coverage.label']).toContain('{fee}');
    for (const slot of ['{amt}', '{fee}', '{total}']) {
      expect(it['fund.disclose.coverage.total'], `it total missing ${slot}`).toContain(slot);
      expect(en['fund.disclose.coverage.total'], `en total missing ${slot}`).toContain(slot);
    }
  });

  test('the coverage copy says it is optional and that a refund does not return it', () => {
    // PSD2 Art. 62(4): the coverage may never read as a surcharge, so the copy has to say
    // out loud that declining costs the contributor nothing. FUND-51: and that it is the
    // contribution that comes back on a refund, never the coverage — stated BEFORE payment,
    // because afterwards it is a surprise rather than a disclosure.
    for (const key of ['fund.disclose.coverage.optional', 'fund.disclose.coverage.notReturned']) {
      expect(it[key as MessageKey].length).toBeGreaterThan(20);
      expect(en[key as MessageKey].length).toBeGreaterThan(20);
    }
    expect(it['fund.disclose.coverage.notReturned'].toLowerCase()).toContain('rimbors');
    expect(en['fund.disclose.coverage.notReturned'].toLowerCase()).toContain('refund');
  });

  test('the retained-percentage fact carries the per-cycle number in both locales (#232)', () => {
    // D15: the percentage is per-cycle DATA, frozen at open — the consent copy renders the
    // declared figure itself, not an abstract promise that a figure exists somewhere.
    expect(it['fund.disclose.retains.percent']).toContain('{percent}');
    expect(en['fund.disclose.retains.percent']).toContain('{percent}');
  });

  test('the reset is stated conditionally — a void carries forward, never a flat azzeramento', () => {
    // FUND-SPEC §3: sourcing §17's «al termine del ciclo il contatore viene azzerato» would
    // misstate the shipped rule (FUND-32: reset on realization only) on the one screen counsel
    // signs. The three void facts must say the money stays, and no disclosure copy may claim
    // an unconditional end-of-cycle reset.
    for (const key of [
      'fund.disclose.ifFails.belowFloor',
      'fund.disclose.ifFails.belowQuorum',
      'fund.disclose.ifFails.winnerDeclines',
    ] as const) {
      expect(it[key]).toContain('resta nel fondo');
      expect(en[key]).toContain('stays in the fund');
    }
    for (const key of DISCLOSURE_KEYS) {
      expect(it[key], `it.${key} states a flat reset`).not.toMatch(/azzera/i);
    }
  });

  test('the vote-equality statement stays off this screen (§8 separates money from voice)', () => {
    // fund.vote.equal is ballot disclosure. No disclosure key may duplicate it.
    for (const key of DISCLOSURE_KEYS) {
      expect(it[key], `it.${key}`).not.toBe(it['fund.vote.equal']);
      expect(en[key], `en.${key}`).not.toBe(en['fund.vote.equal']);
    }
  });
});

describe('organiser settlement disclosure (#437, #104)', () => {
  /**
   * #437 put this disclosure on screen because settlement was manual and Athanor took nothing.
   * The 2026-09-06 ruling on #104 changed both halves: the ticket Checkout Session is now a Stripe
   * DESTINATION CHARGE, so the split happens automatically at payment time, and Athanor retains
   * `events.fee_pct` percent of the price as the `application_fee_amount`.
   *
   * This block used to forbid a percentage and require the words "14 days" and "by hand". All three
   * are now false, so the assertions were rewritten rather than deleted: the disclosure is a legal
   * acknowledgement under CRD 2011/83/EU, and what it must do is describe the money accurately.
   * The pins below are the new promise, stated the same way — by name, so a missing key says which.
   */
  const SETTLEMENT_KEYS: readonly MessageKey[] = [
    'event.create.settlement.ack',
    'event.create.settlement.split',
    'event.create.settlement.required',
  ];

  test.each(SETTLEMENT_KEYS.map((k) => [k]))('%s has copy in both catalogs', (key) => {
    expect(it[key], `it.${key}`).toBeTypeOf('string');
    expect(en[key], `en.${key}`).toBeTypeOf('string');
    expect(it[key].trim().length, `it.${key} is blank`).toBeGreaterThan(0);
    expect(en[key].trim().length, `en.${key} is blank`).toBeGreaterThan(0);
  });

  test('the acknowledgement names the rate as a placeholder, never as a literal', () => {
    // The rate is `{pct}`, filled from DEFAULT_TICKET_FEE_PCT, which ticket-split.mirror.test.ts
    // pins against the events.fee_pct column default. A hardcoded «10%» would read identically and
    // drift silently the first time the column default moved — which is the whole failure this
    // disclosure cannot afford, because a percentage in a consent box is a term, not a label.
    for (const [name, catalog] of [
      ['it', it],
      ['en', en],
    ] as const) {
      expect(catalog['event.create.settlement.ack'], `${name} must name {pct}%`).toContain(
        '{pct}%',
      );
    }
    // The literal ban stays across ALL THREE keys, exactly as the version this replaces applied it.
    // Only the reason changed: it used to mean "promise no commission at all", and now means "the
    // one place a rate may appear is the placeholder". Narrowing it to `.ack` would leave `.split`
    // and `.required` free to hardcode «10%» beside an interpolated one and drift silently from
    // events.fee_pct — the very failure the placeholder exists to prevent.
    for (const key of SETTLEMENT_KEYS) {
      expect(it[key], `it.${key} hardcodes a percentage`).not.toMatch(/\d\s*%/);
      expect(en[key], `en.${key} hardcodes a percentage`).not.toMatch(/\d\s*%/);
    }
  });

  test('the acknowledgement names the deduction, in both locales', () => {
    // «Ricevi il prezzo del biglietto» on its own would be false: a share is withheld, and the
    // consent is that share. The word that carries it is asserted, not the sentence.
    expect(it['event.create.settlement.ack'].toLowerCase()).toContain('meno');
    expect(en['event.create.settlement.ack'].toLowerCase()).toContain('minus');
  });

  test('no settlement key claims the organiser pays the processing fee', () => {
    // The load-bearing one, and the reason this block was rewritten rather than relaxed. On a
    // destination charge Stripe credits the connected account the FULL amount and transfers the
    // application fee back to the platform, which then pays the processing out of it — the
    // organiser receives price minus fee, exactly. The old copy promised "minus the payment
    // processing costs", which was already imprecise and is now simply wrong, and the accounts
    // agree: create-payout-onboarding sets controller.fees.payer to 'application'.
    for (const key of SETTLEMENT_KEYS) {
      expect(
        it[key].toLowerCase(),
        `it.${key} still charges the organiser for processing`,
      ).not.toContain('elaborazione');
      expect(
        en[key].toLowerCase(),
        `en.${key} still charges the organiser for processing`,
      ).not.toContain('processing');
    }
  });

  test('the copy says the split is automatic, and promises no manual cadence', () => {
    // Settlement is no longer something a person does afterwards, so copy naming a hand-made
    // transfer or a 14-day window would describe a process that does not exist. Both were pinned
    // by the previous version of this block; both are now pinned as absent.
    expect(it['event.create.settlement.split'].toLowerCase()).toContain('automatica');
    expect(en['event.create.settlement.split'].toLowerCase()).toContain('automatic');
    for (const key of SETTLEMENT_KEYS) {
      expect(it[key].toLowerCase(), `it.${key} still promises manual settlement`).not.toContain(
        'a mano',
      );
      expect(en[key].toLowerCase(), `en.${key} still promises manual settlement`).not.toContain(
        'by hand',
      );
      expect(it[key], `it.${key} still promises a 14-day cadence`).not.toContain('14');
      expect(en[key], `en.${key} still promises a 14-day cadence`).not.toContain('14');
    }
  });

  test('the payout CTA copy names the missing step in both catalogs', () => {
    // The gate refuses with 55000 and the composer has to say what to do about it. Copy that only
    // said "you cannot publish" would leave an organiser with a refusal and no next action.
    for (const key of [
      'event.create.payout.gate',
      'event.create.payout.cta',
      'event.create.payout.opening',
      'event.create.payout.pending',
      'event.create.payout.error',
    ] as const) {
      expect(it[key], `it.${key}`).toBeTypeOf('string');
      expect(en[key], `en.${key}`).toBeTypeOf('string');
      expect(it[key].trim().length, `it.${key} is blank`).toBeGreaterThan(0);
      expect(en[key].trim().length, `en.${key} is blank`).toBeGreaterThan(0);
    }
  });
});

describe('catalog quality', () => {
  // `?? ''` keeps the failure self-describing if a key is missing from one
  // catalog (the `catalog parity` test catches that first, but don't throw here).
  const placeholders = (s: string | undefined): string[] =>
    [...new Set((s ?? '').match(/\{(\w+)\}/g) ?? [])].sort();

  // I-4: every {var} present in IT is present in EN for the same key (and vice-versa).
  test('placeholder sets match IT<->EN per key', () => {
    const mismatches: string[] = [];
    for (const key of Object.keys(it) as MessageKey[]) {
      const a = placeholders(it[key]);
      const b = placeholders(en[key]);
      if (a.join(',') !== b.join(','))
        mismatches.push(`${key}: IT [${a.join(',')}] EN [${b.join(',')}]`);
    }
    expect(mismatches).toEqual([]);
  });

  // I-3: Athanor voice — no vanity/tech-speak in any value, either locale.
  // «Notifiche» (plural feature title) is fine; \bnotifica\b targets the singular vanity sense.
  test('no banned vanity/tech-speak terms in any value', () => {
    const banned = [/\bengagement\b/i, /\butenti\b/i, /\bnotifica\b/i];
    const offenders: string[] = [];
    for (const cat of [it, en] as Record<string, string>[]) {
      for (const [key, value] of Object.entries(cat)) {
        for (const re of banned) if (re.test(value)) offenders.push(`${key}: "${value}" ~ ${re}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('catalog shape', () => {
  // i18n.md: "Flat dot-namespaced keys (moment.new, tabs.home)". Asserted because the catalogs
  // are hand-edited JSON: a nested object would typecheck as a MessageKey value and then render
  // as "[object Object]" on screen.
  test('every key is flat and dot-namespaced, in both catalogs', () => {
    // Both, not just IT: a nested object in en.json would survive the empty-value test below
    // (String({}) is '[object Object]', not blank) and render as that literal on screen.
    const offenders: string[] = [];
    for (const [name, cat] of [
      ['it', it],
      ['en', en],
    ] as [string, Record<string, unknown>][]) {
      for (const [key, value] of Object.entries(cat)) {
        if (typeof value !== 'string' || !key.includes('.')) offenders.push(`${name}.${key}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('no value is empty or whitespace, in either locale', () => {
    // An empty value renders as a blank label rather than falling back, so it is worse than a
    // missing key — the parity test would catch the latter.
    const offenders: string[] = [];
    for (const [name, cat] of [
      ['it', it],
      ['en', en],
    ] as [string, Record<string, string>][]) {
      for (const [key, value] of Object.entries(cat)) {
        if (String(value).trim() === '') offenders.push(`${name}.${key}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('translation completeness', () => {
  /**
   * Keys whose IT and EN values are legitimately identical: proper nouns (Athanor Live,
   * Momenti, App Store), format-only strings ("{n}m"), and words spelled the same in both
   * languages (Bio, Post, Email, Password, Account, Audio).
   *
   * This is a RATCHET, not a description. Every entry here was checked once; the test exists so
   * that a NEW identical pair — an EN value pasted from the IT catalog and never translated —
   * fails instead of disappearing into the crowd. Adding a key here is a deliberate act.
   */
  const IDENTICAL_BY_DESIGN = new Set([
    'admin.login.email',
    'admin.login.password',
    'admin.target.post',
    'admin.waitlist.colEmail',
    'app.name',
    'aura.a11y.value',
    'aura.unit',
    'auth.codePlaceholder',
    'auth.password.label',
    'chat.a11y.peerAura',
    'chat.peerAura',
    'circle.benefit.ai.t',
    'circle.benefit.analytics.t',
    'circle.title',
    'community.title',
    'costellazioni.filter.business',
    'costellazioni.filter.startup',
    'event.cat.business',
    'event.cat.networking',
    'event.checkin',
    'event.create.online',
    'event.create.streamUrlPlaceholder',
    'event.streamKind',
    'event.whereOnline',
    'feed.audio',
    'feed.filter.business',
    'feed.filter.human',
    'fund.countdown.minutes',
    'fund.countdown.seconds',
    'home.upcoming.seeLive',
    'lang.en',
    'lang.it',
    'landing.aura.eyebrow',
    'landing.download.appStoreName',
    'landing.download.googlePlayName',
    'landing.footer.anecoica',
    'landing.footer.copyright',
    'landing.footer.nuovarealta',
    'landing.footer.poweredby',
    'landing.pillars.circle.name',
    'landing.pillars.community.name',
    'landing.pillars.live.name',
    'landing.pillars.marketplace.name',
    'legal.privacy',
    'live.athanorDays.label',
    'live.chip.athanorDay',
    'live.distance',
    'live.map.cityCount',
    'live.online',
    'live.tab.online',
    'live.title',
    'momenti.aura.chip',
    'momenti.title',
    'notif.prefs.moment',
    'post.detail.title',
    'profile.bio.label',
    'recap.next.title',
    'search.filter.aura.500',
    'search.filter.aura.700',
    'search.filter.aura.850',
    'search.filter.summary.aura',
    'search.group.market',
    'search.scope.market',
    'settings.account.subUnverified',
    'settings.circle.title',
    'settings.section.account',
    'star.mentor',
    'star.next.progress',
    'star.unit.momenti',
    'star.unit.reazioni',
    'store.name',
    'tabs.community',
    'tabs.home',
    'tabs.live',
    'tabs.momenti',
    'tag.identity.coach',
    'tag.identity.mentor',
    'tag.profession.business',
    'tag.profession.design',
    'tag.profession.food',
    'tag.profession.marketing',
    'tag.seeking.business',
    'tag.seeking.mentorship',
    'tag.skill.advertising',
    'tag.skill.branding',
    'tag.skill.coaching',
    'tag.skill.copywriting',
    'tag.skill.fundraising',
    'tag.skill.no-code',
    'tag.skill.pr',
    'tag.skill.project-management',
    'tag.skill.seo',
    'tag.skill.social-media',
    'tag.skill.sound-design',
    'tag.skill.storytelling',
    'tag.skill.ui-ux',
    'tag.skill.videomaking',
    'ticket.scan.title',
    'time.hours',
    'time.minutes',
    'trust.privacy.section',
  ]);

  test('no NEW key has an EN value identical to its IT value', () => {
    const untranslated = (Object.keys(it) as MessageKey[]).filter(
      (key) => it[key] === en[key] && !IDENTICAL_BY_DESIGN.has(key),
    );
    expect(untranslated).toEqual([]);
  });

  test('the allowlist has no stale entries', () => {
    // A key that was translated later, or removed, must leave the list — otherwise the ratchet
    // quietly loosens as the catalog changes underneath it.
    const stale = [...IDENTICAL_BY_DESIGN].filter(
      (key) => !(key in it) || it[key as MessageKey] !== en[key as MessageKey],
    );
    expect(stale).toEqual([]);
  });
});

describe('delete-account copy says what the job defers (#515, #107)', () => {
  /**
   * The copy's job is to promise exactly what the erasure job delivers, and what that is has
   * changed twice. Originally it said «cancelleremo il tuo profilo» and «Elimina
   * definitivamente» and the toast said the account *will be* deleted — three promises of a
   * completion nothing delivered, because the account cascade was commented out behind a legal
   * gate. #515 replaced them with a deferral «dopo una verifica».
   *
   * #107 removed the gate: the controller ruled the retention question on 2026-09-07 (#184) and
   * the job now runs nightly and reaches `done`. So «after a review» became false in a NEW way —
   * there is no review, there is a cron at 03:47 — and the deferral now names the wait it
   * actually is. Pinned by name, like the settlement block above: a count cannot say which
   * promise came back.
   */
  const DELETE_KEYS: readonly MessageKey[] = [
    'account.delete.body',
    'account.delete.deferred',
    'account.delete.cta',
    'account.delete.toast',
  ];

  test.each(DELETE_KEYS.map((k) => [k]))('%s has copy in both catalogs', (key) => {
    expect(it[key], `it.${key}`).toBeTypeOf('string');
    expect(en[key], `en.${key}`).toBeTypeOf('string');
    expect(it[key].trim().length, `it.${key} is blank`).toBeGreaterThan(0);
    expect(en[key].trim().length, `en.${key} is blank`).toBeGreaterThan(0);
  });

  test('the deferred line names the wait, in both locales', () => {
    // The one thing this line exists to say: the erasure does not happen at the tap. If a
    // rewrite drops that, the screen is back to promising a completion the job cannot deliver.
    expect(it['account.delete.deferred']).toMatch(/non è immediata/i);
    expect(en['account.delete.deferred']).toMatch(/not immediate/i);
  });

  test('the wait it names is the nightly job, not a review that no longer happens', () => {
    // #107 — «dopo una verifica» / «after a review» described the legal gate. There is no gate
    // and no review; there is a cron job at 03:47 UTC. Both halves are asserted, because
    // dropping the old phrase without naming the new wait leaves the line vaguer than the
    // product now is.
    expect(it['account.delete.deferred']).toMatch(/ogni notte/i);
    expect(en['account.delete.deferred']).toMatch(/every night/i);
    expect(it['account.delete.deferred']).not.toMatch(/dopo una verifica/i);
    expect(en['account.delete.deferred']).not.toMatch(/after a review/i);
  });

  /**
   * The dream is the sharpest test of the split. `gdpr_erase_fund_footprint` (#240) removes
   * candidacies, votes and the fund footprint at the tap; the `dreams` row goes only with the
   * auth.users cascade, which since #107 runs on the nightly pass rather than never — later
   * either way. So the dream belongs in the DEFERRED half and must never be claimed in the
   * immediate one — the first rewrite of this copy put it in `body` next to «questo accade
   * subito», which is the same false promise #515 exists to remove, in a new sentence.
   */
  test('the dream is promised in the deferred half only, never in the immediate one', () => {
    expect(it['account.delete.body']).not.toMatch(/sogno/i);
    expect(en['account.delete.body']).not.toMatch(/dream/i);
    expect(it['account.delete.deferred']).toMatch(/sogno/i);
    expect(en['account.delete.deferred']).toMatch(/dream/i);
  });

  test('nothing claims the account is already gone, or the erasure already running', () => {
    // «definitivamente» / «permanently» and «verrà eliminato» / «will be deleted» are the exact
    // words that made the original promise. «è iniziata» / «has started» is the one the first
    // rewrite reached for, and it is still wrong after #107: at the tap the request is recorded
    // and nothing server-side has run. The job is a nightly cron (03:47 UTC) — scheduled now,
    // but not running because somebody tapped.
    expect(it['account.delete.cta']).not.toMatch(/definitivamente/i);
    expect(en['account.delete.cta']).not.toMatch(/permanently|forever/i);
    expect(it['account.delete.toast']).not.toMatch(/verrà eliminat|è stato eliminat|è iniziata/i);
    expect(en['account.delete.toast']).not.toMatch(/will be deleted|has been deleted|has started/i);
    expect(it['account.delete.body']).not.toMatch(/cancelliamo|elimina(?!zione)/i);
    expect(en['account.delete.body']).not.toMatch(/we erase|we delete/i);
  });
});

describe('calendar blocked copy diverges from the shared permission body (#552)', () => {
  /**
   * `event.rsvp.calendarBlocked` reads like a duplicate of `permission.blocked.body` and is
   * not one — #552 weighed consolidating (the candidacy-video-status precedent: both blocked
   * states share the one key) and chose divergence, on two load-bearing axes:
   *
   * 1. AGENCY. The shared body opens «L'hai disattivato» — the member turned it off. Calendar
   *    `blocked` is reachable with nobody having turned anything off (calendar.ts:5-16): iOS
   *    17's «Add Events Only» maps to denied + canAskAgain:false, and an Expo Go grant belongs
   *    to Expo Go, shared by every project ever run on the phone. On those, the shared body
   *    would be false — and this product's copy does not say false things to be tidy.
   * 2. RECOVERY. The RSVP bar does not re-launch the add after the Settings round trip, so the
   *    copy must instruct the retry («riprova»); the shared body's «quando vuoi» is written
   *    for primers whose surface re-runs on its own.
   *
   * The shared key stays the default for blocked states without such routes (candidacy, and
   * the #549 location surfaces). This block pins the one deliberate exception so a dedupe
   * sweep does not "fix" it back into a falsehood.
   */
  test('the calendar blocked key exists and is not the shared body, in both locales', () => {
    expect(it['event.rsvp.calendarBlocked']).toBeTypeOf('string');
    expect(en['event.rsvp.calendarBlocked']).toBeTypeOf('string');
    expect(it['event.rsvp.calendarBlocked']).not.toBe(it['permission.blocked.body']);
    expect(en['event.rsvp.calendarBlocked']).not.toBe(en['permission.blocked.body']);
  });

  test('it never claims the member turned the permission off', () => {
    // The agency axis: three routes to blocked involve no member action at all.
    expect(it['event.rsvp.calendarBlocked']).not.toMatch(/l'hai disattivat/i);
    expect(en['event.rsvp.calendarBlocked']).not.toMatch(/you turned/i);
  });

  test('it instructs the retry, which the bar cannot run for you', () => {
    expect(it['event.rsvp.calendarBlocked']).toMatch(/riprova/i);
    expect(en['event.rsvp.calendarBlocked']).toMatch(/try again/i);
  });
});
