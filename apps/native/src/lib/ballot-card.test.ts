import { describe, expect, it } from 'vitest';
import type { CandidateCard } from '@athanor/api';
import { t } from '@athanor/i18n';
import {
  authorParts,
  ballotFilters,
  categoryLabel,
  confirmedHistory,
  filterCandidates,
  resolveFilter,
} from './ballot-card';

function card(over: Partial<CandidateCard> = {}): CandidateCard {
  return {
    candidacy_id: '11111111-1111-1111-1111-111111111111',
    edition_id: '22222222-2222-2222-2222-222222222222',
    profile_id: '33333333-3333-3333-3333-333333333333',
    handle: 'marta',
    title: 'Una casa-laboratorio',
    city: 'Torino',
    category: 'artistic',
    status: 'shortlisted',
    video_url: 'uid/a.mp4',
    thumb_path: null,
    created_at: '2026-08-16T00:00:00Z',
    budget_cents: 800000,
    min_viable_cents: 500000,
    skills_needed: [],
    dream_id: null,
    dream_milestones_done: null,
    dream_helps_confirmed: null,
    ...over,
  };
}

describe('ballotFilters', () => {
  it('offers «all» plus only the categories actually on the ballot', () => {
    expect(ballotFilters([card({ category: 'volunteer' }), card({ category: 'startup' })])).toEqual(
      ['all', 'startup', 'volunteer'],
    );
  });

  it('keeps the vocabulary order rather than first-seen order', () => {
    const filters = ballotFilters([
      card({ category: 'volunteer' }),
      card({ category: 'artistic' }),
      card({ category: 'startup' }),
    ]);
    expect(filters).toEqual(['all', 'startup', 'artistic', 'volunteer']);
  });

  // A chip whose only possible outcome is an empty ballot is not a control.
  it('never offers a category no candidate carries', () => {
    expect(
      ballotFilters([card({ category: 'artistic' }), card({ category: 'startup' })]),
    ).not.toContain('business');
  });

  it('renders no row when one category or fewer is represented', () => {
    expect(ballotFilters([card({ category: 'artistic' }), card({ category: 'artistic' })])).toEqual(
      [],
    );
    expect(ballotFilters([card({ category: null })])).toEqual([]);
    expect(ballotFilters([])).toEqual([]);
  });

  it('does not count uncategorised candidacies as a category', () => {
    expect(ballotFilters([card({ category: 'artistic' }), card({ category: null })])).toEqual([]);
  });
});

describe('resolveFilter', () => {
  it('keeps a choice that is still offered', () => {
    expect(resolveFilter(['all', 'startup', 'artistic'], 'startup')).toBe('startup');
  });

  // The last candidate of a category can leave the page on a refetch. Falling back to «all»
  // is what stops the ballot rendering empty with no chip lit and no way back.
  it('falls back to «all» when the chosen category is no longer on the ballot', () => {
    expect(resolveFilter(['all', 'artistic'], 'startup')).toBe('all');
  });

  it('falls back to «all» when the row disappeared entirely', () => {
    expect(resolveFilter([], 'startup')).toBe('all');
  });
});

describe('filterCandidates', () => {
  const cards = [
    card({ candidacy_id: 'a', category: 'artistic' }),
    card({ candidacy_id: 'b', category: 'startup' }),
    card({ candidacy_id: 'c', category: null }),
  ];

  it('«all» keeps every card, including the uncategorised one', () => {
    expect(filterCandidates(cards, 'all').map((c) => c.candidacy_id)).toEqual(['a', 'b', 'c']);
  });

  it('a category keeps only its own', () => {
    expect(filterCandidates(cards, 'startup').map((c) => c.candidacy_id)).toEqual(['b']);
  });

  it('an uncategorised candidacy is reachable only through «all»', () => {
    expect(filterCandidates(cards, 'artistic').map((c) => c.candidacy_id)).toEqual(['a']);
  });
});

describe('confirmedHistory', () => {
  it('reports the confirmed counts of a linked dream', () => {
    expect(
      confirmedHistory(
        card({ dream_id: 'd1', dream_milestones_done: 3, dream_helps_confirmed: 2 }),
      ),
    ).toEqual({ milestones: 3, helps: 2 });
  });

  it('shows a half that is confirmed even when the other half is zero', () => {
    expect(
      confirmedHistory(
        card({ dream_id: 'd1', dream_milestones_done: 1, dream_helps_confirmed: 0 }),
      ),
    ).toEqual({ milestones: 1, helps: 0 });
  });

  it('says nothing when no dream is linked', () => {
    expect(confirmedHistory(card({ dream_id: null }))).toBeNull();
  });

  // The view returns null (not 0) for a soft-deleted dream: the link survives, the dream
  // does not. Same answer as no link — there is nothing to speak for.
  it('says nothing when the linked dream was soft-deleted', () => {
    expect(
      confirmedHistory(
        card({ dream_id: 'd1', dream_milestones_done: null, dream_helps_confirmed: null }),
      ),
    ).toBeNull();
  });

  // «Tappe completate · 0» would manufacture a negative signal about a candidate out of a
  // dream planted last week. Collapse, per DESIGN §11 2026-08-12 rule (b).
  it('collapses a linked dream with nothing confirmed yet', () => {
    expect(
      confirmedHistory(
        card({ dream_id: 'd1', dream_milestones_done: 0, dream_helps_confirmed: 0 }),
      ),
    ).toBeNull();
  });
});

describe('categoryLabel', () => {
  it('localizes the category in both catalogs', () => {
    expect(categoryLabel('artistic', 'it')).toBe('Artistico');
    expect(categoryLabel('artistic', 'en')).toBe('Artistic');
  });

  // The ballot must not invent a second label set: a chip here and a chip in the candidacy
  // wizard read from the same key, so they cannot drift.
  it('reads the same keys the wizard and Costellazioni use', () => {
    expect(categoryLabel('volunteer', 'it')).toBe(t('costellazioni.filter.volunteer', 'it'));
  });

  it('says nothing for an uncategorised candidacy', () => {
    expect(categoryLabel(null, 'it')).toBeNull();
  });
});

describe('authorParts', () => {
  it('joins handle, city and the localized category', () => {
    expect(authorParts({ handle: 'marta', city: 'Torino', categoryLabel: 'Artistico' })).toEqual([
      'marta',
      'Torino',
      'Artistico',
    ]);
  });

  // #226 made «no category» first-class; the old template rendered «marta · Torino ·
  // categoria » for exactly those rows.
  it('drops the category segment rather than trailing a separator', () => {
    expect(authorParts({ handle: 'marta', city: 'Torino', categoryLabel: null })).toEqual([
      'marta',
      'Torino',
    ]);
  });

  it('drops an absent city', () => {
    expect(authorParts({ handle: 'marta', city: null, categoryLabel: 'Artistico' })).toEqual([
      'marta',
      'Artistico',
    ]);
  });

  it('drops empty strings, not only nulls', () => {
    expect(authorParts({ handle: 'marta', city: '', categoryLabel: '' })).toEqual(['marta']);
  });
});
