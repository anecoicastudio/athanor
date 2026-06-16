import { z } from 'zod';

// Mirrors supabase/migrations/<ts>_connection_requests.sql (schemas mirror migrations).
export const connectionStatus = z.enum(['pending', 'accepted', 'declined']);
export type ConnectionStatus = z.infer<typeof connectionStatus>;

// Raw-row models (snake_case): parsed off select('*') / realtime payload.new.
export const connectionRequestSchema = z.object({
  id: z.string().uuid(),
  requester_id: z.string().uuid(),
  addressee_id: z.string().uuid(),
  status: connectionStatus,
  responded_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type ConnectionRequest = z.infer<typeof connectionRequestSchema>;

export const connectionSchema = z.object({
  id: z.string().uuid(),
  profile_a: z.string().uuid(),
  profile_b: z.string().uuid(),
  source_request_id: z.string().uuid().nullable(),
  created_at: z.string(),
});
export type Connection = z.infer<typeof connectionSchema>;

// Incoming-request inbox read model (camelCase): the row resolved to the requester (peer).
export const connectionRequestListItem = z.object({
  id: z.string().uuid(), // the request id — feeds respond_to_connection
  peerId: z.string().uuid(), // the requester
  peerHandle: z.string().nullable(),
  createdAt: z.string(),
});
export type ConnectionRequestListItem = z.infer<typeof connectionRequestListItem>;

// Established-connections read model (camelCase): resolved to the other participant.
export const connectionListItem = z.object({
  id: z.string().uuid(), // the connection id
  peerId: z.string().uuid(),
  peerHandle: z.string().nullable(),
  createdAt: z.string(),
});
export type ConnectionListItem = z.infer<typeof connectionListItem>;

// Derived button state for a given peer (no DB row): drives <ConnectButton>.
export const connectionState = z.enum(['none', 'pending-out', 'pending-in', 'connected']);
export type ConnectionState = z.infer<typeof connectionState>;
