import type { ReactNode } from 'react';
import type { Locale } from '@athanor/i18n';
import Image from 'next/image';
import Link from 'next/link';
import { t } from '@athanor/i18n';
import { MandorlaMark } from '@/components/mandorla-mark';
import { KairosStar } from '@/components/icons';
import { PILLAR_GLYPHS, Ripples } from '@/components/icons/glyphs';
import { WaitlistForm } from '@/components/waitlist-form';
import { LaunchCountdown } from '@/components/launch-countdown';
import { ChapterSpine, type Chapter } from '@/components/chapter-spine';
import { DeviceMockup } from '@/components/device-mockup';
import { AthanorWordmark, BrandText } from '@/components/athanor-wordmark';
import { Reveal } from '@/components/reveal';
import { LangSwitch } from '@/components/lang-switch';

/**
 * Athanor landing — a single static one-pager presenting the project and linking
 * to the app. Minimal/elegant split-screen layout (medusmo.com-inspired, user-
 * directed 2026-06-13): a hero lockup, then the narrative as chapters on ONE dark
 * canvas (no alternating bands) beside a sticky <ChapterSpine> rail, then the
 * footer CTA. Restraint over decoration — type weight + whitespace carry the
 * rhythm; the heavy scroll parallax was retired.
 *
 * DESIGN.md (+ §11 overrides): one dark world (the band striping was a deviation,
 * now removed); aura cyan ONLY on the hero mandorla star + the Dai-Vita star and
 * eyebrow (a dream lit); EB Garamond italic (font-dream) on the pull-quotes, EB
 * Garamond upright (font-display) on headlines; the ATHANOR wordmark + eyebrows are
 * Hanken (font-sans); mandala gradient = logo/hero only. Locale comes from the
 * in-page IT/EN toggle (cookie-persisted, LocaleProvider) and arrives here as a prop
 * from landing-client.tsx — this view has no hook of its own, so app/page.tsx stays a
 * Server Component (#335). Both catalogs live in @athanor/i18n.
 */

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
  id,
  label,
  center = false,
  accent = false,
  children,
}: {
  id: string;
  label: string;
  center?: boolean;
  accent?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className={`scroll-mt-28 py-20 md:py-28 lg:py-36 ${center ? 'text-center' : ''}`}
    >
      <Eyebrow accent={accent}>{label}</Eyebrow>
      <div className="mt-8">{children}</div>
    </section>
  );
}

/** Narrative chapters — ids anchor the sections; labels reuse the eyebrow keys. */
const CHAPTERS: Chapter[] = [
  { id: 'nome', label: 'landing.nome.eyebrow' },
  { id: 'problema', label: 'landing.problem.eyebrow' },
  { id: 'manifesto', label: 'landing.manifesto.eyebrow' },
  { id: 'pilastri', label: 'landing.pillars.eyebrow' },
  { id: 'aura', label: 'landing.aura.eyebrow' },
  { id: 'stelle', label: 'landing.stars.eyebrow' },
  { id: 'sogno', label: 'landing.sogno.eyebrow' },
  { id: 'daivita', label: 'landing.daivita.eyebrow' },
];

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
  'landing.problem.growth',
] as const;

