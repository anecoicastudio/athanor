import { z } from 'zod';

/**
 * Shared non-blank string rules (audit 2026-07-09 — the same two idioms were
 * hand-rolled in 13 places with drifting arg names and messages).
 *
 * Two variants on purpose — they are NOT interchangeable:
 * - `nonBlankString` (read/entity): validates WITHOUT transforming, so DB rows
 *   round-trip byte-identical through parse (PostgREST payloads are never rewritten).
 * - `trimmedNonBlank` (insert/update): trims first, then enforces 1..max — client
 *   input is normalized before it reaches the DB.
 */

/** Read-side: ≤ max chars and not blank after trim; the value itself is untouched. */
export const nonBlankString = (max: number, message: string) =>
  z
    .string()
    .max(max)
    .refine((v) => v.trim().length > 0, message);

/** Write-side: trim, then 1..max chars. */
export const trimmedNonBlank = (max: number, message?: string) =>
  z.string().trim().min(1, message).max(max);
