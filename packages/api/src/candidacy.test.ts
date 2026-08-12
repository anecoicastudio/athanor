import { describe, expect, it } from 'vitest';
import type { AthanorClient } from './client';
import { asClient, DB_DOWN, makeFakeClient } from './test-support/fake-client';
import {
  candidacyKeys,
  candidacyThumbPath,
  candidacyVideoPath,
  getCandidateById,
  getCandidates,
  submitCandidacy,
} from './candidacy';

const UID = '00000000-0000-4000-8000-000000000001';
const EDITION = '00000000-0000-4000-8000-000000000002';
const CAND1 = '00000000-0000-4000-8000-0000000000c1';
const CAND2 = '00000000-0000-4000-8000-0000000000c2';

const CANDIDACY_ROW = {
  id: CAND1,
  edition_id: EDITION,
  profile_id: UID,
  story: 'la mia storia',
  goal: 'il mio obiettivo',
  impact: 'impatto',
  video_url: `${UID}/${CAND1}.mp4`,
  thumb_path: null,
  plan: 'piano',
  status: 'submitted' as const,
  city: null,
  category: null,
  created_at: '2026-07-02T00:00:00Z',
  updated_at: '2026-07-02T00:00:00Z',
  deleted_at: null,
};

const CARD_ROW = {
  candidacy_id: CAND1,
  edition_id: EDITION,
  profile_id: UID,
  handle: 'mara',
  title: null,
  city: null,
  category: null,
  status: 'submitted' as const,
  video_url: `${UID}/${CAND1}.mp4`,
  thumb_path: null,
  created_at: '2026-07-02T00:00:00Z',
};

/** Thenable PostgREST-builder stub: records calls; awaiting resolves to { data, error }. */
function stub(rows: Array<Record<string, unknown>> = []) {
  const calls: Array<{ method: string; arg: unknown; arg2?: unknown }> = [];
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'insert', 'update', 'order', 'limit', 'or']) {
    chain[m] = (arg?: unknown, arg2?: unknown) => {
      calls.push({ method: m, arg, arg2 });
      return chain;
    };
  }
  chain['eq'] = (col: unknown, val?: unknown) => {
    calls.push({ method: 'eq', arg: col, arg2: val });
    return chain;
  };
  chain['is'] = (col: unknown, val?: unknown) => {
    calls.push({ method: 'is', arg: col, arg2: val });
    return chain;
  };
  chain['single'] = () => {
    calls.push({ method: 'single', arg: undefined });
    return {
      then: (resolve: (v: { data: unknown; error: null }) => void) =>
        resolve({ data: rows[0] ?? null, error: null }),
    };
  };
  chain['maybeSingle'] = () => {
    calls.push({ method: 'maybeSingle', arg: undefined });
    return {
      then: (resolve: (v: { data: unknown; error: null }) => void) =>
        resolve({ data: rows[0] ?? null, error: null }),
    };
  };
  chain.then = (resolve: (v: { data: unknown; error: null }) => void) =>
    resolve({ data: rows, error: null });
  const client = { from: () => chain } as unknown as AthanorClient;
  return { client, calls };
}

describe('candidacyKeys', () => {
  it('namespaces detail / list under the candidacy root', () => {
    expect(candidacyKeys.all).toEqual(['candidacy']);
    expect(candidacyKeys.detail(CAND1)).toEqual(['candidacy', 'detail', CAND1]);
    expect(candidacyKeys.list(EDITION)).toEqual(['candidacy', 'list', EDITION, null]);
  });
});

describe('candidacyVideoPath', () => {
  it('is the pure `{uid}/{candidacy_id}.mp4` storage convention', () => {
    expect(candidacyVideoPath(UID, CAND1)).toBe(`${UID}/${CAND1}.mp4`);
  });
});

describe('candidacyThumbPath', () => {
  it('is the pure `{uid}/{candidacy_id}-thumb.jpg` storage convention', () => {
    expect(candidacyThumbPath(UID, CAND1)).toBe(`${UID}/${CAND1}-thumb.jpg`);
  });
  it('puts the poster in the uploader own folder, which is what the storage policies gate on', () => {
    expect(candidacyThumbPath(UID, CAND1).split('/')[0]).toBe(UID);
  });
  it('never collides with the video it is a frame of', () => {
    expect(candidacyThumbPath(UID, CAND1)).not.toBe(candidacyVideoPath(UID, CAND1));
  });
});

