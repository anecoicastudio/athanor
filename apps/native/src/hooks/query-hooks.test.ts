import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The extracted query hooks (#332) each replaced a `queryKey` + `queryFn` pair that several
 * screens had hand-typed. The hazard in doing that is silent: a hook whose key differs by one
 * character from the key its screens used still type-checks, still fetches, and simply caches
 * under a second entry — so every `invalidateQueries` aimed at the old key stops reaching it,
 * and two surfaces that were guaranteed to agree quietly stop agreeing.
 *
 * So this pins the key, the `enabled` gate and the arguments each `queryFn` forwards. The hooks
 * themselves are one-line `useQuery(...Query(...))` wrappers with no renderer to run them under
 * (`environment: 'node'`); the builders hold everything a test can be wrong about.
 */

vi.mock('@/lib/supabase', () => ({ supabase: { __brand: 'mock-client' } }));

// The key factories stay REAL — they are the thing being pinned. Only the network-touching
// getters are stubbed, so a queryFn can be invoked to see what it forwards.
vi.mock('@athanor/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@athanor/api')>()),
  getActiveDream: vi.fn(),
  getActiveEdition: vi.fn(),
  getAuraScore: vi.fn(),
  getMomentiDeck: vi.fn(),
  getMomentsPage: vi.fn(),
  getMyReferralCode: vi.fn(),
  getPersonStory: vi.fn(),
  getStars: vi.fn(),
  listMilestones: vi.fn(),
  listMyHelpsForMilestones: vi.fn(),
}));

const api = await import('@athanor/api');
const { supabase } = await import('@/lib/supabase');

const { auraScoreQuery } = await import('./use-aura-score');
const { starsQuery } = await import('./use-stars');
const { momentsPageQuery } = await import('./use-moments-page');
const { momentiDeckQuery } = await import('./use-momenti-deck');
const { activeEditionQuery } = await import('./use-active-edition');
const { referralCodeQuery } = await import('./use-referral-code');
const { personStoryQuery } = await import('./use-person-story');
const { activeDreamQuery } = await import('./use-active-dream');
const { milestonesQuery } = await import('./use-milestones');
const { myHelpsForDreamQuery } = await import('./use-my-helps-for-dream');

/** Options carry a `queryFn` whose context argument these builders all ignore. */
function run(options: { queryFn?: unknown }): void {
  (options.queryFn as () => unknown)();
}

beforeEach(() => vi.clearAllMocks());

describe('the key each hook publishes is the key its screens already used', () => {
  it.each([
    ['aura score', auraScoreQuery('p1').queryKey, api.auraKeys.score('p1')],
    ['stars', starsQuery('p1').queryKey, api.starKeys.list('p1')],
    ['moments page', momentsPageQuery('p1').queryKey, api.momentKeys.list('p1')],
    ['momenti deck', momentiDeckQuery().queryKey, api.momentiKeys.deck()],
    ['active edition', activeEditionQuery().queryKey, api.fundKeys.activeEdition()],
    ['referral code', referralCodeQuery().queryKey, api.inviteKeys.code()],
    ['person story', personStoryQuery('p1').queryKey, api.storyKeys.person('p1')],
    ['active dream', activeDreamQuery('p1').queryKey, api.dreamKeys.byProfile('p1')],
    ['milestones', milestonesQuery('d1').queryKey, api.milestoneKeys.list('d1')],
    [
      'my helps for a dream',
      myHelpsForDreamQuery('h1', 'd1', ['m1']).queryKey,
      [...api.helpKeys.mine('h1'), 'd1'],
    ],
  ])('%s', (_name, actual, expected) => {
    expect(actual).toEqual(expected);
  });

  it('the helps key keeps the `mine` prefix, so invalidating a helper clears every dream', () => {
    // The offer sheet invalidates `helpKeys.mine(uid)` and expects Person Detail behind it to
    // settle. That only works while the dream id EXTENDS the prefix rather than replacing it.
    const key = myHelpsForDreamQuery('h1', 'd1', ['m1']).queryKey;
    expect(key.slice(0, api.helpKeys.mine('h1').length)).toEqual(api.helpKeys.mine('h1'));
  });

  it('an absent id keys on the empty string, exactly as the screens spelled it', () => {
    // `?? ''` and not `?? 'none'`: the disabled entry must not collide with a real member,
    // and it must match what the screens wrote before the move.
    expect(auraScoreQuery(null).queryKey).toEqual(api.auraKeys.score(''));
    expect(personStoryQuery(undefined).queryKey).toEqual(api.storyKeys.person(''));
    expect(myHelpsForDreamQuery(null, null, []).queryKey).toEqual([...api.helpKeys.mine(''), '']);
  });
});

