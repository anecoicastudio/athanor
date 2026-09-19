import { describe, expect, it } from 'vitest';
import type { AthanorClient } from './client';
import {
  HANDLE_COOLDOWN_CODE,
  claimHandle,
  getOwnProfile,
  getProfileById,
  getProfileIdByHandle,
  getProfileStatCounts,
  handleClaimRefusal,
  isHandleTaken,
  profileKeys,
  updateOnboardingProfile,
  updateProfile,
} from './profiles';
import { makeFakeClient, type FakeResult } from './test-support/fake-client';

describe('profileKeys', () => {
  it('namespaces under profiles and derives stable sub-keys', () => {
    expect(profileKeys.all).toEqual(['profiles']);
    expect(profileKeys.detail('p1')).toEqual(['profiles', 'p1']);
    expect(profileKeys.statCounts('p1')).toEqual(['profiles', 'p1', 'stat-counts']);
  });
});

/**
 * `rpc(name).maybeSingle()` through the shared fake. The hand-rolled stub this replaces
 * hardcoded `error: null`, so no test could reach `if (error) throw error` in any of these
 * three readers — the failures below are what that hid.
 */
function rpcFake(name: string, result: FakeResult) {
  const fake = makeFakeClient({ [`rpc.${name}`]: [result] });
  const calls = fake.calls;
  return { fake, calls, client: fake as unknown as AthanorClient };
}

describe('getProfileById (get_person_profile RPC — M10 visibility)', () => {
  const row = {
    id: '00000000-0000-0000-0000-000000000001',
    handle: 'alice',
    display_name: 'Alice Rossi',
    avatar_path: '00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000001.jpg',
    bio: null, // 'private' field arrives NULLed by the DEFINER RPC
    mission: null,
    identity_tags: ['maker'],
    seeking: null,
    skills: null,
    profession: 'arte',
    city: 'Milano',
    zodiac_sign: 'leone',
    identity_verified: false,
    founding_member: false,
    removed: false,
  };

  it('calls the RPC and passes NULLed private fields through', async () => {
    const { client, calls } = rpcFake('get_person_profile', { data: row });
    const person = await getProfileById(client, row.id);
    expect(calls.map((c) => ({ fn: c.columns, args: c.values }))).toEqual([
      { fn: 'get_person_profile', args: { p_profile_id: row.id } },
    ]);
    expect(person?.bio).toBeNull();
    expect(person?.identity_tags).toEqual(['maker']);
    expect(person?.seeking).toBeNull();
  });

  it('returns null for unknown / blocked ids (zero rows)', async () => {
    const { client } = rpcFake('get_person_profile', { data: [] });
    expect(await getProfileById(client, 'nope')).toBeNull();
  });

  it('passes a banned member through as a tombstone, not as null (#314)', async () => {
    // The distinction this whole read model turns on: zero rows means «unknown or blocked»,
    // and a resolved row with removed:true means «this account was removed». Collapsing the
    // second into the first would attribute a surviving reply to the generic «·».
    const { client } = rpcFake('get_person_profile', {
      data: [
        {
          ...row,
          handle: null,
          display_name: null,
          avatar_path: null,
          founding_member: false,
          identity_verified: false,
          removed: true,
        },
      ],
    });
    const person = await getProfileById(client, row.id);
    expect(person).not.toBeNull();
    expect(person?.removed).toBe(true);
    expect(person?.handle).toBeNull();
    expect(person?.display_name).toBeNull();
    expect(person?.avatar_path).toBeNull();
  });

  it('throws when the RPC errors, rather than reporting the member as missing', async () => {
    // An RLS denial or a timeout must not be indistinguishable from "no such person" — a
    // swallowed error renders «profilo non disponibile» and TanStack Query caches it as valid.
    const { client } = rpcFake('get_person_profile', {
      error: { code: '42501', message: 'permission denied' },
    });
    await expect(getProfileById(client, 'p1')).rejects.toMatchObject({ code: '42501' });
  });
});

