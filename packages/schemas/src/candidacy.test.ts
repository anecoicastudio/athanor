import { describe, expect, it } from 'vitest';
import { candidacyInsertSchema, candidateCardSchema, dreamCandidacySchema } from './candidacy';

const validRow = {
  id: '11111111-1111-1111-1111-111111111111',
  edition_id: '22222222-2222-2222-2222-222222222222',
  profile_id: '33333333-3333-3333-3333-333333333333',
  story: 'Da dove nasce',
  goal: 'Cosa realizzo',
  impact: 'Chi ne beneficia',
  video_url: '33333333-3333-3333-3333-333333333333/11111111-1111-1111-1111-111111111111.mp4',
  plan: 'Il percorso',
  status: 'submitted',
  city: null,
  category: null,
  created_at: '2026-06-18T00:00:00Z',
  updated_at: '2026-06-18T00:00:00Z',
  deleted_at: null,
};

describe('dreamCandidacySchema', () => {
  it('parses a valid row', () => {
    expect(dreamCandidacySchema.parse(validRow).status).toBe('submitted');
  });
  it('rejects an empty story', () => {
    expect(() => dreamCandidacySchema.parse({ ...validRow, story: '' })).toThrow();
  });
  it('rejects an unknown status', () => {
    expect(() => dreamCandidacySchema.parse({ ...validRow, status: 'won' })).toThrow();
  });
});

describe('candidacyInsertSchema', () => {
  it('picks only the author-supplied fields', () => {
    const parsed = candidacyInsertSchema.parse({
      edition_id: validRow.edition_id,
      story: validRow.story,
      goal: validRow.goal,
      impact: validRow.impact,
      video_url: validRow.video_url,
      plan: validRow.plan,
    });
    expect(parsed).not.toHaveProperty('status'); // server pins it
  });
});

describe('candidateCardSchema', () => {
  it('parses a candidate card with a null title', () => {
    const card = candidateCardSchema.parse({
      candidacy_id: '33333333-3333-3333-3333-333333333333',
      edition_id: '22222222-2222-2222-2222-222222222222',
      profile_id: '44444444-4444-4444-4444-444444444444',
      handle: 'marta',
      title: null,
      city: 'Torino',
      category: 'Impresa sociale',
      status: 'submitted',
      video_url: 'uid/cand.mp4',
      created_at: '2026-06-18T00:00:00Z',
    });
    expect(card.title).toBeNull();
  });
});
