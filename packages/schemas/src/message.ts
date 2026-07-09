import { z } from 'zod';
import { trimmedNonBlank } from './primitives';

export const messageKind = z.enum(['user', 'system', 'prompt']);
export type MessageKind = z.infer<typeof messageKind>;

// Raw-row model (snake_case): parsed directly off select('*') and realtime payload.new.
export const messageSchema = z.object({
  id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  sender_id: z.string().uuid().nullable(),
  kind: messageKind,
  prompt_key: z.string().nullable(),
  body: z.string().nullable(),
  media_url: z.string().nullable(),
  created_at: z.string(),
  deleted_at: z.string().nullable(),
});
export type Message = z.infer<typeof messageSchema>;

// Client insert: only kind='user'. The api sets sender_id = auth uid; RLS re-checks it.
export const messageInsertSchema = z.object({
  conversation_id: z.string().uuid(),
  sender_id: z.string().uuid(),
  body: trimmedNonBlank(4000),
});
export type MessageInsert = z.infer<typeof messageInsertSchema>;
