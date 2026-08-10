import { expect, test } from 'vitest';
import { evaluateStars, type StarFacts } from './stars.ts';

const ZERO: StarFacts = {
  dreamPublished: false,
  milestonesDefined: 0,
  ownMilestonesCompleted: 0,
  helpsCompleted: 0,
  evoluzionePostsStarred: 0,
  distinctStarrers: 0,
  momentoConversations: 0,
  invitesActivated: 0,
};

test('new user earns nothing; progress tracked for all six', () => {
  const r = evaluateStars(ZERO);
  expect(r.granted).toEqual([]);
  expect(Object.keys(r.progress).sort()).toEqual(
    ['ambasciatore', 'collaboratore', 'creatore', 'innovatore', 'mentor', 'visionario'].sort(),
  );
  expect(r.progress.creatore).toEqual({ done: 0, total: 2, unit: 'tappe' });
});
test('Creatore lights at 2 own milestones completed', () => {
  expect(evaluateStars({ ...ZERO, ownMilestonesCompleted: 2 }).granted).toContain('creatore');
});
test('Mentor at 3 helps, Collaboratore at 5 momenti, Ambasciatore at 5 invites', () => {
  expect(evaluateStars({ ...ZERO, helpsCompleted: 3 }).granted).toContain('mentor');
  expect(evaluateStars({ ...ZERO, momentoConversations: 5 }).granted).toContain('collaboratore');
  expect(evaluateStars({ ...ZERO, invitesActivated: 5 }).granted).toContain('ambasciatore');
});
test('Innovatore needs BOTH 5 starred posts AND 10 distinct starrers', () => {
  expect(
    evaluateStars({ ...ZERO, evoluzionePostsStarred: 5, distinctStarrers: 9 }).granted,
  ).not.toContain('innovatore');
  expect(
    evaluateStars({ ...ZERO, evoluzionePostsStarred: 5, distinctStarrers: 10 }).granted,
  ).toContain('innovatore');
});
test('Visionario is a composite: dream + 3 milestones + 10 ✦', () => {
  const ok = evaluateStars({
    ...ZERO,
    dreamPublished: true,
    milestonesDefined: 3,
    evoluzionePostsStarred: 10,
  });
  expect(ok.granted).toContain('visionario');
  const noDream = evaluateStars({
    ...ZERO,
    dreamPublished: false,
    milestonesDefined: 3,
    evoluzionePostsStarred: 10,
  });
  expect(noDream.granted).not.toContain('visionario');
});
test('progress caps done at total (never over-fills the ring)', () => {
  expect(evaluateStars({ ...ZERO, helpsCompleted: 9 }).progress.mentor).toEqual({
    done: 3,
    total: 3,
    unit: 'aiuti',
  });
});

// The tests above assert `granted` plus two of the six progress entries. The other four rings
// and every `unit` token were unasserted — mutation testing replaced each with `{}` / `''` and
// nothing failed. The UI renders these directly (own-profile only, §4.10), so a blank unit or a
// dropped ring is a visible defect. Assert the whole record in one place.
test('every ring reports its own done/total and its own unit token', () => {
  const r = evaluateStars({
    ...ZERO,
    dreamPublished: true,
    evoluzionePostsStarred: 4,
    distinctStarrers: 3,
    ownMilestonesCompleted: 1,
    helpsCompleted: 2,
    momentoConversations: 2,
    invitesActivated: 1,
  });
  expect(r.progress).toEqual({
    visionario: { done: 4, total: 10, unit: 'reazioni' },
    creatore: { done: 1, total: 2, unit: 'tappe' },
    mentor: { done: 2, total: 3, unit: 'aiuti' },
    innovatore: { done: 3, total: 10, unit: 'reazioni' },
    collaboratore: { done: 2, total: 5, unit: 'momenti' },
    ambasciatore: { done: 1, total: 5, unit: 'inviti' },
  });
});

// Visionario is a three-way AND. The suite exercised only the dreamPublished arm, so dropping
// either of the other two conjuncts still passed. One case per arm, each failing on that arm alone.
test('Visionario needs all three: too few milestones alone withholds it', () => {
  expect(
    evaluateStars({
      ...ZERO,
      dreamPublished: true,
      milestonesDefined: 2,
      evoluzionePostsStarred: 10,
    }).granted,
  ).not.toContain('visionario');
});
test('Visionario needs all three: too few ✦ alone withholds it', () => {
  expect(
    evaluateStars({
      ...ZERO,
      dreamPublished: true,
      milestonesDefined: 3,
      evoluzionePostsStarred: 9,
    }).granted,
  ).not.toContain('visionario');
});

// Innovatore's other arm: the suite only ever failed it on distinctStarrers.
test('Innovatore withholds on too few starred posts even with the starrers', () => {
  expect(
    evaluateStars({ ...ZERO, evoluzionePostsStarred: 4, distinctStarrers: 10 }).granted,
  ).not.toContain('innovatore');
});
