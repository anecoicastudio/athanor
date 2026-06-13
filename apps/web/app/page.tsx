import type { ReactNode } from 'react';
import { t } from '@auria/i18n';
import { MandorlaMark } from '@/components/mandorla-mark';
import { KairosStar } from '@/components/icons';
import { StoreBadges } from '@/components/store-badges';

/**
 * Auria landing — a single static one-pager that presents the project and
 * links to download the app. Server-rendered, no data, no auth (the app lives
 * in apps/mobile). Locale fixed IT for now; EN copy exists in @auria/i18n for
 * parity and a future toggle.
 *
 * DESIGN.md guardrails honored here:
 * - one dark world (bg-background); alternating sections use bg-band-alt.
 * - aura cyan ONLY on the Mandorla star (hero) and the "Dai Vita al Tuo Sogno"
 *   accent (a dream lit = a moment that matters, rule 4). Never decorative.
 * - Instrument Serif italic (font-dream) ONLY on the three dream quotes.
 * - large + light display type, generous air, «calma ma potente».
 */
const L = 'it' as const;

function Eyebrow({ children, accent = false }: { children: ReactNode; accent?: boolean }) {
  return (
    <p
      className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${
        accent ? 'text-aura' : 'text-muted-foreground'
      }`}
    >
      {children}
    </p>
  );
}

function Section({
  children,
  alt = false,
  className,
}: {
  children: ReactNode;
  alt?: boolean;
  className?: string;
}) {
  return (
    <section className={`${alt ? 'bg-band-alt' : 'bg-background'} px-6 py-24 md:py-36`}>
      <div className={`mx-auto max-w-5xl ${className ?? ''}`}>{children}</div>
    </section>
  );
}

const PILLARS = [
  ['landing.pillars.community.name', 'landing.pillars.community.desc'],
  ['landing.pillars.live.name', 'landing.pillars.live.desc'],
  ['landing.pillars.momenti.name', 'landing.pillars.momenti.desc'],
  ['landing.pillars.costellazioni.name', 'landing.pillars.costellazioni.desc'],
  ['landing.pillars.marketplace.name', 'landing.pillars.marketplace.desc'],
  ['landing.pillars.circle.name', 'landing.pillars.circle.desc'],
] as const;

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      {/* 1 · HERO */}
      <section className="flex min-h-[88vh] flex-col items-center justify-center gap-10 px-6 py-24 text-center">
        <MandorlaMark />
        <h1 className="max-w-2xl text-4xl font-normal leading-tight tracking-tight md:text-6xl">
          {t('app.tagline', L)}
        </h1>
        <p className="max-w-md text-base text-muted-foreground md:text-lg">
          {t('landing.hero.subhead', L)}
        </p>
        <StoreBadges className="mt-2" />
      </section>

      {/* 2 · MANIFESTO */}
      <Section alt>
        <Eyebrow>{t('landing.manifesto.eyebrow', L)}</Eyebrow>
        <h2 className="mt-6 max-w-3xl text-3xl font-normal leading-snug tracking-tight md:text-4xl">
          {t('landing.manifesto.title', L)}
        </h2>
        <p className="mt-8 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          {t('landing.manifesto.body', L)}
        </p>
      </Section>

      {/* 3 · SIX PILLARS */}
      <Section>
        <Eyebrow>{t('landing.pillars.eyebrow', L)}</Eyebrow>
        <h2 className="mt-6 text-3xl font-normal tracking-tight md:text-4xl">
          {t('landing.pillars.title', L)}
        </h2>
        <ul className="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {PILLARS.map(([name, desc]) => (
            <li key={name} className="border-t border-border pt-5">
              <h3 className="text-lg font-semibold">{t(name, L)}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(desc, L)}</p>
            </li>
          ))}
        </ul>
      </Section>

      {/* 4 · AURA */}
      <Section alt className="max-w-3xl text-center">
        <Eyebrow>{t('landing.aura.eyebrow', L)}</Eyebrow>
        <p className="mt-6 font-dream text-3xl italic leading-snug md:text-4xl">
          «{t('landing.aura.quote', L)}»
        </p>
        <p className="mx-auto mt-8 max-w-xl text-lg leading-relaxed text-muted-foreground">
          {t('landing.aura.body', L)}
        </p>
      </Section>

      {/* 5 · IL SOGNO */}
      <Section className="max-w-3xl text-center">
        <Eyebrow>{t('landing.sogno.eyebrow', L)}</Eyebrow>
        <p className="mt-6 font-dream text-3xl italic leading-snug md:text-4xl">
          «{t('landing.sogno.quote', L)}»
        </p>
        <p className="mx-auto mt-8 max-w-xl text-lg leading-relaxed text-muted-foreground">
          {t('landing.sogno.body', L)}
        </p>
      </Section>

      {/* 6 · DAI VITA AL TUO SOGNO — the dream-lit moment (sanctioned aura accent) */}
      <Section alt className="max-w-3xl text-center">
        <span className="inline-flex justify-center text-aura">
          <KairosStar filled size={22} />
        </span>
        <div className="mt-5">
          <Eyebrow accent>{t('landing.daivita.eyebrow', L)}</Eyebrow>
        </div>
        <p className="mt-6 font-dream text-3xl italic leading-snug md:text-4xl">
          «{t('landing.daivita.quote', L)}»
        </p>
        <p className="mx-auto mt-8 max-w-xl text-lg leading-relaxed text-muted-foreground">
          {t('landing.daivita.body', L)}
        </p>
      </Section>

      {/* 7 · FOOTER */}
      <footer className="flex flex-col items-center gap-10 border-t border-border bg-background px-6 py-20 text-center">
        <div>
          <h2 className="text-2xl font-normal tracking-tight">{t('landing.download.title', L)}</h2>
          <StoreBadges className="mt-8" />
        </div>
        <ul className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-sm text-muted-foreground">
          <li>{t('landing.footer.point1', L)}</li>
          <li aria-hidden>·</li>
          <li>{t('landing.footer.point2', L)}</li>
          <li aria-hidden>·</li>
          <li>{t('landing.footer.point3', L)}</li>
        </ul>
        <span className="text-sm font-normal tracking-[0.4em] text-foreground">
          {t('app.name', L).toUpperCase()}
        </span>
      </footer>
    </main>
  );
}