describe('submitCandidacy', () => {
  it('sends the client-generated id, pinned profile_id and status=submitted', async () => {
    const { client, calls } = stub([CANDIDACY_ROW]);
    const input = {
      edition_id: EDITION,
      story: CANDIDACY_ROW.story,
      goal: CANDIDACY_ROW.goal,
      impact: CANDIDACY_ROW.impact,
      video_url: CANDIDACY_ROW.video_url,
      thumb_path: CANDIDACY_ROW.thumb_path,
      plan: CANDIDACY_ROW.plan,
    };
    const created = await submitCandidacy(client, { id: CAND1, profileId: UID, input });
    const insert = calls.find((c) => c.method === 'insert');
    expect(insert?.arg).toEqual({ ...input, id: CAND1, profile_id: UID, status: 'submitted' });
    expect(created.status).toBe('submitted');
  });
});

describe('getCandidates', () => {
  it('scopes to the edition and orders by (created_at, candidacy_id) desc', async () => {
    const { client, calls } = stub([]);
    await getCandidates(client, { editionId: EDITION });
    expect(
      calls.some((c) => c.method === 'eq' && c.arg === 'edition_id' && c.arg2 === EDITION),
    ).toBe(true);
    expect(calls.filter((c) => c.method === 'order').map((c) => c.arg)).toEqual([
      'created_at',
      'candidacy_id',
    ]);
  });

  it('applies the (created_at, candidacy_id) lt or-cursor when provided', async () => {
    const cursor = { created_at: '2026-07-03T00:00:00Z', candidacy_id: CAND1 };
    const { client, calls } = stub([]);
    await getCandidates(client, { editionId: EDITION, cursor });
    const orCall = calls.find((c) => c.method === 'or');
    expect(orCall?.arg).toContain(`created_at.lt.${cursor.created_at}`);
    expect(orCall?.arg).toContain(`candidacy_id.lt.${cursor.candidacy_id}`);
  });

  it('full page → nextCursor is the last row keyset', async () => {
    const second = { ...CARD_ROW, candidacy_id: CAND2, created_at: '2026-07-01T00:00:00Z' };
    const { client } = stub([CARD_ROW, second]);
    const page = await getCandidates(client, { editionId: EDITION, limit: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toEqual({ created_at: '2026-07-01T00:00:00Z', candidacy_id: CAND2 });
  });

  it('short page → nextCursor null', async () => {
    const { client } = stub([CARD_ROW]);
    const page = await getCandidates(client, { editionId: EDITION, limit: 2 });
    expect(page.nextCursor).toBeNull();
  });
});

describe('getCandidateById', () => {
  it('filters by candidacy_id via maybeSingle and parses the card', async () => {
    const { client, calls } = stub([CARD_ROW]);
    const card = await getCandidateById(client, CAND1);
    expect(
      calls.some((c) => c.method === 'eq' && c.arg === 'candidacy_id' && c.arg2 === CAND1),
    ).toBe(true);
    expect(calls.some((c) => c.method === 'maybeSingle')).toBe(true);
    expect(card?.handle).toBe('mara');
  });

  it('returns null when the card is not visible (screened out / absent)', async () => {
    const { client } = stub([]);
    expect(await getCandidateById(client, CAND1)).toBeNull();
  });
});

describe('candidacy — a database failure reaches the caller', () => {
  // The video is already uploaded to {uid}/{id}.mp4 before this insert runs (that is why the id
  // is client-generated), so a swallowed error would strand the object with no row.
  it('submitCandidacy rethrows rather than stranding the uploaded video', async () => {
    const fake = makeFakeClient({ 'dream_candidacies.insert': [{ error: DB_DOWN }] });
    await expect(
      submitCandidacy(asClient(fake), {
        id: CAND1,
        profileId: UID,
        input: {
          edition_id: EDITION,
          story: 'la mia storia',
          goal: 'il mio obiettivo',
          impact: 'impatto',
          plan: 'piano',
          video_url: `${UID}/${CAND1}.mp4`,
          thumb_path: null,
        },
      }),
    ).rejects.toMatchObject({ code: '57P01' });
  });

  it('getCandidates rethrows instead of showing an empty field of candidates', async () => {
    const fake = makeFakeClient({ 'fund_candidate_cards.select': [{ error: DB_DOWN }] });
    await expect(getCandidates(asClient(fake), { editionId: EDITION })).rejects.toMatchObject({
      code: '57P01',
    });
  });

  it('getCandidateById rethrows instead of reporting the candidate screened out', async () => {
    const fake = makeFakeClient({ 'fund_candidate_cards.select': [{ error: DB_DOWN }] });
    await expect(getCandidateById(asClient(fake), CAND1)).rejects.toMatchObject({
      code: '57P01',
    });
  });

  it('getCandidates treats a null payload as no candidates, not a crash', async () => {
    const fake = makeFakeClient({ 'fund_candidate_cards.select': [{ data: null }] });
    await expect(getCandidates(asClient(fake), { editionId: EDITION })).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
  });
});
