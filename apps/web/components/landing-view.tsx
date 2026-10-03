import type { ReactNode } from 'react';
import type { Locale } from '@athanor/i18n';
import Image from 'next/image';
import localFont from 'next/font/local';
import { t } from '@athanor/i18n';
import { LegalNav } from '@/components/legal-nav';
import { SparkStar } from '@/components/icons';
import { PILLAR_GLYPHS } from '@/components/icons/glyphs';
import { DeviceMockup } from '@/components/device-mockup';
import { StoreBadges } from '@/components/store-badges';
import { UpdatesForm } from '@/components/updates-form';
import { AthanorWordmark, BrandText } from '@/components/athanor-wordmark';
import { Reveal } from '@/components/reveal';
import { LangSwitch } from '@/components/lang-switch';
import { LandingVideo } from '@/components/landing-video';

/**
 * Athanor landing — a single static one-pager presenting the project and linking to the app.
 *
 * The broadsheet (Marco's rulings, 2026-10-03 — two editorial references blended, superseding
 * the 2026-06-13 dark split-screen; docs/DESIGN.md §6 «Web landing» + §11). The page is a
 * painted wall, not the dark app: a concrete canvas, near-black iron, and the mandala violet
 * taking whole full-bleed bands (the manifesto, the download close). Headings are wall type —
 * Barlow Condensed up to 215px with crushed leading, so lines stack into a facade — body is
 * Hanken, and a mono face carries the technical annotations. Solid hairlines instead of
 * cards, no glow, no cyan; violet is a surface and a headline colour, never a button fill.
 * Buttons are dark pills; nothing else is rounded. The palette and the helper classes
 * (`bs-display`, `bs-heading`, `bs-label`, `bs-side`, `broadsheet-field`) live in the
 * `.broadsheet` block of app/globals.css; the colours are `broadsheet` in @athanor/config.
 *
 * Nothing above the fold animates in: no splash, no hero entrance. Chapters below fade up on
 * scroll (<Reveal>). Each chapter's catalog label is its wall heading: a two-word label
 * splits to the two edges of the section with a hairline between.
 *
 * Locale comes from the in-page IT/EN toggle (cookie-persisted, LocaleProvider) and arrives
 * here as a prop from landing-client.tsx — this view has no hook of its own, so app/page.tsx
 * stays a Server Component (#335). Both catalogs live in @athanor/i18n.
 */

/*
 * The landing's two own faces are loaded here rather than in the root layout, so only `/`
 * preloads them. Self-hosted for the reason app/layout.tsx gives for the other two.
 */
const barlowCondensed = localFont({
  src: [
    { path: '../app/fonts/barlow-condensed-latin-400.woff2', weight: '400', style: 'normal' },
    { path: '../app/fonts/barlow-condensed-latin-500.woff2', weight: '500', style: 'normal' },
  ],
  variable: '--font-wall',
  adjustFontFallback: 'Arial',
});
const jetbrainsMono = localFont({
  src: [{ path: '../app/fonts/jetbrains-mono-latin.woff2', weight: '100 800', style: 'normal' }],
  variable: '--font-jetbrains-mono',
  adjustFontFallback: false,
});

/** The page's left edge. Type anchors to it; nothing is centred. */
const EDGE = 'mx-auto w-full max-w-[1440px] px-5 md:px-8';

/**
 * The poster heading of a chapter. Two words go to opposite edges, bisected by a hairline;
 * anything else stays flush-left and wraps. One <h2> either way, so it reads as its label.
 */
function PosterHeading({ label }: { label: string }) {
  const words = label.split(' ');
  if (words.length !== 2) {
    return <h2 className="bs-display text-(color:--display)">{label}</h2>;
  }
  return (
    <h2 className="bs-display flex flex-wrap items-stretch justify-between gap-x-5 text-(color:--display)">
      <span>{words[0]}</span>{' '}
      <span aria-hidden className="hidden w-px self-stretch bg-border sm:block" />
      <span className="max-sm:ml-auto">{words[1]}</span>
    </h2>
  );
}

