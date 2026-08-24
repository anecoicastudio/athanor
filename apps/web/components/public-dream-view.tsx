import Link from 'next/link';
import type { Locale } from '@athanor/i18n';
import { t } from '@athanor/i18n';
import type { PublicDream } from '@athanor/schemas';

const STATE_KEY = {
  open: 'milestone.state.open',
  in_progress: 'milestone.state.inProgress',
  done: 'milestone.state.done',
} as const;

/**
 * Public `/dream/{id}` page (issue #159). Rendered from public-dream-client.tsx, so this and
 * its t() calls ship to the browser — that is what lets an on-demand IT render follow the
 * locale toggle.
 *
 * The inversion against `public-profile-view.tsx` is the whole point of the page existing:
 * there the member is the subject and the dream is a section; here the dream is the subject
 * and the member is a byline. So the quote leads, at display scale, and the byline sits under
 * it as a link back to `/@handle` — the page a visitor wants next.
 *
 * Dream register = Hanken italic (DESIGN.md §typography, `font-dream`), never a second font
 * family. No glow: DESIGN.md reserves the cyan glow for moment-grade events, and a dream
 * sitting on a public page is a statement, not something that just happened — cyan appears
 * flat, on the label, the handle and the CTA border.
 *
 * No vanity metrics (rule #3): nothing here counts helps, views or reactions. All copy via
 * @athanor/i18n (rule #5); tokens via Tailwind classes mapped from globals.css @theme
 * (rule #4).
 */
export function PublicDreamView({ dream, locale }: { dream: PublicDream; locale: Locale }) {
  const author = dream.author;
  // DESIGN.md §component table: circle, photo when set, initial otherwise — from the name
  // when set, the handle when not.
  const initial = author
    ? (author.displayName ?? author.handle).trim().charAt(0).toUpperCase()
    : '';
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-8 bg-background px-6 py-16 text-foreground">
      <section className="flex flex-col gap-6">
        <span className="text-xs uppercase tracking-widest text-aura">
          {author
            ? t('publicDream.titleWithAuthor', locale, { handle: author.handle })
            : t('publicDream.title', locale)}
        </span>
        {/* The quote is the page's h1: it is the thing being published, and a crawler reading
            the outline should see the dream, not a label above it. */}
        <h1 className="font-dream text-3xl font-light italic leading-snug text-foreground">
          «{dream.text}»
        </h1>

        {author ? (
          <Link
            href={`/@${author.handle}`}
            className="flex items-center gap-3 text-sm"
            aria-label={t('publicDream.authorLink', locale)}
          >
            {author.avatarUrl ? (
              /* Plain <img>, deliberately: the src is a short-lived SIGNED url against the
                 private avatars bucket, so the next/image optimizer would cache-miss on every
                 re-sign and add a Worker round-trip for nothing. */
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={author.avatarUrl}
                alt={author.displayName ?? `@${author.handle}`}
                width={40}
                height={40}
                className="h-10 w-10 rounded-full border border-hair object-cover"
              />
            ) : (
              <span
                aria-hidden
                className="flex h-10 w-10 items-center justify-center rounded-full border border-hair text-lg font-light text-aura"
              >
                {initial}
              </span>
            )}
            <span className="flex flex-col">
              {author.displayName ? (
                <span className="text-foreground">{author.displayName}</span>
              ) : null}
              <span className="tracking-widest text-aura">@{author.handle}</span>
            </span>
          </Link>
        ) : null}
      </section>

      {dream.milestones.length > 0 ? (
        <section className="flex flex-col gap-3">
          <span className="text-xs tracking-widest text-muted-foreground">
            {/* Shared with the @handle page rather than a second key saying the same thing. */}
            {t('publicProfile.milestonesLabel', locale)}
          </span>
          <ul className="flex flex-col gap-2">
            {dream.milestones.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">{m.body}</span>
                <span
                  className={`text-sm ${m.status === 'done' ? 'text-aura' : 'text-muted-foreground'}`}
                >
                  {t(STATE_KEY[m.status], locale)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer className="mt-4">
        <Link
          href="/"
          className="inline-flex rounded-full border border-ring px-5 py-2 text-sm text-aura"
        >
          {t('publicProfile.cta', locale)}
        </Link>
      </footer>
    </main>
  );
}
