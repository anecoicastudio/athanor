import Link from 'next/link';
import type { Locale, MessageKey } from '@athanor/i18n';
import { t } from '@athanor/i18n';
import type { PublicEvent } from '@athanor/schemas';
import { WaitlistForm } from '@/components/waitlist-form';
import { eventDateTime, eventPrice } from '@/lib/event-format';

/**
 * Public event page body. Dark world, tokens only, no glow — a listing is not a moment
 * (rule 4). The Kairos / Athanor-Day frame is the one aura-tinted surface here, because
 * that flag is exactly the "something happened" case the glow is reserved for.
 *
 * Rendered from public-event-client.tsx, so this and its t() calls ship to the browser —
 * that is what lets a prerendered IT page follow the locale toggle.
 *
 * No attendee count: `rsvps` grants nothing to anon, so the number is unreadable here —
 * and a public count would be the vanity metric rule 3 forbids either way.
 *
 * `isPast` arrives as a prop rather than being computed here: the server already decided
 * it, and recomputing during hydration would let one page disagree with itself around
 * the end time.
 */
export function PublicEventView({
  event,
  isPast,
  locale,
}: {
  event: PublicEvent;
  isPast: boolean;
  locale: Locale;
}) {
  const chip = event.is_athanor_day
    ? t('live.chip.athanorDay', locale)
    : t(`event.cat.${event.category}` as MessageKey, locale);
  const where = event.is_online
    ? t('event.whereOnline', locale, { kind: t('event.streamKind', locale) })
    : [event.venue, event.city].filter(Boolean).join(' · ');
  const price = eventPrice(event.price_cents, event.currency, locale);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-8 bg-background px-6 py-16 text-foreground">
      <header className="flex flex-col gap-3">
        <span className="self-start rounded-full border border-border px-3 py-1 text-xs tracking-widest text-muted-foreground">
          {chip}
        </span>
        <h1 className="font-display text-4xl leading-tight text-foreground">{event.title}</h1>
      </header>

      <dl className="flex flex-col gap-4 rounded-2xl border border-border bg-card/40 p-6">
        <div className="flex flex-col gap-1">
          <dt className="text-xs uppercase tracking-widest text-muted-foreground">
            {t('event.whenLabel', locale)}
          </dt>
          <dd className="text-base text-foreground">{eventDateTime(event.starts_at, locale)}</dd>
        </div>

        <div className="flex flex-col gap-1">
          <dt className="text-xs uppercase tracking-widest text-muted-foreground">
            {t('event.whereLabel', locale)}
          </dt>
          {/* An event with neither venue nor city falls back to the label itself, which is
              what the app does — better an honest "Dove" than an empty line. */}
          <dd className="text-base text-foreground">{where || t('event.whereLabel', locale)}</dd>
        </div>

        <div className="flex flex-col gap-1">
          <dt className="text-xs uppercase tracking-widest text-muted-foreground">
            {t('event.create.ticket', locale)}
          </dt>
          <dd className="text-base text-foreground">{price ?? t('publicEvent.free', locale)}</dd>
        </div>

        {event.organizer_handle ? (
          <div className="flex flex-col gap-1">
            <dt className="text-xs uppercase tracking-widest text-muted-foreground">
              {t('event.organizedBy', locale)}
            </dt>
            <dd>
              <Link
                href={`/@${event.organizer_handle}`}
                className="text-base text-aura underline-offset-4 hover:underline"
              >
                @{event.organizer_handle}
              </Link>
            </dd>
          </div>
        ) : null}
      </dl>

      {event.is_kairos_day || event.is_athanor_day ? (
        <p className="rounded-2xl border border-aura-line bg-aura-soft p-4 text-sm text-aura">
          {t('event.kairos.banner', locale)}
        </p>
      ) : null}

      {isPast ? (
        <p className="text-sm text-muted-foreground">{t('event.past', locale)}</p>
      ) : (
        <p className="text-base leading-relaxed text-muted-foreground">
          {t('event.descFallback', locale)}
        </p>
      )}

      <section className="flex flex-col gap-3 border-t border-border pt-8">
        <h2 className="font-display text-2xl text-foreground">
          {t('publicEvent.ctaTitle', locale)}
        </h2>
        <p className="text-sm text-muted-foreground">{t('publicEvent.ctaBody', locale)}</p>
        {/* `source` tags where the signup happened — event pages are the one funnel that
            starts from a link someone shared rather than from the landing page. */}
        <WaitlistForm locale={locale} source="event" />
      </section>

      <footer>
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