export function LandingView({ locale: L }: { locale: Locale }) {
  return (
    <main id="main" className="flex min-h-screen flex-col bg-background text-foreground">
      {/* NAV */}
      <header className="fixed inset-x-0 top-0 z-40 flex items-center justify-between border-b border-border/50 bg-background/65 px-6 py-5 backdrop-blur-md">
        <AthanorWordmark className="text-sm" />
        <div className="flex items-center gap-5">
          <LangSwitch />
          <a
            href="#scarica"
            className="rounded-full border border-border px-5 py-2 text-xs font-semibold tracking-[0.14em] transition-opacity hover:opacity-80"
          >
            {t('nav.download', L)}
          </a>
        </div>
      </header>

      {/* HERO — full lockup */}
      <section className="flex min-h-screen flex-col items-center justify-center gap-8 px-6 py-20 text-center">
        <div className="flex justify-center">
          <MandorlaMark />
        </div>
        <Reveal className="flex flex-col items-center gap-8" delay={0.1}>
          <AthanorWordmark className="text-3xl md:text-4xl" />
          <h1 className="max-w-2xl font-display text-5xl font-medium leading-[1.05] tracking-tight md:text-7xl">
            {t('landing.hero.title', L)}
          </h1>
          <WaitlistForm className="mt-2" locale={L} source="landing-hero" />
          <LaunchCountdown className="mt-2" locale={L} />
        </Reveal>
      </section>

      {/* NARRATIVE — full-width editorial column + a fixed scroll-progress rail */}
      <ChapterSpine chapters={CHAPTERS} />
      <div className="mx-auto w-full max-w-3xl px-6">
        {/* IL NOME */}
        <Section id="nome" label={t('landing.nome.eyebrow', L)} center>
          <Reveal className="mx-auto max-w-3xl text-center">
            <div className="flex justify-center text-foreground/70">
              <Ripples size={30} />
            </div>
            <p className="mt-6 font-dream text-4xl italic leading-snug md:text-5xl">
              «{t('landing.nome.quote', L)}»
            </p>
            <p className="mx-auto mt-8 max-w-xl text-lg leading-relaxed text-muted-foreground">
              {t('landing.nome.body', L)}
            </p>
          </Reveal>
        </Section>

        {/* IL PROBLEMA */}
        <Section id="problema" label={t('landing.problem.eyebrow', L)}>
          <Reveal>
            <h2 className="max-w-3xl font-display text-4xl font-medium leading-snug tracking-tight md:text-5xl">
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
          </Reveal>
        </Section>

        {/* MANIFESTO */}
        <Section id="manifesto" label={t('landing.manifesto.eyebrow', L)}>
          <Reveal>
            <h2 className="max-w-3xl font-display text-4xl font-medium leading-snug tracking-tight md:text-5xl">
              {t('landing.manifesto.title', L)}
            </h2>
            <p className="mt-8 max-w-2xl text-lg leading-relaxed text-muted-foreground">
              {t('landing.manifesto.body', L)}
            </p>
          </Reveal>
        </Section>

        {/* I PILASTRI — editorial rows */}
        <Section id="pilastri" label={t('landing.pillars.eyebrow', L)}>
          <Reveal>
            <h2 className="font-display text-4xl font-medium tracking-tight md:text-5xl">
              {t('landing.pillars.title', L)}
            </h2>
            <ul className="mt-12 border-t border-border">
              {PILLARS.map((p) => {
                const Glyph = PILLAR_GLYPHS[p.key];
                return (
                  <li
                    key={p.key}
                    className="flex items-center gap-5 border-b border-border py-7 md:gap-8"
                  >
                    <span className="shrink-0 text-foreground/80">
                      <Glyph size={34} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-display text-2xl font-medium tracking-tight md:text-3xl">
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
          </Reveal>
        </Section>

        {/* AURA */}
        <Section id="aura" label={t('landing.aura.eyebrow', L)} center>
          <Reveal className="mx-auto max-w-3xl text-center">
            <p className="font-dream text-4xl italic leading-snug md:text-5xl">
              «{t('landing.aura.quote', L)}»
            </p>
            <p className="mx-auto mt-8 max-w-xl text-lg leading-relaxed text-muted-foreground">
              {t('landing.aura.body', L)}
            </p>
          </Reveal>
        </Section>

        {/* LE SEI STELLE */}
        <Section id="stelle" label={t('landing.stars.eyebrow', L)}>
          <Reveal>
            <h2 className="max-w-3xl font-display text-4xl font-medium tracking-tight md:text-5xl">
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
                    <h3 className="font-display text-xl font-medium">{t(s.name, L)}</h3>
                    <p className="text-sm text-muted-foreground">{t(s.desc, L)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Reveal>
        </Section>

        {/* IL SOGNO */}
        <Section id="sogno" label={t('landing.sogno.eyebrow', L)} center>
          <Reveal className="mx-auto max-w-3xl text-center">
            <div className="flex justify-center text-foreground/70">
              <KairosStar size={24} />
            </div>
            <p className="mt-6 font-dream text-4xl italic leading-snug md:text-5xl">
              «{t('landing.sogno.quote', L)}»
            </p>
            <p className="mx-auto mt-8 max-w-xl text-lg leading-relaxed text-muted-foreground">
              {t('landing.sogno.body', L)}
            </p>
          </Reveal>
        </Section>

        {/* DAI VITA AL TUO SOGNO — the dream-lit moment (sanctioned aura accent) */}
        <Section id="daivita" label={t('landing.daivita.eyebrow', L)} center accent>
          <Reveal className="mx-auto max-w-3xl text-center">
            <div className="flex justify-center text-aura">
              <KairosStar filled size={24} />
            </div>
            <p className="mt-6 font-dream text-4xl italic leading-snug md:text-5xl">
              «{t('landing.daivita.quote', L)}»
            </p>
            <p className="mx-auto mt-8 max-w-xl text-lg leading-relaxed text-muted-foreground">
              {t('landing.daivita.body', L)}
            </p>
          </Reveal>
        </Section>
      </div>

      {/* FOOTER */}
      <footer
        id="scarica"
        className="flex min-h-screen flex-col items-center justify-center gap-12 border-t border-border bg-background px-6 py-24 text-center"
      >
        <Reveal className="flex flex-col items-center gap-16">
          <p className="mx-auto max-w-2xl font-dream text-3xl italic leading-snug md:text-4xl">
            «{t('landing.close.quote', L)}»
          </p>
          <div className="flex flex-col items-center gap-12 md:flex-row md:gap-20 md:text-left">
            <DeviceMockup
              src="/mobile-image-2.png"
              alt={t('landing.preview.alt', L)}
              className="w-[340px] md:w-[440px]"
            />
            <div className="flex flex-col items-center md:items-start">
              <h2 className="max-w-xl font-display text-4xl font-medium leading-[1.05] tracking-tight md:text-6xl">
                <BrandText text={t('landing.download.title', L)} />
              </h2>
              <p className="mt-5 max-w-sm text-base leading-relaxed text-muted-foreground md:text-lg">
                {t('landing.preview.caption', L)}
              </p>
              <WaitlistForm className="mt-10" locale={L} source="landing-footer" />
              <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">
                {t('landing.download.founders', L)}
              </p>
            </div>
          </div>
          <ul className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-sm text-muted-foreground">
            <li>{t('landing.footer.point1', L)}</li>
            <li aria-hidden>·</li>
            <li>{t('landing.footer.point2', L)}</li>
            <li aria-hidden>·</li>
            <li>{t('landing.footer.point3', L)}</li>
          </ul>
          <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
            <Link href="/privacy" className="transition-opacity hover:opacity-80">
              {t('legal.privacy', L)}
            </Link>
            <span aria-hidden>·</span>
            <Link href="/terms" className="transition-opacity hover:opacity-80">
              {t('legal.terms', L)}
            </Link>
          </nav>
          <div className="flex flex-col items-center gap-3 opacity-60">
            <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              {t('landing.footer.poweredby', L)}
            </span>
            <div className="flex items-center gap-4">
              <Image
                src="/anecoica-wordmark.png"
                alt={t('landing.footer.anecoica', L)}
                width={1973}
                height={160}
                className="h-5 w-auto"
              />
              <Image
                src="/nuova-realta.png"
                alt={t('landing.footer.nuovarealta', L)}
                width={360}
                height={230}
                className="h-12 w-auto"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t('landing.footer.copyright', L)}</p>
        </Reveal>
      </footer>
    </main>
  );
}
