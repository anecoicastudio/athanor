import { z } from 'zod';

/** `min_app_version` value — per-platform minimum supported semver (force-update gate). Backend 00 §7a. */
export const minAppVersionSchema = z.object({
  ios: z.string(),
  android: z.string(),
});
export type MinAppVersion = z.infer<typeof minAppVersionSchema>;

/** `maintenance_mode` value — the maintenance kill-switch + an optional ETA window. */
export const maintenanceModeSchema = z.object({
  enabled: z.boolean(),
  eta: z.string().nullish(),
});
export type MaintenanceMode = z.infer<typeof maintenanceModeSchema>;

/** Feature-flag value — every flag key shares `{ enabled, ... }`; extra fields are preserved. */
export const featureFlagSchema = z.object({ enabled: z.boolean() }).passthrough();
export type FeatureFlag = z.infer<typeof featureFlagSchema>;

/** A raw `remote_config` row. `value` is opaque jsonb here — callers narrow it per key. */
export const remoteConfigRowSchema = z.object({
  key: z.string(),
  value: z.unknown(),
  updated_at: z.string(),
});
export type RemoteConfigRow = z.infer<typeof remoteConfigRowSchema>;
