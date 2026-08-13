// moderation-enforce (#106) — internal service-role: reached only by pg_net from
// athanor.enqueue_moderation_enforce when resolve_report suspends or bans. Sets the GoTrue
// ban (ban_duration → auth.users.banned_until), which closes sign-in, refresh and every
// requireUser edge function; the immediate Data-API half lives in RLS (athanor.is_active()).
// Transport shell only — validation and duration arithmetic live in ./logic.ts (unit-tested).
import { requireServiceRole } from '../_shared/auth.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { applyModerationEnforcement } from './logic.ts';

Deno.serve((req) => {
  // Caller gate: service-role only, first statement (see _shared/auth.ts).
  const gate = requireServiceRole(req);
  if (!gate.ok) return gate.response;

  const db = supabaseAdmin();

  return applyModerationEnforcement(
    {
      auth: {
        updateUserById: (profileId, attrs) => db.auth.admin.updateUserById(profileId, attrs),
      },
      now: () => new Date(),
    },
    req,
  );
});
