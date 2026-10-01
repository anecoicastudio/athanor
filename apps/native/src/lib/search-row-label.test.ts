import { describe, expect, it } from 'vitest';
import { searchRowLabel } from './search-row-label';

describe('searchRowLabel — a person result says the name the avatar used to carry (#884)', () => {
  it('leads a person row with the display name, then the handle and the bio', () => {
    expect(
      searchRowLabel({
        entity_type: 'person',
        title: 'sole_designer',
        subtitle: 'designer · Milano',
        display_name: 'Sole Marini',
      }),
    ).toBe('Sole Marini, sole_designer, designer · Milano');
  });

  it('falls back to the handle alone when the member set no name', () => {
    expect(
      searchRowLabel({
        entity_type: 'person',
        title: 'tino_chef',
        subtitle: 'chef',
        display_name: null,
      }),
    ).toBe('tino_chef, chef');
    expect(
      searchRowLabel({
        entity_type: 'person',
        title: 'tino_chef',
        subtitle: '',
        display_name: '  ',
      }),
    ).toBe('tino_chef');
  });

  it('keeps a project or an event as title and subtitle, and never a dangling comma', () => {
    expect(
      searchRowLabel({
        entity_type: 'project',
        title: 'Orto condiviso',
        subtitle: 'Palermo',
        display_name: null,
      }),
    ).toBe('Orto condiviso, Palermo');
    expect(
      searchRowLabel({ entity_type: 'event', title: 'Cena', subtitle: '', display_name: null }),
    ).toBe('Cena');
  });
});
