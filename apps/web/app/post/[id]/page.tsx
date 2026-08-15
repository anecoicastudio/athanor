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
 * So the shell is identical for every id: the component never reads `params`,
 * fetches nothing, and the metadata deliberately carries nothing post-specific
 * — the generic site OG card is correct here, not a fallback.
 *
 * `force-static` + `revalidate = false` like the OG-image route (#157 lane):
 * no concrete `/post/*` path exists at build time (no generateStaticParams —
 * ids are arbitrary UUIDs), so a first visit to a given id renders this shell
 * in the Worker and caches it in KV permanently; later visits serve bytes. The
 * render is a bare template with no data access, so the one-per-id cache fill
 * is the whole runtime cost.
 *
 * noindex like /invite/{code}: every id serves identical copy, so indexing
 * would be duplicate-content noise — while link unfurls in messengers still
 * resolve the inherited site-wide card.
 */
export const dynamic = 'force-static';
export const revalidate = false;

export const metadata: Metadata = {
  title: `${t('post.landing.title', DEFAULT_LOCALE)} — ${t('app.name', DEFAULT_LOCALE)}`,
  description: t('post.landing.body', DEFAULT_LOCALE),
  robots: { index: false, follow: false },
};

export default function PostPage() {
  return <PostInviteView />;
}
