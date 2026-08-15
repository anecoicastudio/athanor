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
  thumb_path: null,
  plan: 'Il percorso',
  status: 'submitted',
  city: null,
  category: null,
  budget_cents: 800000,
  min_viable_cents: 500000,
  skills_needed: ['fotografia'],
  dream_id: null,
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
  it('accepts a null thumb_path — a candidacy submitted before posters, or whose extraction failed', () => {
    expect(dreamCandidacySchema.parse(validRow).thumb_path).toBeNull();
  });
  it('accepts a poster path', () => {
    const row = { ...validRow, thumb_path: '3333/1111-thumb.jpg' };
    expect(dreamCandidacySchema.parse(row).thumb_path).toBe('3333/1111-thumb.jpg');
  });
  it('binds category to the project_category enum (#225, D43)', () => {
    expect(dreamCandidacySchema.parse({ ...validRow, category: 'artistic' }).category).toBe(
      'artistic',
    );
    expect(dreamCandidacySchema.safeParse({ ...validRow, category: 'craft' }).success).toBe(false);
  });
  it('accepts a linked own dream and a null one (FUND-50)', () => {
    const linked = { ...validRow, dream_id: '44444444-4444-4444-4444-444444444444' };
    expect(dreamCandidacySchema.parse(linked).dream_id).toBe(
      '44444444-4444-4444-4444-444444444444',
    );
    expect(dreamCandidacySchema.parse(validRow).dream_id).toBeNull();
  });
});

/** The author-supplied submit payload — validRow minus the server-side columns. */
const validInsert = {
  edition_id: validRow.edition_id,
  story: validRow.story,
  goal: validRow.goal,
  impact: validRow.impact,
  video_url: validRow.video_url,
  plan: validRow.plan,
  budget_cents: validRow.budget_cents,
  min_viable_cents: validRow.min_viable_cents,
};

describe('candidacyInsertSchema', () => {
  it('picks only the author-supplied fields', () => {
    const parsed = candidacyInsertSchema.parse(validInsert);
    expect(parsed).not.toHaveProperty('status'); // server pins it
  });
  it('defaults thumb_path to null, so a poster-less submit is still a valid insert', () => {
    expect(candidacyInsertSchema.parse(validInsert).thumb_path).toBeNull();
  });
  it('defaults skills_needed/category/dream_id — saying nothing about them is first-class (#226 owns the steps)', () => {
    const parsed = candidacyInsertSchema.parse(validInsert);
    expect(parsed.skills_needed).toEqual([]);
    expect(parsed.category).toBeNull();
    expect(parsed.dream_id).toBeNull();
  });
  it('requires a declared budget (FUND-09)', () => {
    const { budget_cents: _b, ...bare } = validInsert;
    expect(candidacyInsertSchema.safeParse(bare).success).toBe(false);
  });
  it.each([0, -1, -800000])('rejects budget_cents = %d', (budget_cents) => {
    expect(candidacyInsertSchema.safeParse({ ...validInsert, budget_cents }).success).toBe(false);
  });
  it.each([0, -1])('rejects min_viable_cents = %d', (min_viable_cents) => {
    expect(candidacyInsertSchema.safeParse({ ...validInsert, min_viable_cents }).success).toBe(
      false,
    );
  });
  it('rejects a non-integer budget — cents are integral', () => {
    expect(candidacyInsertSchema.safeParse({ ...validInsert, budget_cents: 100.5 }).success).toBe(
      false,
    );
  });
  it('rejects a minimum above the budget (mirrors the DB CHECK)', () => {
    expect(
      candidacyInsertSchema.safeParse({
        ...validInsert,
        budget_cents: 500000,
        min_viable_cents: 500001,
      }).success,
    ).toBe(false);
  });
  it('accepts a minimum equal to the budget', () => {
    expect(
      candidacyInsertSchema.safeParse({
        ...validInsert,
        budget_cents: 500000,
        min_viable_cents: 500000,
      }).success,
    ).toBe(true);
  });
  it('caps skills_needed at 10 keys (mirrors the DB bounds)', () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `skill-${i}`);
    expect(candidacyInsertSchema.safeParse({ ...validInsert, skills_needed: eleven }).success).toBe(
      false,
    );
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
      category: 'artistic',
      status: 'submitted',
      video_url: 'uid/cand.mp4',
      created_at: '2026-06-18T00:00:00Z',
      thumb_path: null,
    });
    expect(card.title).toBeNull();
  });
  it('carries the poster path the ballot draws', () => {
    const card = candidateCardSchema.parse({
      candidacy_id: '33333333-3333-3333-3333-333333333333',
      edition_id: '22222222-2222-2222-2222-222222222222',
      profile_id: '44444444-4444-4444-4444-444444444444',
      handle: 'marta',
      title: null,
      city: 'Torino',
      category: 'volunteer',
      status: 'submitted',
      video_url: 'uid/cand.mp4',
      created_at: '2026-06-18T00:00:00Z',
      thumb_path: 'uid/cand-thumb.jpg',
    });
    expect(card.thumb_path).toBe('uid/cand-thumb.jpg');
  });
});
