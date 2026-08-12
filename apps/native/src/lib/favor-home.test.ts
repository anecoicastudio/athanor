import { describe, expect, it } from 'vitest';
import type { NeedsPage } from '@athanor/api';
import type { FavorNeed } from '@athanor/schemas';
import { FAVOR_HOME_PREVIEW, topOpenNeeds } from './favor-home';

const need = (id: string, handle: string): FavorNeed => ({
  need_milestone_id: id,
  need: `Serve una mano con ${handle}`,
  need_created_at: '2026-08-11T10:00:00Z',
  target_id: `${id}-target`,
  target_handle: handle,
});

const page = (needs: FavorNeed[]): NeedsPage => ({ needs, nextCursor: null });

describe('topOpenNeeds', () => {
  // The three non-answers — in flight, idle, cold error — all reach here as `undefined`, and all
  // three make the card render nothing. Silence is not the #111 defect: it asserts nothing, where
  // the «Presto qui» it replaces asserted a shipped feature was unbuilt.
  it('reads every non-answer as «nothing to pass on»', () => {
    expect(topOpenNeeds(undefined)).toEqual([]);
  });

  it('reads a page with no needs as nothing too', () => {
    expect(topOpenNeeds([page([])])).toEqual([]);
    expect(topOpenNeeds([])).toEqual([]);
  });

  it('previews at most FAVOR_HOME_PREVIEW needs', () => {
    const needs = [need('a', 'ele_yoga'), need('b', 'rocco_film'), need('c', 'sole_designer')];
    expect(topOpenNeeds([page(needs)])).toHaveLength(FAVOR_HOME_PREVIEW);
    expect(topOpenNeeds([page(needs)])).toEqual(needs.slice(0, FAVOR_HOME_PREVIEW));
  });

  it('shows what there is when there are fewer than the preview allows', () => {
    const one = [need('a', 'gio_musica')];
    expect(topOpenNeeds([page(one)])).toEqual(one);
  });

  // Home reads the HEAD of the sheet's cache entry. Reaching into later pages would make the
  // card's contents depend on how far the member had scrolled the sheet before backing out.
  it('reads the first page only, however many the sheet has fetched', () => {
    const first = [need('a', 'marta_ceramica')];
    const second = [need('b', 'tino_chef'), need('c', 'dario_legno')];
    expect(topOpenNeeds([page(first), page(second)])).toEqual(first);
  });

  // The order is the view's `(need_created_at, need_milestone_id)` keyset (`favors.ts:34-35`).
  // A client-side sort here would disagree with the sheet dealing from the same cache entry, so
  // the need you tapped would not be the need you got.
  it('never re-ranks — the server order survives', () => {
    const older = { ...need('a', 'bea_foto'), need_created_at: '2026-08-01T10:00:00Z' };
    const newer = { ...need('b', 'ele_yoga'), need_created_at: '2026-08-11T10:00:00Z' };
    expect(topOpenNeeds([page([older, newer])])).toEqual([older, newer]);
  });
});
