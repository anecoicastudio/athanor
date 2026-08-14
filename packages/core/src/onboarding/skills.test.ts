import { describe, expect, it } from 'vitest';
import { MAX_SKILLS, SKILLS, isSkill } from './skills';

/**
 * Curated skill vocabulary (#149, PRD §4.2 «skills (tags)»). Multi-select into
 * profiles.skills text[]; keys are stable identifiers, labels in @athanor/i18n
 * (tag.skill.*). Curated rather than free text so the future matcher term
 * (#123) can intersect them across users — the failure mode #273 documented.
 */
describe('SKILLS', () => {
  it('holds the stable skill keys', () => {
    expect(SKILLS).toEqual([
      'branding',
      'ui-ux',
      'illustrazione',
      'grafica-3d',
      'sviluppo-web',
      'sviluppo-mobile',
      'ai-ml',
      'dati',
      'no-code',
      'produzione-musicale',
      'sound-design',
      'videomaking',
      'fotografia',
      'montaggio',
      'copywriting',
      'storytelling',
      'traduzione',
      'social-media',
      'seo',
      'advertising',
      'pr',
      'vendite',
      'fundraising',
      'contabilita',
      'contrattualistica',
      'project-management',
      'facilitazione',
      'coaching',
      'cucina',
      'falegnameria',
    ]);
  });

  it('keys are unique, lowercase and i18n-key safe (no accents)', () => {
    expect(new Set(SKILLS).size).toBe(SKILLS.length);
    for (const key of SKILLS) {
      expect(key).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('caps a member at 10 selected skills, mirroring the DB check', () => {
    expect(MAX_SKILLS).toBe(10);
  });
});

describe('isSkill', () => {
  it('accepts a vocabulary key', () => {
    expect(isSkill('ui-ux')).toBe(true);
  });

  it('rejects free text and near-misses', () => {
    expect(isSkill('ux')).toBe(false);
    expect(isSkill('')).toBe(false);
    expect(isSkill('UI-UX')).toBe(false);
  });
});
