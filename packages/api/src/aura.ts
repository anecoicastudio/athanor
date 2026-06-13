import { ZERO_AURA_SNAPSHOT, type AuraSnapshot } from '@auria/schemas';
import type { AuriaClient } from './client';

/** Query-key factory for the read-only Aura snapshot (api rule: per-entity). */
export const auraKeys = {
  all: ['aura'] as const,
  detail: (profileId: string) => [...auraKeys.all, 'detail', profileId] as const,
};

/**
 * Read a profile's Aura snapshot. The M6 score-engine has not been built, so
 * there is no `aura_scores` row to read — return the coalesced zero-snapshot
 * (PRD §1.1 / backend 07 §2.2a: never null). M6 replaces the body with a real
 * read on `aura_scores` keyed by `profileId`; the contract (always a
 * well-formed snapshot) is unchanged, so callers never change. Aura is never
 * client-writable (rule #1) — there is no mutation counterpart here.
 */
export async function getAuraScore(
  _client: AuriaClient,
  _profileId: string,
): Promise<AuraSnapshot> {
  return ZERO_AURA_SNAPSHOT;
}
