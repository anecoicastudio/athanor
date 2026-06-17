import { expect, test } from 'vitest';
import { evaluateStars, type StarFacts } from './stars';

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
