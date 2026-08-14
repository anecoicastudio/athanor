import Link from 'next/link';
import type { Locale } from '@athanor/i18n';
import { t } from '@athanor/i18n';
import type { PublicProfile } from '@athanor/schemas';

const STATE_KEY = {
  open: 'milestone.state.open',
  in_progress: 'milestone.state.inProgress',
  done: 'milestone.state.done',
} as const;

/**
 * Public @handle profile card. Dark world, no glow. Rendered from
 * public-profile-client.tsx, so this and its t() calls ship to the browser —
 * that is what lets a prerendered IT page follow the locale toggle.
 * Renders the #251 shell (avatar-or-initial, name, handle) + bio (if public) +
 * dream quote (if public) + tappe. A shell-only profile is a first-class page:
 * face, name, CTA — every other section simply absent, never empty.
 * No vanity metrics (rule #3). All copy via @athanor/i18n (rule #5).
 * Tokens via Tailwind classes mapped from globals.css @theme (rule #4).
 */
export function PublicProfileView({ profile, locale }: { profile: PublicProfile; locale: Locale }) {
  // DESIGN.md §component table: circle, photo when set, initial otherwise — from the
  // name when set, the handle when not.
  const initial = (profile.displayName ?? profile.handle).trim().charAt(0).toUpperCase();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-8 bg-background px-6 py-16 text-foreground">
      <header className="flex flex-col gap-3">
        {profile.avatarUrl ? (
          /* Plain <img>, deliberately: the src is a short-lived SIGNED url against the
             private avatars bucket, so the next/image optimizer would cache-miss on every
             re-sign and add a Worker round-trip for nothing. */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profile.avatarUrl}
            alt={profile.displayName ?? `@${profile.handle}`}
            width={80}
            height={80}
            className="h-20 w-20 rounded-full border border-hair object-cover"
          />
        ) : (
          <div
            aria-hidden
            className="flex h-20 w-20 items-center justify-center rounded-full border border-hair text-3xl font-light text-aura"
          >
            {initial}
          </div>
        )}
        <div className="flex flex-col gap-1">
          {profile.displayName ? (
            <h1 className="text-2xl font-semibold leading-tight">{profile.displayName}</h1>
          ) : null}
          <span className="text-sm tracking-widest text-aura">@{profile.handle}</span>
        </div>
        {profile.bio ? (
          <p className="text-lg leading-relaxed text-muted-foreground">{profile.bio}</p>
        ) : null}
      </header>

      {profile.dream ? (
        <section className="flex flex-col gap-4">
          <span className="text-xs uppercase tracking-widest text-aura">
            {t('dream.theirLabel', locale)}
          </span>
          <blockquote className="font-dream text-2xl font-light italic leading-snug text-foreground">
            «{profile.dream.text}»
          </blockquote>

          {profile.dream.milestones.length > 0 ? (
            <div className="mt-2 flex flex-col gap-3">
              <span className="text-xs tracking-widest text-muted-foreground">
                {t('publicProfile.milestonesLabel', locale)}
              </span>
              <ul className="flex flex-col gap-2">
                {profile.dream.milestones.map((m) => (
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
            </div>
          ) : null}
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
