import { useEffect, useRef, useState } from 'react';
import { Image } from 'react-native';
import { KeyboardAvoiding } from '@/components/KeyboardAvoiding';
import * as Haptics from 'expo-haptics';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { postKeys, postMediaKeys, publishPost } from '@athanor/api';
import { MEDIA_LIMITS, derivePostType } from '@athanor/core';
import { type MessageKey, t } from '@athanor/i18n';
import type { PostCategory, PostMediaPublish } from '@athanor/schemas';
import { Pressable, ScrollView, Text, View } from '@/tw';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Field } from '@/components/Field';
import { MediaSheet } from '@/components/media/MediaSheet';
import { ModalHeader } from '@/components/ModalHeader';
import { SectionLabel } from '@/components/SectionLabel';
import { useLocale } from '@/hooks/use-locale';
import { useAuth } from '@/lib/auth-context';
import { devWarn } from '@/lib/log';
import { formatDuration } from '@/lib/media/format';
import { type PickedMedia } from '@/lib/media/pick';
import { extractVideoPoster } from '@/lib/media/poster';
import { withTimeout } from '@/lib/media/with-timeout';
import {
  newMediaId,
  postMediaPath,
  postMediaThumbPath,
  processAndUpload,
  uploadErrorKey,
  uploadLocalFile,
} from '@/lib/media/upload';
import { useGuardedBack } from '@/lib/modal-exit';
import { supabase } from '@/lib/supabase';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/ToastHost';

const CATEGORIES: PostCategory[] = ['business', 'human', 'creative', 'evolution'];