describe('getOwnProfile (get_own_profile RPC)', () => {
  it('reads the full own row through the RPC', async () => {
    const own = {
      id: '00000000-0000-0000-0000-000000000002',
      handle: 'me_stessa',
      // get_own_profile is `returns setof public.profiles`, so it carries every column —
      // including the two #75 added. profileSchema requires both (nullable, not optional).
      display_name: 'Me Stessa',
      avatar_path: null,
      bio: 'segreto',
      mission: null,
      skills: [],
      profession: null,
      city: null,
      city_geohash: null,
      locale: 'it',
      visibility: { bio: 'private' },
      identity_tags: [],
      seeking: [],
      identity_verified: false,
      founding_member: false,
      birth_date: null,
      zodiac_sign: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    const { client, calls } = rpcFake('get_own_profile', { data: own });
    const profile = await getOwnProfile(client);
    expect(calls[0]?.columns).toBe('get_own_profile');
    expect(profile?.bio).toBe('segreto');
    expect(profile?.visibility).toEqual({ bio: 'private' });
  });

  it('returns null when the RPC yields no row (signed out)', async () => {
    const { client } = rpcFake('get_own_profile', { data: [] });
    expect(await getOwnProfile(client)).toBeNull();
  });

  it('throws when the RPC errors', async () => {
    const { client } = rpcFake('get_own_profile', {
      error: { code: 'PGRST301', message: 'JWT expired' },
    });
    await expect(getOwnProfile(client)).rejects.toMatchObject({ code: 'PGRST301' });
  });
});

describe('getProfileStatCounts', () => {
  it('maps the RPC row to camelCase counts', async () => {
    const { client, calls } = rpcFake('profile_stat_counts', {
      data: { collabs_count: 3, events_count: 2 },
    });
    const counts = await getProfileStatCounts(client, 'p1');
    expect(counts).toEqual({ collabsCount: 3, eventsCount: 2 });
    expect(calls.map((c) => ({ fn: c.columns, args: c.values }))).toEqual([
      { fn: 'profile_stat_counts', args: { p_profile_id: 'p1' } },
    ]);
  });

  it('coalesces a zero-row result (blocked / unknown id) to zeros', async () => {
    const { client } = rpcFake('profile_stat_counts', { data: [] });
    const counts = await getProfileStatCounts(client, 'p1');
    expect(counts).toEqual({ collabsCount: 0, eventsCount: 0 });
  });
});

describe('getProfileIdByHandle', () => {
  const chainFor = (result: { data: unknown; error: unknown }, calls: unknown[]) => {
    const chain = {
      select: (sel: string) => {
        calls.push(['select', sel]);
        return chain;
      },
      eq: (col: string, v: unknown) => {
        calls.push(['eq', col, v]);
        return chain;
      },
      maybeSingle: () => Promise.resolve(result),
    };
    return chain;
  };

  it('resolves a handle to the profile id', async () => {
    const calls: unknown[] = [];
    const client = {
      from: (t: string) => {
        calls.push(['from', t]);
        return chainFor({ data: { id: 'uuid-1' }, error: null }, calls);
      },
    } as unknown as AthanorClient;
    expect(await getProfileIdByHandle(client, 'luna')).toBe('uuid-1');
    expect(calls[0]).toEqual(['from', 'profiles']);
    expect(calls).toContainEqual(['eq', 'handle', 'luna']);
  });

  it('returns null when no row resolves (unknown or RLS-invisible)', async () => {
    const client = {
      from: () => chainFor({ data: null, error: null }, []),
    } as unknown as AthanorClient;
    expect(await getProfileIdByHandle(client, 'ghost')).toBeNull();
  });

  it('throws on query error', async () => {
    const client = {
      from: () => chainFor({ data: null, error: new Error('boom') }, []),
    } as unknown as AthanorClient;
    await expect(getProfileIdByHandle(client, 'luna')).rejects.toThrow('boom');
  });
});

// ---------------------------------------------------------------------------
// Writes — plumbing only (api rule): the schema is the gate, RLS is the guard.
// ---------------------------------------------------------------------------

const USER = '00000000-0000-0000-0000-0000000000aa';

const db = (script: Record<string, FakeResult[]> = {}) => {
  const fake = makeFakeClient(script);
  return { fake, client: fake as unknown as AthanorClient };
};

const answers = {
  locale: 'it' as const,
  identity_tags: ['maker'],
  seeking: ['connessioni'],
  birth_date: '1990-08-10',
};

describe('updateOnboardingProfile', () => {
  it('updates the caller own row and nothing else', async () => {
    const { fake, client } = db();
    await updateOnboardingProfile(client, USER, answers);

    const call = fake.calls[0]!;
    expect(call.table).toBe('profiles');
    expect(call.op).toBe('update');
    expect(call.values).toEqual(answers);
    expect(call.filters).toEqual([['eq', 'id', USER]]);
  });

  it('strips keys the onboarding schema does not own — no privilege columns reach the wire', async () => {
    const { fake, client } = db();
    await updateOnboardingProfile(client, USER, {
      ...answers,
      identity_verified: true,
      founding_member: true,
      id: 'someone-else',
    } as never);

    const values = fake.calls[0]!.values as Record<string, unknown>;
    expect(Object.keys(values).sort()).toEqual([
      'birth_date',
      'identity_tags',
      'locale',
      'seeking',
    ]);
  });

  it('validates before touching the database', async () => {
    const { fake, client } = db();
    await expect(
      updateOnboardingProfile(client, USER, { ...answers, identity_tags: [] }),
    ).rejects.toThrow();
    expect(fake.calls).toEqual([]);
  });

  it('never writes a handle, even when one is handed over (#782)', async () => {
    const { fake, client } = db();
    await updateOnboardingProfile(client, USER, { ...answers, handle: 'lucia' } as never);
    expect(fake.calls[0]!.values).not.toHaveProperty('handle');
  });

  it('surfaces a database error', async () => {
    const { client } = db({
      'profiles.update': [{ error: { code: '42501', message: 'rls denied' } }],
    });
    await expect(updateOnboardingProfile(client, USER, answers)).rejects.toThrow('rls denied');
  });
});

describe('updateProfile', () => {
  it('sends only the patched columns, scoped to the owner', async () => {
    const { fake, client } = db();
    await updateProfile(client, USER, { bio: 'ciao' });

    const call = fake.calls[0]!;
    expect(call.table).toBe('profiles');
    expect(call.op).toBe('update');
    expect(call.values).toEqual({ bio: 'ciao' });
    expect(call.filters).toEqual([['eq', 'id', USER]]);
  });

  it('strips columns the member may not set on themselves', async () => {
    const { fake, client } = db();
    await updateProfile(client, USER, {
      bio: 'ciao',
      identity_verified: true,
      founding_member: true,
      created_at: '2020-01-01T00:00:00Z',
    } as never);

    expect(fake.calls[0]!.values).toEqual({ bio: 'ciao' });
  });

  it('rejects an invalid patch before touching the database', async () => {
    const { fake, client } = db();
    await expect(updateProfile(client, USER, { handle: 'No Spaces!' })).rejects.toThrow();
    expect(fake.calls).toEqual([]);
  });

  it('surfaces a database error', async () => {
    const { client } = db({
      'profiles.update': [{ error: { code: '42501', message: 'rls denied' } }],
    });
    await expect(updateProfile(client, USER, { bio: 'ciao' })).rejects.toThrow('rls denied');
  });
});

// ---------------------------------------------------------------------------
// The @handle claim (#782) — chosen by the person, never derived from the email
// ---------------------------------------------------------------------------

describe('isHandleTaken', () => {
  it('is true when a profile already holds the handle', async () => {
    const { fake, client } = db({ 'profiles.select': [{ data: [{ id: 'someone' }] }] });
    await expect(isHandleTaken(client, 'luna_rossa')).resolves.toBe(true);
    const call = fake.calls[0]!;
    expect(call.table).toBe('profiles');
    expect(call.filters).toEqual([['eq', 'handle', 'luna_rossa']]);
  });

  it('is false when nobody the caller can see holds it', async () => {
    const { client } = db({ 'profiles.select': [{ data: [] }] });
    await expect(isHandleTaken(client, 'luna_rossa')).resolves.toBe(false);
  });

  it('throws on a query error rather than answering «free»', async () => {
    const { client } = db({ 'profiles.select': [{ error: { code: '42501', message: 'boom' } }] });
    await expect(isHandleTaken(client, 'luna_rossa')).rejects.toMatchObject({ message: 'boom' });
  });
});

describe('claimHandle', () => {
  it('writes the handle and nothing else, on the caller\'s own row', async () => {
    const { fake, client } = db();
    await claimHandle(client, USER, 'luna_rossa');
    const call = fake.calls[0]!;
    expect(call.table).toBe('profiles');
    expect(call.op).toBe('update');
    expect(call.values).toEqual({ handle: 'luna_rossa' });
    expect(call.filters).toEqual([['eq', 'id', USER]]);
  });

  it('refuses a malformed handle before touching the database', async () => {
    const { fake, client } = db();
    await expect(claimHandle(client, USER, 'No Spaces!')).rejects.toThrow();
    expect(fake.calls).toEqual([]);
  });

  it('refuses a reserved handle before touching the database', async () => {
    const { fake, client } = db();
    await expect(claimHandle(client, USER, 'supporto')).rejects.toThrow();
    expect(fake.calls).toEqual([]);
  });

  it('surfaces the database refusal as it came, for handleClaimRefusal to read', async () => {
    const refusal = { code: '23505', message: 'duplicate key value violates unique constraint "profiles_handle_key"' };
    const { client } = db({ 'profiles.update': [{ error: refusal }] });
    await expect(claimHandle(client, USER, 'luna_rossa')).rejects.toMatchObject(refusal);
  });
});

describe('handleClaimRefusal', () => {
  it('reads a clash on the handle\'s unique index as taken', () => {
    expect(
      handleClaimRefusal({
        code: '23505',
        message: 'duplicate key value violates unique constraint "profiles_handle_key"',
      }),
    ).toEqual({ reason: 'taken' });
  });

  it('does not read another unique index as a taken handle', () => {
    expect(
      handleClaimRefusal({
        code: '23505',
        message: 'duplicate key value violates unique constraint "profiles_referral_code_key"',
      }),
    ).toBeNull();
  });

  it('reads the reserved-word CHECK as reserved', () => {
    expect(
      handleClaimRefusal({
        code: '23514',
        message: 'new row for relation "profiles" violates check constraint "profiles_handle_not_reserved"',
      }),
    ).toEqual({ reason: 'reserved' });
  });

  it('reads the shape CHECK as malformed', () => {
    expect(
      handleClaimRefusal({
        code: '23514',
        message: 'new row for relation "profiles" violates check constraint "profiles_handle_check"',
      }),
    ).toEqual({ reason: 'malformed' });
  });

  it('does not read another column\'s CHECK as a handle refusal', () => {
    expect(
      handleClaimRefusal({
        code: '23514',
        message: 'new row for relation "profiles" violates check constraint "profiles_bio_check"',
      }),
    ).toBeNull();
  });

  it('reads the cooldown and carries the instant it opens from DETAIL', () => {
    expect(
      handleClaimRefusal({
        code: 'PT429',
        message: 'handle_cooldown',
        details: '2026-10-19T10:00:00.000Z',
      }),
    ).toEqual({ reason: 'cooldown', opensAt: '2026-10-19T10:00:00.000Z' });
  });

  it('still reads the cooldown when DETAIL is missing or unparseable — the date is a courtesy', () => {
    expect(handleClaimRefusal({ code: 'PT429', message: 'handle_cooldown' })).toEqual({
      reason: 'cooldown',
      opensAt: null,
    });
    expect(
      handleClaimRefusal({ code: 'PT429', message: 'handle_cooldown', details: 'soon' }),
    ).toEqual({ reason: 'cooldown', opensAt: null });
  });

  it('does not read another PT429 as the handle cooldown', () => {
    expect(handleClaimRefusal({ code: 'PT429', message: 'waitlist_rate_limited' })).toBeNull();
  });

  it('is null for anything that is not a PostgREST refusal of the handle', () => {
    for (const v of [null, undefined, 'PT429', 0, [], {}, { message: 'handle_cooldown' }, { code: 23505 }]) {
      expect(handleClaimRefusal(v), JSON.stringify(v)).toBeNull();
    }
    expect(handleClaimRefusal({ code: '42501', message: 'rls denied' })).toBeNull();
  });

  it('names the cooldown by the SQLSTATE the trigger raises', () => {
    expect(HANDLE_COOLDOWN_CODE).toBe('PT429');
  });
});
