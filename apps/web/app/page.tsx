import type { ReactNode } from 'react';
import { t } from '@auria/i18n';
import { MandorlaMark } from '@/components/mandorla-mark';
import { KairosStar } from '@/components/icons';
import { PILLAR_GLYPHS, Ripples } from '@/components/icons/glyphs';
import { StoreBadges } from '@/components/store-badges';
import { Marquee } from '@/components/marquee';
import { SectionLabel } from '@/components/section-label';

/**
 * Auria landing — a single static one-pager presenting the project and linking
 * to the app. Editorial layout (marinkurir-inspired) on Auria's dark,
 * sacred-geometry brand: pill nav, oversized type, indexed chapter labels,
 * full-width pillar rows, slow brand-ribbon marquees, giant footer wordmark.
 *
 * DESIGN.md: one dark world; aura cyan ONLY on the hero mandorla star + the
 * Dai-Vita star (a dream lit); Instrument Serif italic (font-dream) ONLY on the
 * four pull-quotes; mandala gradient = logo/hero only; «calma ma potente».
 * Locale fixed IT; EN copy kept in @auria/i18n for parity + a future toggle.
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
  index,
  label,
  alt = false,
  center = false,
  children,
}: {
  index: string;
  label: string;
  alt?: boolean;
  center?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`${alt ? 'bg-band-alt' : 'bg-background'} px-6 py-24 md:py-32`}>
      <div className={`relative mx-auto max-w-5xl lg:pl-20 ${center ? 'lg:pl-0' : ''}`}>
        <SectionLabel index={index}>{label}</SectionLabel>
        {children}
      </div>
    </section>
  );
}

const PILLARS = [
  {
    key: 'community',
    name: 'landing.pillars.community.name',
    desc: 'landing.pillars.community.desc',
  },
  { key: 'live', name: 'landing.pillars.live.name', desc: 'landing.pillars.live.desc' },
  { key: 'momenti', name: 'landing.pillars.momenti.name', desc: 'landing.pillars.momenti.desc' },
  {
    key: 'costellazioni',
    name: 'landing.pillars.costellazioni.name',
    desc: 'landing.pillars.costellazioni.desc',
  },
  {
    key: 'marketplace',
    name: 'landing.pillars.marketplace.name',
    desc: 'landing.pillars.marketplace.desc',
  },
  { key: 'circle', name: 'landing.pillars.circle.name', desc: 'landing.pillars.circle.desc' },
] as const;

const STARS = [
  { name: 'star.visionario', desc: 'landing.stars.visionario.desc' },
  { name: 'star.creatore', desc: 'landing.stars.creatore.desc' },
  { name: 'star.mentor', desc: 'landing.stars.mentor.desc' },
  { name: 'star.innovatore', desc: 'landing.stars.innovatore.desc' },
  { name: 'star.collaboratore', desc: 'landing.stars.collaboratore.desc' },
  { name: 'star.ambasciatore', desc: 'landing.stars.ambasciatore.desc' },
] as const;

const PROBLEMS = [
  'landing.problem.follower',
  'landing.problem.scroll',
  'landing.problem.networking',
  'landing.problem.tools',
] as const;

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      {/* NAV */}
      <header className="flex items-center justify-between px-6 py-5">
        <span className="text-sm font-normal tracking-[0.4em]">
          {t('app.name', L).toUpperCase()}
        </span>
        <a
          href="#scarica"
          className="rounded-full border border-border px-5 py-2 text-xs font-semibold tracking-[0.14em] transition-opacity hover:opacity-80"
        >
          {t('nav.download', L)}
        </a>
      </header>

      {/* 1 · HERO — full lockup */}
      <section className="flex min-h-[82vh] flex-col items-center justify-center gap-8 px-6 py-16 text-center">
        <MandorlaMark />
        <span className="text-base font-normal tracking-[0.4em] text-foreground md:text-lg">
          {t('app.name', L).toUpperCase()}
        </span>
        <h1 className="max-w-2xl text-4xl font-normal leading-tight tracking-tight md:text-6xl">
          {t('app.tagline', L)}
        </h1>
        <p className="max-w-md text-base text-muted-foreground md:text-lg">
          {t('landing.hero.subhead', L)}
        </p>
        <StoreBadges className="mt-2" />
      </section>

      <Marquee />

      {/* 2 · IL NOME */}
      <Section index="01" label={t('landing.nome.eyebrow', L)} center>
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex justify-center text-foreground/70">
            <Ripples size={30} />
          </span>
          <p className="mt-6 font-dream text-3xl italic leading-snug md:text-4xl">
            «{t('landing.nome.quote', L)}»
          </p>
          <p className="mx-auto mt-8 max-w-xl text-lg leading-relaxed text-muted-foreground">
            {t('landing.nome.body', L)}
          </p>
        </div>
      </Section>

      {/* 3 · IL PROBLEMA */}
      <Section index="02" label={t('landing.problem.eyebrow', L)} alt>
        <h2 className="max-w-3xl text-3xl font-normal leading-snug tracking-tight md:text-4xl">
          {t('landing.problem.title', L)}
        </h2>
        <ul className="mt-10 border-t border-border">
          {PROBLEMS.map((key) => (
            <li
              key={key}
              className="border-b border-border py-5 text-lg leading-relaxed text-muted-foreground"
            >
              {t(key, L)}
            </li>
          ))}
        </ul>
        <p className="mt-8 max-w-2xl text-lg leading-relaxed text-foreground">
          {t('landing.problem.target', L)}
        </p>
      </Section>

      {/* 4 · MANIFESTO */}
      <Section index="03" label={t('landing.manifesto.eyebrow', L)}>
        <h2 className="max-w-3xl text-3xl font-normal leading-snug tracking-tight md:text-4xl">
          {t('landing.manifesto.title', L)}
        </h2>
        <p className="mt-8 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          {t('landing.manifesto.body', L)}
        </p>
      </Section>

      <Marquee />

      {/* 5 · I PILASTRI — full-width editorial rows */}
      <Section index="04" label={t('landing.pillars.eyebrow', L)} alt>
        <h2 className="text-3xl font-normal tracking-tight md:text-4xl">
          {t('landing.pillars.title', L)}
        </h2>
        <ul className="mt-12 border-t border-border">
          {PILLARS.map((p, i) => {
            const Glyph = PILLAR_GLYPHS[p.key];
            return (
              <li
                key={p.key}
                className="flex items-center gap-5 border-b border-border py-7 md:gap-8"
              >
                <span className="w-7 shrink-0 text-sm tabular-nums text-muted-foreground">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="shrink-0 text-foreground/80">
                  <Glyph size={34} />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-xl font-semibold tracking-tight md:text-2xl">
                    {t(p.name, L)}
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground md:text-base">
                    {t(p.desc, L)}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </Section>

      {/* 6 · AURA */}
      <Section index="05" label={t('landing.aura.eyebrow', L)} center>
        <div className="mx-auto max-w-3xl text-center">
          <p className="font-dream text-3xl italic leading-snug md:text-4xl">
            «{t('landing.aura.quote', L)}»
          </p>
          <p className="mx-auto mt-8 max-w-xl text-lg leading-relaxed text-muted-foreground">
            {t('landing.aura.body', L)}
          </p>
        </div>
      </Section>

      {/* 7 · LE SEI STELLE */}
      <Section index="06" label={t('landing.stars.eyebrow', L)} alt>
        <h2 className="max-w-3xl text-3xl font-normal tracking-tight md:text-4xl">
          {t('landing.stars.title', L)}
        </h2>
        <p className="mt-6 max-w-xl text-base text-muted-foreground">
          {t('profile.stars.hint', L)}
        </p>
        <ul className="mt-10 grid gap-x-10 gap-y-px sm:grid-cols-2">
          {STARS.map((s) => (
            <li key={s.name} className="flex items-center gap-4 border-t border-border py-5">
              <span className="shrink-0 text-foreground/70">
                <KairosStar size={22} />
              </span>
              <div>
                <h3 className="font-semibold">{t(s.name, L)}</h3>
                <p className="text-sm text-muted-foreground">{t(s.desc, L)}</p>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      {/* 8 · IL SOGNO */}
      <Section index="07" label={t('landing.sogno.eyebrow', L)} center>
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex justify-center text-foreground/70">
            <KairosStar size={24} />
          </span>
          <p className="mt-6 font-dream text-3xl italic leading-snug md:text-4xl">
            «{t('landing.sogno.quote', L)}»
          </p>
          <p className="mx-auto mt-8 max-w-xl text-lg leading-relaxed text-muted-foreground">
            {t('landing.sogno.body', L)}
          </p>
        </div>
      </Section>

      {/* 9 · DAI VITA AL TUO SOGNO — the dream-lit moment (sanctioned aura accent) */}
      <Section index="08" label={t('landing.daivita.eyebrow', L)} alt center>
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex justify-center text-aura">
            <KairosStar filled size={24} />
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
        </div>
      </Section>

      <Marquee />

      {/* FOOTER */}
      <footer
        id="scarica"
        className="flex flex-col items-center gap-12 border-t border-border bg-background px-6 py-24 text-center"
      >
        <span className="text-[clamp(3rem,16vw,10rem)] font-light leading-none tracking-[0.08em] text-foreground">
          {t('app.name', L).toUpperCase()}
        </span>
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
      </footer>
    </main>
  );
}
