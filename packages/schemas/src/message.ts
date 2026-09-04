import { z } from 'zod';
import { trimmedNonBlank } from './primitives.ts';

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

// The storage key of a chat image: {sender_uid}/{conversation_id}/{media_id}.jpg — the exact
// layout the chat-media storage policies and messages_insert_own_user key on (#155). Always
// .jpg: processImage re-encodes every picked image for the client-side EXIF strip, so no other
// extension survives to reach this. Lowercase segments — Crypto.randomUUID and auth uids both
// emit lowercase, and the DB policy compares byte-for-byte.
//
// Exported for `chat-media-key.mirror.test.ts`, which asserts `.source` is the identical string
// the SQL policies spell (#575). Until that migration the database pinned only the two-segment
// prefix, so this regex refused keys the DB would have accepted — the drift the mirror now
// closes. Keep the `\\.` escape and the lowercase-only class: POSIX `~` is case-sensitive and
// `standard_conforming_strings` is on, which is what makes the two strings comparable at all.
const UUID_SEG = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const chatMediaKey = new RegExp(`^${UUID_SEG}/${UUID_SEG}/${UUID_SEG}\\.jpg$`);

// Client insert: only kind='user'. The api sets sender_id = auth uid; RLS re-checks it.
// A message is a body, an image, or both — never neither (messages_user_shape v3, #155).
// Blank-but-present body is refused rather than coerced to "omitted": the caller decides what
// an empty composer means, this boundary only refuses to smuggle whitespace into the thread.
export const messageInsertSchema = z
  .object({
    conversation_id: z.string().uuid(),
    sender_id: z.string().uuid(),
    body: trimmedNonBlank(4000).optional(),
    media_url: z.string().regex(chatMediaKey).optional(),
  })
  .refine((m) => m.body !== undefined || m.media_url !== undefined, {
    message: 'a message needs a body or an image',
    path: ['body'],
  })
  // Mirrors the DB policy's prefix pin — the half the regex above cannot express, because it
  // binds the key to THIS sender and THIS conversation rather than to a shape. A key under
  // another member's folder or another conversation would only earn a 42501, so refuse it
  // before it travels. (The shape half is `.regex(chatMediaKey)`; since #575 the policy pins
  // both, so neither refine is ahead of the database any more.)
  .refine(
    (m) =>
      m.media_url === undefined || m.media_url.startsWith(`${m.sender_id}/${m.conversation_id}/`),
    { message: 'media_url must live in the sender/conversation folder', path: ['media_url'] },
  );
export type MessageInsert = z.infer<typeof messageInsertSchema>;