export default function PostComposeScreen() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const locale = useLocale();
  const [body, setBody] = useState('');
  const [category, setCategory] = useState<PostCategory>('human');
  const [isStep, setIsStep] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authorId = session?.user.id;
  const [items, setItems] = useState<PickedMedia[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const { showToast } = useToast();

  /**
   * One post id per composed draft, minted before anything is written and reused by every
   * retry (#579). It is what makes a re-tap safe: the row carries it as its PK, so a second
   * attempt after a lost response lands on the row the first one wrote — where an id left to
   * `gen_random_uuid()` mints a second post the member never asked for. It is also what lets
   * the upload run first (below), since the media keys derive from the post id and no longer
   * have to wait for the row to exist.
   *
   * The idiom is `postCommentInsertSchema`'s, from #101 — same problem one table over, though
   * not the same answer: a repeated comment conflicts and is dropped, where a repeated publish
   * converges on the draft as it now stands (see `publishPost`). A ref rather than state —
   * nothing renders from it, and a re-render between the tap and the response must not mint a
   * new one.
   */
  const draftPostId = useRef<string | null>(null);

  /**
   * Which half of the publish was in flight when it threw. `uploadErrorKey` classifies the
   * three typed transport errors and falls back to `media.failed` — «Caricamento non
   * riuscito» — for everything else, which is the wrong sentence for a TEXT-ONLY post whose
   * write was refused: there was no upload to have failed. The order below makes the phase
   * unambiguous, so record it rather than infer it from an error that cannot say. Two phases
   * and not three, still: the post and its media are ONE write now (#588), so nothing can fail
   * between them.
   */
  const phase = useRef<'upload' | 'write'>('upload');

  /**
   * The exit. Hand-rolled as an unconditional `dismissTo('/(tabs)')` when #577 fixed this one
   * screen; #578 moved the mechanism into `useGuardedBack`, which pops the stack when there is
   * one (the in-app caller pushes from the community tab) and lands on the tabs when this
   * screen IS the stack — a deep-linked load, because the auth gate only ever `replace`s.
   */
  const leave = useGuardedBack();

  /**
   * TanStack v5 awaits the hook-level `onSuccess` and `onError` even after this component
   * unmounts, so without this ref a publish finishing late would navigate the member off
   * whatever screen they reached in the meantime.
   *
   * It gates the two things that are meaningless off-screen — the navigation and the inline
   * `setError` — and NOT the toast, which is the point: the host is global, so an outcome that
   * arrives after an early exit still reaches the member instead of being swallowed (#579).
   */
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!authorId) throw new Error('no session');
      phase.current = 'upload';
      const postId = (draftPostId.current ??= newMediaId());
      const type = derivePostType(items.map((i) => i.kind));

      /*
        Upload FIRST, insert LAST — `use-moment-upload`'s order (#579).

        This used to write the post row before the bytes, so an upload that failed left a row
        claiming media with no `post_media` behind it. Nothing reaps those, and the member is
        never told: `PostMedia` returns null on zero rows, so the post publishes as a silently
        text-only card with the photos simply absent.

        In this order a failure before the insert leaves no row at all. It does not leave
        NOTHING: the bytes already uploaded stay in the bucket, and a member who abandons the
        draft rather than retrying leaves them with no row pointing at them — the same trade
        `use-moment-upload` already makes, and a storage cost rather than a visible defect.
        They are no longer permanent: the nightly `post-media-reaper` (#589) frees every object
        in the bucket that no `post_media` row references, so nothing has to be cleaned up from
        here on an error path the member has already walked away from. Erasure reaches them
        either way, because `gdpr_storage_footprint` sweeps `post-media` by `{uid}/` prefix and
        these keys start with the uid.
      */
      const rows: PostMediaPublish[] =
        items.length > 0
          ? await Promise.all(
              items.map(async (item, index) => {
                const path = postMediaPath(authorId, postId, index, item.kind);
                const up = await processAndUpload(item, { bucket: 'post-media', path });
                return {
                  kind: item.kind,
                  storage_path: up.storage_path,
                  thumb_path:
                    item.kind === 'video'
                      ? await uploadPoster(authorId, postId, index, up.localUri, up.duration_s)
                      : null,
                  position: index,
                  width: up.width ?? null,
                  height: up.height ?? null,
                  duration_s: up.duration_s ?? null,
                } satisfies PostMediaPublish;
              }),
            )
          : [];

      phase.current = 'write';
      /*
        ONE write, and that is #588 rather than a tidier call site. This used to be `createPost`
        and then `replacePostMedia`: two requests, with the post row COMMITTED between them, so
        a media write that failed for any reason left a post whose `type` claimed media with no
        rows behind it — which `PostMedia` renders as a silently text-only card. The reorder
        above (upload first) removed the upload half of that; nothing here could remove the
        write half, because PostgREST has no client-side transaction. `publishPost` calls the
        `publish_post` RPC, so the post row and its media set land together or not at all.

        Both writes still converge under retry BECAUSE the id is ours, and both converge on the
        draft as it stands RIGHT NOW rather than as the failed attempt left it. That is the
        whole property: a member who fixes something and re-taps must get what they are looking
        at. The post upserts on the PK; the media set upserts on (post_id, position) and then
        loses every position the new set does not fill — including all of them, when the member
        removed every attachment (#586). `rows` is therefore passed UNCONDITIONALLY: the
        `if (rows.length > 0)` guard this used to carry could not see an empty set, so a cleared
        attachment list left the first attempt's rows in place under a post that no longer
        claims them.

        What that replaced was a swallowed 23505 — `post_media_post_position` answering a
        repeat, read as the database confirming the first attempt landed. It converged wrongly
        whenever the ATTACHMENTS had been edited in between. `postMediaPath` keys by POSITION
        and by the kind's extension, so the retry's uploads overwrite the bytes at every shared
        position holding the SAME kind (`0.jpg` over `0.jpg`) while the insert — one batch
        statement — aborted whole on the first collision, so NONE of the retry's rows landed.
        A position whose kind had changed wrote a new key beside the old one; a longer new set
        uploaded bytes no row ever pointed at. What rendered was the first attempt's rows over
        the second attempt's files.

        Neither `author_id` nor a row's `post_id` is on the wire any more: the RPC derives the
        author from `auth.uid()` and assigns the parent itself. The uid is still needed HERE,
        because the storage keys are `{uid}/{postId}/…`.
      */
      await publishPost(
        supabase,
        { id: postId, category, type, body, is_step: isStep, tags: [] },
        rows,
      );
    },
    onSuccess: async () => {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await queryClient.invalidateQueries({ queryKey: postKeys.all });
      /*
        `postMediaKeys.forPost` is a DISJOINT key from `postKeys.all` (`['post-media', id]` vs
        `['posts']`), so the line above does not reach it. It changes nothing today — `PostMedia`
        only mounts once the feed refetch surfaces the post, which is after this — but the write
        that just ran can now REPLACE a set rather than only create one, and a cached set for a
        post whose bytes have already been overwritten at the shared positions is the exact
        row-describes-one-file-key-holds-another state #586 closed. Invalidate what was written.
      */
      const postId = draftPostId.current;
      if (postId) {
        await queryClient.invalidateQueries({ queryKey: postMediaKeys.forPost(postId) });
      }
      /*
        A haptic is not feedback (#579): it is silent on web, and on a device it is one buzz
        among the several a publish already makes. The toast is what says the post exists.

        Deliberately NOT behind the `mounted` guard below. The host is global and a toast fired
        just before an exit survives onto the screen underneath (ToastHost's own recipe), so
        this is also the only surface a publish that settles AFTER an early exit has — the
        member is told on whatever screen they reached. `'success'` and not `'moment'`: rule 4
        reserves the ✦ and the glow for something that happened TO the member, and publishing
        your own step is not that.
      */
      showToast(t('post.toast.published', locale), 'success');
      if (mounted.current) leave();
    },
    onError: (err) => {
      const key = phase.current === 'write' ? 'post.compose.publishError' : uploadErrorKey(err);
      /*
        The inline sentence is the better surface while the member is here — it sits under the
        field they would fix. It is the WRONG one once they have left: `setError` on an
        unmounted screen is a no-op, so a late failure used to be announced nowhere at all and
        the post simply never appeared (#579). Fall through to the global host in that case.
      */
      if (mounted.current) setError(t(key, locale));
      else showToast(t(key, locale));
    },
  });

  const onPublish = () => {
    if (body.trim().length === 0) {
      setError(t('post.compose.error', locale));
      return;
    }
    setError(null);
    mutation.mutate();
  };

  const onPickMedia = (m: PickedMedia) => {
    setItems((prev) => (prev.length < MEDIA_LIMITS.MAX_POST_MEDIA ? [...prev, m] : prev));
  };

  const removeItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <KeyboardAvoiding>
      <Screen>
        {/*
          Never gated on `isPending`, unlike attach and publish below: the way out stays live
          while the screen works (MediaSheet's «Annulla» rule). The publish keeps running after
          an early exit — the `mounted` ref above only stops it from navigating the member a
          second time when it settles, and the toast tells them how it ended wherever they are.

          The explicit `onBack={leave}` this used to pass is gone with the reason for it: it
          existed because the default chevron hid itself on a stack root, and #578 made the
          affordance unconditional and routed the default through `useGuardedBack` — the exact
          same call `leave` is. Passing it was saying the default twice.
        */}
        <ModalHeader title={t('create.post.title', locale)} backLabel={t('common.back', locale)} />
        <ScrollView className="flex-1" contentContainerClassName="gap-5 px-5 pb-8">
          <Text className="text-[14px] text-faint">{t('create.post.desc', locale)}</Text>

          <Field
            size="lg"
            multiline
            placeholder={t('post.compose.placeholder', locale)}
            value={body}
            onChangeText={setBody}
          />
          {error ? <Text className="text-[13px] text-error">{error}</Text> : null}

          {/* Attach affordance — flat, no glow (rule #4) */}
          <Pressable
            className="flex-row items-center gap-2 rounded-ctl border border-hair bg-raise px-4 py-3"
            onPress={() => setSheetOpen(true)}
            disabled={mutation.isPending || items.length >= MEDIA_LIMITS.MAX_POST_MEDIA}
            accessibilityRole="button"
          >
            <Text
              className={`text-[14px] ${items.length >= MEDIA_LIMITS.MAX_POST_MEDIA ? 'text-faint' : 'text-foreground'}`}
            >
              {t('post.compose.attach', locale)}
            </Text>
          </Pressable>

          {/* Preview tiles */}
          {items.length > 0 ? (
            <View className="flex-row flex-wrap gap-2">
              {items.map((item, index) => (
                <View key={index} className="relative h-20 w-20">
                  {item.kind === 'audio' ? (
                    // Same defect class as the video tile below (#318): an <Image> handed a
                    // media URI with no frame to draw renders NOTHING — no error, no
                    // placeholder, a blank box. Audio has no frame by definition, so it never
                    // gets one and needs its own surface. The duration is the only thing there
                    // is to show, so it is what the tile shows.
                    <View
                      className="h-20 w-20 items-center justify-center rounded-[8px] bg-raise-2"
                      accessible
                      accessibilityLabel={t('media.noPoster.audio', locale)}
                    >
                      <Text
                        className="text-2xl text-faint"
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                      >
                        🎧
                      </Text>
                      <Text
                        className="mt-0.5 text-[11px] text-faint"
                        style={{ fontVariant: ['tabular-nums'] }}
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                      >
                        {formatDuration(item.duration_s ?? null)}
                      </Text>
                    </View>
                  ) : item.kind === 'video' ? (
                    // An <Image> handed a video file URI draws nothing (#318) — this tile was a
                    // blank box with a ▶ badge. Same no-poster state the feed card falls back to:
                    // dark fill, centred faint ▶ (MomentTile pairing — wrapper announces, glyph
                    // is decorative).
                    <View
                      className="h-20 w-20 items-center justify-center rounded-[8px] bg-raise-2"
                      accessible
                      accessibilityLabel={t('media.noPoster.video', locale)}
                    >
                      <Text
                        className="text-2xl text-faint"
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                      >
                        ▶
                      </Text>
                    </View>
                  ) : (
                    <Image
                      source={{ uri: item.uri }}
                      style={{ width: 80, height: 80, borderRadius: 8 }}
                      resizeMode="cover"
                    />
                  )}
                  {/* Uploading dim overlay */}
                  {mutation.isPending ? (
                    <View
                      className="absolute inset-0 items-center justify-center rounded-[8px] bg-surface-muted"
                      style={{ opacity: 0.6 }}
                    />
                  ) : null}
                  {/* Remove button — hidden while uploading */}
                  {!mutation.isPending ? (
                    <Pressable
                      className="absolute right-[-6px] top-[-6px] h-5 w-5 items-center justify-center rounded-full bg-raise"
                      onPress={() => removeItem(index)}
                      accessibilityRole="button"
                      hitSlop={8}
                    >
                      <Text className="text-[11px] text-faint">✕</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}

          {/* Uploading indicator */}
          {mutation.isPending && items.length > 0 ? (
            <Text className="text-[13px] text-faint">
              {t('media.uploadingIndeterminate', locale)}
            </Text>
          ) : null}

          <MediaSheet
            visible={sheetOpen}
            allowVideo
            allowAudio
            locale={locale}
            onPick={onPickMedia}
            onClose={() => setSheetOpen(false)}
            onError={(key) => setError(t(key, locale))}
          />

          <View className="gap-2">
            <SectionLabel>{t('post.compose.catLabel', locale)}</SectionLabel>
            {/* `Chip`, not a hand-rolled pill (#635). These four announced no selected state at
                all — the cyan fill was the only thing saying which category was chosen, and
                colour is not an announcement. `small` is the compact variant and the only one
                that carries DESIGN §10's 44pt floor, which these pills (py-2, ~34pt) missed. */}
            <View className="flex-row flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <Chip
                  key={c}
                  small
                  label={t(`feed.filter.${c}` as MessageKey, locale)}
                  selected={c === category}
                  onPress={() => setCategory(c)}
                />
              ))}
            </View>
          </View>

          {/*
            A `switch`, because that is what it is (#635). It announced as prose — the title and
            the description read as one flat sentence — with no role, no state, and the ✦/○ that
            carries the state visually read aloud as a glyph. Whether a post is a STEP of your
            dream is real product meaning, so a member has to be able to hear it and hear it
            change: `checked` is what says so.

            Title as the label, description as the hint: the hint is the sentence VoiceOver
            defers, which is the right rank for the «why» under the «what».
          */}
          <Pressable
            className="flex-row items-center justify-between rounded-card border border-hair bg-raise p-5"
            accessibilityRole="switch"
            accessibilityState={{ checked: isStep }}
            accessibilityLabel={t('post.compose.stepTitle', locale)}
            accessibilityHint={t('post.compose.stepDesc', locale)}
            onPress={() => setIsStep((v) => !v)}
          >
            <View className="flex-1 pr-4">
              <Text className="text-[15px] text-foreground">
                {t('post.compose.stepTitle', locale)}
              </Text>
              <Text className="text-[13px] text-faint">{t('post.compose.stepDesc', locale)}</Text>
            </View>
            <Text className={isStep ? 'text-aura' : 'text-faint'}>{isStep ? '✦' : '○'}</Text>
          </Pressable>

          {/* P2.5 hint-truth: no create-hint — the engine never rewards posting (anti-gaming). */}
          <Button
            label={t('common.publish', locale)}
            onPress={onPublish}
            disabled={mutation.isPending}
            variant="light"
          />
        </ScrollView>
      </Screen>
    </KeyboardAvoiding>
  );
}

/**
 * Bound the poster step, so a decoder that never settles cannot hold the publish (#462).
 *
 * `extractVideoPoster` has no timeout of its own — neither `replaceAsync` nor
 * `generateThumbnailsAsync` is bounded — and an iCloud-backed `PHAsset` can take a very long
 * time or never settle. It matters more here than anywhere: this is awaited inside a
 * `Promise.all` over every attached item and `MEDIA_LIMITS.MAX_POST_MEDIA` is 10, so one
 * publish could sit behind ten unbounded extractions with the videos already in Storage.
 * `withTimeout` never rejects, so the deadline costs a thumbnail and saves the post.
 *
 * The controller is what makes the deadline mean something to the work rather than only to the
 * wait (#449): `extractVideoPoster` checks the signal between native calls and skips the rest.
 * It buys the steps not yet started, never the one in flight — releasing a `VideoPlayer`
 * mid-`AVAssetImageGenerator` runs its deinit off the main thread, which crashes. One
 * controller per item, not one for the batch: a slow poster on item 3 must not cancel item 7's.
 */
async function uploadPoster(
  uid: string,
  postId: string,
  index: number,
  localUri: string,
  durationS: number | null | undefined,
): Promise<string | null> {
  const posterAbort = new AbortController();
  return withTimeout(
    extractAndUploadPoster(uid, postId, index, localUri, durationS, posterAbort.signal),
    MEDIA_LIMITS.VIDEO_POSTER_TIMEOUT_MS,
    null,
    { onTimeout: () => posterAbort.abort() },
  );
}

/**
 * Extract a poster frame from an uploaded post video and put it beside the mp4, returning the
 * storage path for `thumb_path` — or `null` if any part of that did not work out.
 *
 * Swallowing the failure is the design, exactly as in `use-moment-upload` (#281 rationale): by
 * the time this runs the video is already in Storage and the member is waiting on their post;
 * failing the publish because a decoder would not give up a frame would trade a working post for
 * a missing one. The feed card reads the null and draws its own no-poster state instead.
 *
 * Extraction reads `processAndUpload`'s *processed* `localUri`, not the picked one — see the
 * caution in `upload.ts`: the day `processVideo` transcodes, a poster taken from the picked file
 * would be a frame of a video nobody uploaded.
 *
 * Swallowed is not the same as unnamed, which is what this used to be (#462): a bare `catch {}`
 * threw the reason away entirely, and in Expo Go the dev console is the only telemetry there is
 * — `Sentry.init` is a hard no-op on that runtime (#452), so a failure discarded here was a
 * report nobody could ever file. `devWarn` is `__DEV__`-only, so it ships nothing.
 *
 * The poster shares the video's `{uid}/{postId}/…` folder, so the owner-write post-media storage
 * policies cover it, and `media_process_enqueue` strips it server-side like any other object in
 * the bucket.
 */
async function extractAndUploadPoster(
  uid: string,
  postId: string,
  index: number,
  localUri: string,
  durationS: number | null | undefined,
  extractSignal: AbortSignal,
): Promise<string | null> {
  try {
    const poster = await extractVideoPoster(localUri, durationS, extractSignal);
    if (!poster) return null;
    const path = postMediaThumbPath(uid, postId, index);
    await uploadLocalFile(poster.uri, { bucket: 'post-media', path }, 'image/jpeg');
    return path;
  } catch (err) {
    devWarn('post.poster', err);
    return null;
  }
}
