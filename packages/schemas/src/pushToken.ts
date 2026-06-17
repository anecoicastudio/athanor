import { z } from 'zod';

export const pushPlatformSchema = z.enum(['ios', 'android']);

export const pushTokenSchema = z.object({
  id: z.string().uuid(),
  profileId: z.string().uuid(),
  token: z.string().min(1).max(512),
  platform: pushPlatformSchema,
  deviceId: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// derive — never duplicate the shape (schemas rule)
export const pushTokenInsertSchema = pushTokenSchema.pick({
  profileId: true,
  token: true,
  platform: true,
  deviceId: true,
});

/** Push `data` deep-link payload (09 §3/§6.1). Handling wiring lands at M10; the shape is fixed here. */
export const pushData = z.object({
  type: z.enum([
    'moment',
    'dreamMilestone',
    'review',
    'eventReminder',
    'fundMilestone',
    'projectResponse',
    'connection',
  ]),
  route: z.string(),
  entity_ref: z.string(),
});

export type PushToken = z.infer<typeof pushTokenSchema>;
export type PushTokenInsert = z.infer<typeof pushTokenInsertSchema>;
export type PushData = z.infer<typeof pushData>;