/**
 * One chapter: the poster heading across the full width, then the content hung on the right
 * two-thirds — the left third stays empty wall. `field` turns the band violet.
 */
function Chapter({
  id,
  label,
  field = false,
  side,
  children,
}: {
  id: string;
  label: string;
  field?: boolean;
  /** A margin annotation, rotated, on the band's right edge (md and up). */
  side?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className={`relative scroll-mt-14 border-t border-border ${field ? 'broadsheet-field' : ''}`}
    >
      <div className={`${EDGE} pb-20 pt-10 md:pb-32 md:pt-14`}>
        <PosterHeading label={label} />
        <Reveal className="mt-14 grid grid-cols-1 gap-x-8 md:mt-24 md:grid-cols-12">
          <div className="md:col-span-8 md:col-start-5 lg:col-span-7 lg:col-start-5">
            {children}
          </div>
        </Reveal>
      </div>
      {side ? (
        <p aria-hidden className="bs-side absolute bottom-10 right-8 hidden lg:block">
          {side}
        </p>
      ) : null}
    </section>
  );
}

function Body({ children }: { children: ReactNode }) {
  return <p className="mt-8 max-w-[62ch] text-lg leading-normal">{children}</p>;
}

/** The Athanor mark for light grounds (packages/config/assets/logo-light.svg), in one colour. */
function LogoMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="12 0 136 136" className={className} fill="none">
      <path
        d="M80 4 L82.6 14.4 L92 17 L82.6 19.6 L80 30 L77.4 19.6 L68 17 L77.4 14.4 Z"
        fill="currentColor"
      />
      <path
        d="M80 28 A60 60 0 0 1 80 132 A60 60 0 0 1 80 28 Z"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinejoin="round"
      />
      <circle cx="80" cy="80" r="6" fill="currentColor" />
    </svg>
  );
}

/**
 * A problem line is authored as «name — explanation». Split on the dash, the name becomes the
 * row title and the rest its annotation; a line with no dash is all title.
 */
function splitLine(line: string): [string, string | undefined] {
  const at = line.indexOf(' — ');
  return at === -1 ? [line, undefined] : [line.slice(0, at), line.slice(at + 3)];
}

