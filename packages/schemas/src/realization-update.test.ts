import { describe, expect, it } from 'vitest';
import {
  realizationUpdateEditSchema,
  realizationUpdateInsertSchema,
  realizationUpdateSchema,
} from './realization-update';

/** A note as the winner posted it and the row holds it (#230). */
const row = {
  id: '00000000-0000-0000-0000-0000000000b1',
  edition_id: '00000000-0000-0000-0000-0000000000ed',
  profile_id: '00000000-0000-0000-0000-0000000000aa',
  plan_phase_id: '00000000-0000-0000-0000-0000000000f1',
  body: 'Lo spazio è affittato: contratto firmato oggi.',
  deleted_at: null,
  created_at: '2026-10-02T10:00:00+00:00',
  updated_at: '2026-10-02T10:00:00+00:00',
};

describe('realizationUpdateSchema', () => {
  it('parses a note unchanged, phase attribution included', () => {
    expect(realizationUpdateSchema.parse(row)).toEqual(row);
  });

  it('carries exactly the realization_updates columns — no count that could become a metric (rule #3)', () => {
    expect(Object.keys(realizationUpdateSchema.shape)).toEqual([
      'id',
      'edition_id',
      'profile_id',
      'plan_phase_id',
      'body',
      'deleted_at',
      'created_at',
      'updated_at',
    ]);
  });

  it('keeps plan_phase_id nullable — a note about the project as a whole, or an erased phase', () => {
    const whole = { ...row, plan_phase_id: null };
    expect(realizationUpdateSchema.parse(whole)).toEqual(whole);
    expect(() => realizationUpdateSchema.parse({ ...row, plan_phase_id: 'phase-1' })).toThrow();
  });

  it('keeps deleted_at as the withdrawal marker and reads it back unchanged', () => {
    const withdrawn = { ...row, deleted_at: '2026-10-03T08:00:00+00:00' };
    expect(realizationUpdateSchema.parse(withdrawn)).toEqual(withdrawn);
  });

  it('mirrors the body CHECK exactly — non-blank, at most 2000, never trimmed on read', () => {
    expect(realizationUpdateSchema.parse({ ...row, body: 'x'.repeat(2000) }).body).toHaveLength(
      2000,
    );
    expect(() => realizationUpdateSchema.parse({ ...row, body: 'x'.repeat(2001) })).toThrow();
    for (const blank of ['', '   ', '\n']) {
      expect(() => realizationUpdateSchema.parse({ ...row, body: blank })).toThrow();
    }
    expect(realizationUpdateSchema.parse({ ...row, body: ' ok ' }).body).toBe(' ok ');
  });

  it('rejects non-uuid identifiers', () => {
    for (const key of ['id', 'edition_id', 'profile_id'] as const) {
      expect(() => realizationUpdateSchema.parse({ ...row, [key]: 'not-a-uuid' })).toThrow();
    }
  });
});

describe('realizationUpdateInsertSchema (what the winner posts)', () => {
  const note = {
    edition_id: row.edition_id,
    profile_id: row.profile_id,
    body: '  Primo passo fatto.  ',
  };

  it('carries exactly cycle, author, body and the defaulted phase — never id, deleted_at or timestamps', () => {
    expect(Object.keys(realizationUpdateInsertSchema.shape).sort()).toEqual([
      'body',
      'edition_id',
      'plan_phase_id',
      'profile_id',
    ]);
    const parsed = realizationUpdateInsertSchema.parse({
      ...note,
      id: row.id,
      deleted_at: '2026-10-03T08:00:00+00:00',
      created_at: row.created_at,
    });
    expect(parsed).toEqual({
      edition_id: row.edition_id,
      profile_id: row.profile_id,
      body: 'Primo passo fatto.',
      plan_phase_id: null,
    });
  });

  it('trims the body on the way in and refuses a blank or over-long one', () => {
    expect(realizationUpdateInsertSchema.parse(note).body).toBe('Primo passo fatto.');
    expect(() => realizationUpdateInsertSchema.parse({ ...note, body: '   ' })).toThrow();
    expect(() =>
      realizationUpdateInsertSchema.parse({ ...note, body: 'x'.repeat(2001) }),
    ).toThrow();
  });

  it('requires the cycle and the author — the insert policy pins profile_id to auth.uid()', () => {
    for (const key of ['edition_id', 'profile_id'] as const) {
      const { [key]: _dropped, ...without } = note;
      expect(realizationUpdateInsertSchema.safeParse(without).success).toBe(false);
    }
  });

  it('accepts a phase attribution and a null one', () => {
    expect(
      realizationUpdateInsertSchema.parse({ ...note, plan_phase_id: row.plan_phase_id })
        .plan_phase_id,
    ).toBe(row.plan_phase_id);
    expect(
      realizationUpdateInsertSchema.parse({ ...note, plan_phase_id: null }).plan_phase_id,
    ).toBeNull();
    expect(() =>
      realizationUpdateInsertSchema.parse({ ...note, plan_phase_id: 'phase-1' }),
    ).toThrow();
  });
});

describe('realizationUpdateEditSchema', () => {
  it('edits body and phase only — never re-targets the cycle, changes hands or withdraws', () => {
    expect(Object.keys(realizationUpdateEditSchema.shape).sort()).toEqual([
      'body',
      'plan_phase_id',
    ]);
    const parsed = realizationUpdateEditSchema.parse({
      body: 'riscritto',
      edition_id: '00000000-0000-0000-0000-0000000000ff',
      profile_id: '00000000-0000-0000-0000-0000000000ff',
      deleted_at: '2026-10-03T08:00:00+00:00',
    });
    expect(parsed).toEqual({ body: 'riscritto' });
  });

  it('accepts an empty patch and a lone phase change, null included', () => {
    expect(realizationUpdateEditSchema.parse({})).toEqual({});
    expect(realizationUpdateEditSchema.parse({ plan_phase_id: null })).toEqual({
      plan_phase_id: null,
    });
    expect(realizationUpdateEditSchema.parse({ plan_phase_id: row.plan_phase_id })).toEqual({
      plan_phase_id: row.plan_phase_id,
    });
  });

  it('still refuses a blank body — partial means optional, not unbounded', () => {
    expect(() => realizationUpdateEditSchema.parse({ body: '  ' })).toThrow();
    expect(() => realizationUpdateEditSchema.parse({ body: 'x'.repeat(2001) })).toThrow();
    expect(realizationUpdateEditSchema.parse({ body: '  ok  ' })).toEqual({ body: 'ok' });
  });
});