describe('a query with no subject stays disabled', () => {
  it.each([
    ['aura score', (id: string | null) => auraScoreQuery(id)],
    ['stars', (id: string | null) => starsQuery(id)],
    ['moments page', (id: string | null) => momentsPageQuery(id)],
    ['person story', (id: string | null) => personStoryQuery(id)],
    ['active dream', (id: string | null) => activeDreamQuery(id)],
    ['milestones', (id: string | null) => milestonesQuery(id)],
  ])('%s', (_name, build) => {
    expect(build('p1').enabled).toBe(true);
    expect(build(null).enabled).toBe(false);
    expect(build('').enabled).toBe(false);
  });

  it('the deck and the active edition have no subject, so neither carries a gate', () => {
    expect(momentiDeckQuery().enabled).toBeUndefined();
    expect(activeEditionQuery().enabled).toBeUndefined();
  });

  it('the referral code defaults to on and takes a gate, because the RPC WRITES on first call', () => {
    // `ensure_referral_code` mints the code. A flagged-off card that fetched anyway would
    // create one for a member who was never offered the invite.
    expect(referralCodeQuery().enabled).toBe(true);
    expect(referralCodeQuery(false).enabled).toBe(false);
  });

  it('helps need a helper, a dream AND at least one tappa', () => {
    expect(myHelpsForDreamQuery('h1', 'd1', ['m1']).enabled).toBe(true);
    expect(myHelpsForDreamQuery(null, 'd1', ['m1']).enabled).toBe(false);
    expect(myHelpsForDreamQuery('h1', null, ['m1']).enabled).toBe(false);
    // An empty tappe list is not "every tappa" — unscoped, the read would answer about a
    // different set of milestones than the screen is rendering.
    expect(myHelpsForDreamQuery('h1', 'd1', []).enabled).toBe(false);
  });
});

describe('each queryFn forwards the module client and its subject', () => {
  it('aura score', () => {
    run(auraScoreQuery('p1'));
    expect(api.getAuraScore).toHaveBeenCalledWith(supabase, 'p1');
  });

  it('stars', () => {
    run(starsQuery('p1'));
    expect(api.getStars).toHaveBeenCalledWith(supabase, 'p1');
  });

  it('moments page', () => {
    run(momentsPageQuery('p1'));
    expect(api.getMomentsPage).toHaveBeenCalledWith(supabase, 'p1');
  });

  it('momenti deck', () => {
    run(momentiDeckQuery());
    expect(api.getMomentiDeck).toHaveBeenCalledWith(supabase);
  });

  it('active edition', () => {
    run(activeEditionQuery());
    expect(api.getActiveEdition).toHaveBeenCalledWith(supabase);
  });

  it('referral code', () => {
    run(referralCodeQuery());
    expect(api.getMyReferralCode).toHaveBeenCalledWith(supabase);
  });

  it('person story', () => {
    run(personStoryQuery('p1'));
    expect(api.getPersonStory).toHaveBeenCalledWith(supabase, 'p1');
  });

  it('active dream', () => {
    run(activeDreamQuery('p1'));
    expect(api.getActiveDream).toHaveBeenCalledWith(supabase, 'p1');
  });

  it('milestones', () => {
    run(milestonesQuery('d1'));
    expect(api.listMilestones).toHaveBeenCalledWith(supabase, 'd1');
  });

  it('my helps for a dream forwards the tappe, not the dream — the read is scoped to them', () => {
    run(myHelpsForDreamQuery('h1', 'd1', ['m1', 'm2']));
    expect(api.listMyHelpsForMilestones).toHaveBeenCalledWith(supabase, 'h1', ['m1', 'm2']);
  });
});