// i18n-ignore — class names, not copy
const ROW_TITLE = 'text-2xl font-medium leading-[1.3] text-(color:--display)';
// i18n-ignore — class names, not copy
const ROW_NOTE = 'font-mono text-[13px] leading-normal tracking-[0.02em] text-muted-foreground';

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
    <main
      id="main"
      className={`broadsheet flex min-h-screen flex-col ${jetbrainsMono.variable} ${barlowCondensed.variable}`}
    >
      {/* HEADER — content on the wall, a hairline under it; a line of text, then the pill */}
      <header className="sticky top-0 z-40 border-b border-border bg-background">
        <div className={`${EDGE} flex h-14 items-center justify-between`}>
          <span className="flex items-center gap-3">
            <LogoMark className="size-5" />
            <AthanorWordmark className="hidden text-xs min-[360px]:inline-flex" />
          </span>
          <div className="flex items-center gap-5">
            <LangSwitch className="font-mono text-[11px] font-medium tracking-[0.02em]" />
            <span className="flex items-center gap-3">
              <span className="hidden text-[15px] leading-none md:inline">
                {t('app.tagline', L)}
              </span>
              <a
                href="#scarica"
                className="flex h-11 items-center rounded-full bg-primary px-5 text-[15px] leading-none text-primary-foreground transition-opacity duration-200 hover:opacity-85"
              >
                {t('nav.download', L)}
              </a>
            </span>
          </div>
        </div>
      </header>

      {/* HERO — the question, at wall scale, and the two ways in. No entrance. */}
      <section>
        <div
          className={`${EDGE} flex min-h-[calc(100svh-3.5rem)] flex-col justify-between gap-16 pb-20 pt-10 md:pt-14`}
        >
          <h1 className="bs-display max-w-[11ch]">{t('landing.hero.title', L)}</h1>
          <div className="grid grid-cols-1 items-end gap-x-8 gap-y-10 md:grid-cols-12">
            <div className="md:col-span-7">
              <StoreBadges className="justify-start" locale={L} />
              <p className="bs-label mt-4 text-muted-foreground">
                {t('landing.preview.caption', L)}
              </p>
            </div>
            <ul className="bs-label flex flex-col gap-1 text-violet md:col-span-4 md:col-start-9">
              <li>{t('landing.footer.point1', L)}</li>
              <li>{t('landing.footer.point2', L)}</li>
              <li>{t('landing.footer.point3', L)}</li>
            </ul>
          </div>
        </div>
      </section>

      {/* THE VIDEO — keyed on locale: a language switch remounts it on the other cut's poster */}
      <LandingVideo key={L} locale={L} />

      {/* IL NOME */}
      <Chapter id="nome" label={t('landing.nome.eyebrow', L)}>
        <p className="bs-heading">«{t('landing.nome.quote', L)}»</p>
        <Body>{t('landing.nome.body', L)}</Body>
      </Chapter>

      {/* IL PROBLEMA */}
      <Chapter id="problema" label={t('landing.problem.eyebrow', L)}>
        <p className="bs-heading">{t('landing.problem.title', L)}</p>
        <ul className="mt-12 border-t border-border">
          {PROBLEMS.map((key) => {
            const [name, note] = splitLine(t(key, L));
            return (
              <li
                key={key}
                className="grid gap-x-8 gap-y-1 border-b border-border py-5 sm:grid-cols-2"
              >
                <span className={ROW_TITLE}>{name}</span>
                {note ? <span className={`${ROW_NOTE} sm:pt-2`}>{note}</span> : null}
              </li>
            );
          })}
        </ul>
        <p className="mt-10 max-w-[40ch] text-2xl leading-[1.3]">
          {t('landing.problem.target', L)}
        </p>
      </Chapter>

      {/* MANIFESTO — the violet field */}
      <Chapter
        id="manifesto"
        label={t('landing.manifesto.eyebrow', L)}
        side={t('app.tagline', L)}
        field
      >
        <p className="bs-heading">{t('landing.manifesto.title', L)}</p>
        <Body>{t('landing.manifesto.body', L)}</Body>
      </Chapter>

      {/* I PILASTRI — full-width rows, not cards */}
      <Chapter id="pilastri" label={t('landing.pillars.eyebrow', L)}>
        <p className="bs-heading">{t('landing.pillars.title', L)}</p>
        <ul className="mt-12 border-t border-border">
          {PILLARS.map((p) => {
            const Glyph = PILLAR_GLYPHS[p.key];
            return (
              <li
                key={p.key}
                className="grid grid-cols-[2rem_1fr] items-start gap-x-5 gap-y-1 border-b border-border py-5 sm:grid-cols-[2rem_1fr_1fr] sm:gap-x-8"
              >
                <span className="pt-0.5 text-violet">
                  <Glyph size={28} />
                </span>
                <h3 className={ROW_TITLE}>{t(p.name, L)}</h3>
                <p className={`${ROW_NOTE} col-start-2 sm:col-start-3 sm:pt-2`}>{t(p.desc, L)}</p>
              </li>
            );
          })}
        </ul>
      </Chapter>

      {/* AURA */}
      <Chapter id="aura" label={t('landing.aura.eyebrow', L)}>
        <p className="bs-heading">«{t('landing.aura.quote', L)}»</p>
        <Body>{t('landing.aura.body', L)}</Body>
      </Chapter>

      {/* LE SEI STELLE */}
      <Chapter id="stelle" label={t('landing.stars.eyebrow', L)}>
        <p className="bs-heading">{t('landing.stars.title', L)}</p>
        <Body>{t('profile.stars.hint', L)}</Body>
        <ul className="mt-12 grid gap-x-8 border-t border-border sm:grid-cols-2">
          {STARS.map((s) => (
            <li key={s.name} className="flex items-start gap-4 border-b border-border py-5">
              <span className="shrink-0 pt-1.5 text-violet">
                <SparkStar size={20} />
              </span>
              <div>
                <h3 className={ROW_TITLE}>{t(s.name, L)}</h3>
                <p className={`${ROW_NOTE} mt-1`}>{t(s.desc, L)}</p>
              </div>
            </li>
          ))}
        </ul>
      </Chapter>

      {/* IL SOGNO */}
      <Chapter id="sogno" label={t('landing.sogno.eyebrow', L)}>
        <p className="bs-heading">«{t('landing.sogno.quote', L)}»</p>
        <Body>{t('landing.sogno.body', L)}</Body>
      </Chapter>

      {/* DAI VITA AL TUO SOGNO */}
      <Chapter id="daivita" label={t('landing.daivita.eyebrow', L)}>
        <p className="bs-heading">«{t('landing.daivita.quote', L)}»</p>
        <Body>{t('landing.daivita.body', L)}</Body>
      </Chapter>

      {/* CLOSE — the second violet field: the download, then the colophon */}
      <footer id="scarica" className="broadsheet-field scroll-mt-14 border-t border-border">
        <div className={`${EDGE} pb-10 pt-10 md:pt-14`}>
          <Reveal>
            <h2 className="bs-display bs-display--brand max-w-[11ch]">
              <BrandText text={t('landing.download.title', L)} />
            </h2>
          </Reveal>
          <Reveal className="mt-14 grid grid-cols-1 gap-x-8 gap-y-14 md:mt-24 md:grid-cols-12">
            <figure className="md:col-span-5 lg:col-span-4">
              <DeviceMockup
                src="/mobile-image-2.png"
                alt={t('landing.preview.alt', L)}
                className="w-[300px] max-w-full md:w-full"
              />
              <figcaption className="bs-label mt-3 text-muted-foreground">
                {t('landing.preview.caption', L)}
              </figcaption>
            </figure>
            <div className="md:col-span-7 md:col-start-6">
              <p className="bs-heading max-w-[24ch]">«{t('landing.close.quote', L)}»</p>
              <StoreBadges className="mt-12 justify-start" locale={L} />
              <p className="bs-label mt-4 max-w-sm text-muted-foreground">
                {t('landing.download.founders', L)}
              </p>
              <UpdatesForm className="mt-14" locale={L} source="updates-footer" />
            </div>
          </Reveal>

          <div className="mt-24 grid grid-cols-1 items-end gap-x-8 gap-y-8 border-t border-border pt-6 lg:grid-cols-12">
            <div className="flex flex-col gap-3 lg:col-span-4">
              <span className="bs-label text-muted-foreground">
                {t('landing.footer.poweredby', L)}
              </span>
              <div className="flex items-center gap-5">
                <Image
                  src="/anecoica-wordmark.png"
                  alt={t('landing.footer.anecoica', L)}
                  width={1973}
                  height={160}
                  className="h-4 w-auto"
                />
                <Image
                  src="/nuova-realta.png"
                  alt={t('landing.footer.nuovarealta', L)}
                  width={360}
                  height={230}
                  className="h-10 w-auto"
                />
              </div>
            </div>
            <LegalNav locale={L} className="bs-label lg:col-span-6 lg:col-start-5" />
            <p className="bs-label text-muted-foreground lg:col-span-2 lg:text-right">
              {t('landing.footer.copyright', L)}
            </p>
          </div>
        </div>
      </footer>
    </main>
  );
}
