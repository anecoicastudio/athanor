import { z } from 'zod';
import { avatarPathSchema, displayNameSchema, peerIdentityFields } from './profile.ts';

/**
 * The wire shape of the incoming-requests select, parsed at the boundary. The aliased embed
 * (requester → profiles via the requester FK) defeats supabase-js's row inference, so this
 * schema is what types the row.
 */
export const connectionRequestRow = z.object({
  id: z.string().uuid(),
  requester_id: z.string().uuid(),
  created_at: z.string(),
  requester: z
    .object({
      handle: z.string().nullable(),
      display_name: displayNameSchema.nullable(),
      avatar_path: avatarPathSchema.nullable(),
    })
    .nullable(),
});
export type ConnectionRequestRow = z.infer<typeof connectionRequestRow>;

// Incoming-request inbox read model (camelCase): the row resolved to the requester (peer).
export const connectionRequestListItem = z.object({
  id: z.string().uuid(), // the request id — feeds respond_to_connection
  peerId: z.string().uuid(), // the requester
  ...peerIdentityFields,
  createdAt: z.string(),
});
export type ConnectionRequestListItem = z.infer<typeof connectionRequestListItem>;

// Established-connections read model (camelCase): resolved to the other participant.
export const connectionListItem = z.object({
  id: z.string().uuid(), // the connection id
  peerId: z.string().uuid(),
  ...peerIdentityFields,
  createdAt: z.string(),
});
export type ConnectionListItem = z.infer<typeof connectionListItem>;

// Derived button state for a given peer (no DB row): drives <ConnectButton>.
export const connectionState = z.enum(['none', 'pending-out', 'pending-in', 'connected']);
export type ConnectionState = z.infer<typeof connectionState>;
