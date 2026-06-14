/**
 * A personal Momento is now LIVE (M3): the canonical shape is the DB/schema
 * `Moment` (Storage-backed `media_path` + `thumb_path`, signed for render via
 * `useSignedUrls`). The M1 frame-only stub (`type`/`mediaUrl`/`MY_MOMENTS = []`)
 * is gone — consumers read live rows through `getMomentsPage` /
 * `useQuery(momentKeys.list(uid))` and create through `useMomentUpload`.
 *
 * Re-exported here so app code keeps importing `@/types/moment`; the single
 * source of truth is `@athanor/schemas`.
 */
export type { Moment, MomentKind } from '@athanor/schemas';
