import type { StarKey } from '@athanor/schemas';
import { STAR_CRITERIA } from './weights';

export interface StarFacts {
  dreamPublished: boolean;
  milestonesDefined: number;
  ownMilestonesCompleted: number;
  helpsCompleted: number;
  evoluzionePostsStarred: number; // own posts that received ✦ (Visionario uses the same count)
  distinctStarrers: number; // distinct members who ✦'d own posts
  momentoConversations: number;
  invitesActivated: number;
}

export interface StarProgress {
  done: number;
  total: number;
  unit: string;
}

const clampDone = (done: number, total: number): number => Math.min(done, total);

/**
 * PRD §4.10 six-star evaluation (pure). `granted` = stars whose criteria are met;
 * `progress` = {done,total,unit} for ALL six (own-profile display only — others see
 * earned-only via RLS). `unit` is a stable token localized by the UI, not a string.
 */
export function evaluateStars(facts: StarFacts): {
  granted: StarKey[];
  progress: Record<StarKey, StarProgress>;
} {
  const visionarioMet =
    facts.dreamPublished &&
    facts.milestonesDefined >= STAR_CRITERIA.visionario.milestonesDefined &&
    facts.evoluzionePostsStarred >= STAR_CRITERIA.visionario.ownPostsStarred;
  const innovatoreMet =
    facts.evoluzionePostsStarred >= STAR_CRITERIA.innovatore.evoluzionePostsStarred &&
    facts.distinctStarrers >= STAR_CRITERIA.innovatore.distinctStarrers;

  const progress: Record<StarKey, StarProgress> = {
    visionario: {
      done: clampDone(
        facts.dreamPublished ? facts.evoluzionePostsStarred : 0,
        STAR_CRITERIA.visionario.ownPostsStarred,
      ),
      total: STAR_CRITERIA.visionario.ownPostsStarred,
      unit: 'reazioni',
    },
    creatore: {
      done: clampDone(facts.ownMilestonesCompleted, STAR_CRITERIA.creatore.ownMilestonesCompleted),
      total: STAR_CRITERIA.creatore.ownMilestonesCompleted,
      unit: 'tappe',
    },
    mentor: {
      done: clampDone(facts.helpsCompleted, STAR_CRITERIA.mentor.helpsCompleted),
      total: STAR_CRITERIA.mentor.helpsCompleted,
      unit: 'aiuti',
    },
    innovatore: {
      done: clampDone(facts.distinctStarrers, STAR_CRITERIA.innovatore.distinctStarrers),
      total: STAR_CRITERIA.innovatore.distinctStarrers,
      unit: 'reazioni',
    },
    collaboratore: {
      done: clampDone(facts.momentoConversations, STAR_CRITERIA.collaboratore.momentoConversations),
      total: STAR_CRITERIA.collaboratore.momentoConversations,
      unit: 'momenti',
    },
    ambasciatore: {
      done: clampDone(facts.invitesActivated, STAR_CRITERIA.ambasciatore.invitesActivated),
      total: STAR_CRITERIA.ambasciatore.invitesActivated,
      unit: 'inviti',
    },
  };

  const granted: StarKey[] = [];
  if (visionarioMet) granted.push('visionario');
  if (facts.ownMilestonesCompleted >= STAR_CRITERIA.creatore.ownMilestonesCompleted)
    granted.push('creatore');
  if (facts.helpsCompleted >= STAR_CRITERIA.mentor.helpsCompleted) granted.push('mentor');
  if (innovatoreMet) granted.push('innovatore');
  if (facts.momentoConversations >= STAR_CRITERIA.collaboratore.momentoConversations)
    granted.push('collaboratore');
  if (facts.invitesActivated >= STAR_CRITERIA.ambasciatore.invitesActivated)
    granted.push('ambasciatore');

  return { granted, progress };
}
