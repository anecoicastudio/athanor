import { describe, expect, test, vi } from 'vitest';
import { NOTIFICATION_TEMPLATE_KEYS } from '@athanor/schemas';
import en from './catalogs/en.json';
import it from './catalogs/it.json';
import { t, tagLabel, type MessageKey } from './t';

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
    'aura.unit',
    'auth.codePlaceholder',
    'auth.password.label',
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
    'home.today.seeLive',
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
    'milestone.sectionLabel',
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
