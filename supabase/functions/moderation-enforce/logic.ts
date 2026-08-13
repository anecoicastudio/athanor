import { z } from 'zod';
import { error, json } from '../_shared/respond.ts';

// The GoTrue half of a moderation sanction (#106). The DB half — profiles.suspended_until /
// banned_at behind restrictive RLS — is written by resolve_report before this function is
// enqueued, and holds on its own if this call never lands (the pg_net enqueue is a guarded
// no-op, and a failed run here leaves only the ≤ JWT-expiry lag the DB half already covers).
//
// What ban_duration buys (issue #106 research comment, verified against supabase/auth):
// GoTrue rejects new sign-ins, refresh-token rotation and every authenticated endpoint —
// including the getUser() behind requireUser() in every user-callable edge function — the
// moment banned_until is set. No signOut call here on purpose: banning does not delete the
// stored refresh token, so when a suspension's banned_until passes, the member resumes
// without re-login — exactly the wanted semantics for a temporary sanction. A permanent ban
// never reaches expiry, so the lingering token is inert.
//
// Transport shell in index.ts (requireServiceRole first); everything here is injected so the
// duration arithmetic and the port calls are unit-testable (repo convention: DI over mocks).

/** ~100 years, GoTrue-side "permanent". `banned_at` on profiles is the durable fact. */
export const BAN_FOREVER = '876000h';

const payload = z.object({
  profileId: z.string().uuid(),
  action: z.enum(['suspend', 'ban']),
  /** ISO instant; required for suspend, ignored for ban. */
  until: z.string().datetime().nullable().optional(),
});

export type ModerationAuth = {
  /** db.auth.admin.updateUserById — the only GoTrue call this function makes. */
  updateUserById: (
    profileId: string,
    attrs: { ban_duration: string },
  ) => Promise<{ error: { message: string } | null }>;
};

export type EnforceCtx = {
  auth: ModerationAuth;
  now: () => Date;
};

export async function applyModerationEnforcement(ctx: EnforceCtx, req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error('invalid json', 400);
  }
  const parsed = payload.safeParse(body);
  if (!parsed.success) return error('invalid payload', 400);
  const { profileId, action, until } = parsed.data;

  let banDuration: string;
  if (action === 'ban') {
    banDuration = BAN_FOREVER;
  } else {
    if (!until) return error('suspend requires until', 400);
    const seconds = Math.ceil((new Date(until).getTime() - ctx.now().getTime()) / 1000);
    // resolve_report validated `> now()` before enqueueing; a non-positive remainder here
    // means the queue outlived the suspension, and a zero-length GoTrue ban would LIFT an
    // existing one (duration 0 ⇒ banned_until = NULL). Refuse instead.
    if (seconds <= 0) return error('until is not in the future', 400);
    banDuration = `${seconds}s`;
  }

  const { error: authErr } = await ctx.auth.updateUserById(profileId, {
    ban_duration: banDuration,
  });
  if (authErr) return error(`auth update failed: ${authErr.message}`, 502);

  return json({ applied: banDuration });
}
