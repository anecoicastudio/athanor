import { z } from 'zod';

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
