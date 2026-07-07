import { z } from 'zod';

/**
 * Referral activation row (P4.1). Read-only for clients — rows are written only
 * by the signup path / service_role (rule #1: activations confer ZERO Aura).
 */
export const inviteSchema = z.object({
  id: z.string().uuid(),
  inviter_id: z.string().uuid(),
  code: z.string().min(6),
  invitee_id: z.string().uuid().nullable(),
  activated_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type Invite = z.infer<typeof inviteSchema>;
