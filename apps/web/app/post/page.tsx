import type { Metadata } from 'next';
import { t } from '@athanor/i18n';
import { DEFAULT_LOCALE } from '@/lib/default-locale';
import { PostInviteView } from '@/components/post-invite-view';

/*
 * `/post/{id}` is a committed universal-link path (apple-app-site-association's
 * `paths`; Android via app.json's intentFilters) — members' devices open the
 * app. This page is the non-app half: every other visitor gets the same static
 * invitation, because posts are members-only by ruling (#268, option 1 —
 * `public.posts` grants SELECT to `authenticated` only, and that is the point).
 * The shell is identical for every id, so there is no `[id]` segment at all:
 * next.config.ts rewrites `/post/:id` here, and this one prerendered page is
 * the only KV incremental-cache entry the whole path space ever creates. A
 * dynamic segment — even force-static — would render-and-cache a permanent
 * entry per arbitrary string dropped into the slot.
 *
 * The page fetches nothing and the metadata deliberately carries nothing
 * post-specific — the generic site OG card is correct here, not a fallback.
 * `dynamic = 'error'` is the ratchet: any future edit that reaches for a
 * request-time API turns every `/post/{id}` visit into a per-request render,
 * so make that a build failure instead of a silent cost.
 *
 * noindex like /invite/{code}: every id serves identical copy, so indexing
 * would be duplicate-content noise — while link unfurls in messengers still
 * resolve the inherited site-wide card.
 */
export const dynamic = 'error';

export const metadata: Metadata = {
  title: `${t('post.landing.title', DEFAULT_LOCALE)} — ${t('app.name', DEFAULT_LOCALE)}`,
  description: t('post.landing.body', DEFAULT_LOCALE),
  robots: { index: false, follow: false },
};

export default function PostPage() {
  return <PostInviteView />;
}
