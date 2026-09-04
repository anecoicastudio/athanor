import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { t } from '@athanor/i18n';
import { semantic } from '@athanor/config';
import { getPublicProfileByHandle } from '@athanor/api';
import type { PublicProfile } from '@athanor/schemas';
import { DEFAULT_LOCALE } from '@/lib/default-locale';
import { handleStaticParams } from '@/lib/handle-static-params';
import { mandorlaDataUri } from '@/lib/mandorla-svg';
import { cardInitial, quoteFontSize } from '@/lib/og-card';
import { resolveHandle } from '@/lib/resolve-handle';
import { SITE_URL } from '@/lib/site';
import { createAnonClient } from '@/utils/supabase/server';

/**
 * Per-handle OG card (PRD §4.2, #157) — the dream quote travels with the link,
 * but ONLY when the member opted the dream public (RLS is the gate: the anon
 * read-model carries `dream.text` exactly when dream:public and the shell is
 * kept, #251). Otherwise a branded name-card: display name + avatar on the
 * brand ground — never the generic site card for a member page, never a quote
 * the member did not opt in.
 *
 * Rendering happens at BUILD TIME only. Satori+resvg measured 276 ms cold /
 * 33 ms warm (M-series laptop) against the Workers free plan's 10 ms CPU
 * budget — the exact render that got the previous route deleted (217928e).
 * This route prerenders for every generateStaticParams handle and populate-
 * cache seeds the PNGs into KV, so the Worker only ever serves bytes. The one
 * runtime path — a handle created since the last deploy, or a lost cache
 * entry — redirects to the site-wide card instead of rendering; that member
 * gets their personal card at the next deploy.
 *
 * `force-static` + `revalidate = false`, deliberately diverging from the
 * page's 300. Without `force-static` the route builds as ƒ dynamic — the
 * Supabase reads are plain fetches, and with no revalidate number the segment
 * default treats them as no-store — and every card would be a runtime redirect.
 * And an ISR re-render (any numeric revalidate) would execute in the Worker,
 * hit the redirect branch, and cache a generic card over every personal one
 * five minutes after deploy. The trade is that the card is frozen until the
 * next deploy — a dream edit, a visibility toggle, or the M9 erasure job
 * update the page within 5 minutes but the card only at release. Same class
 * of staleness the deletion commit accepted for the whole route; called out
 * in the PR for the erasure case.
 *
 * What a redeploy does to an ALREADY-cached card (#440, measured against the
 * production namespace on 2026-08-18, not inferred): every incremental-cache
 * key is `incremental-cache/<BUILD_ID>/<sha256(path)>.cache`, and BUILD_ID is
 * Next's per-build nanoid — no `generateBuildId` in next.config.ts, so it
 * rotates on every build. `populate-cache` only ever `kv bulk put`s the
 * current build's assets; it never lists and never deletes. So a handle that
 * drops out of `generateStaticParams` — which is exactly what a ban does now
 * that `handle-static-params` reads through the anon client (#314 / PR #439)
 * — is not overwritten. Its entry is stranded under a dead build prefix,
 * unreachable, and the live prefix simply has no key for it. The next request
 * therefore misses, takes the blocking fallback (`fallback: null` in the
 * prerender manifest), and lands in the Worker branch below — the generic
 * site card. The ban reaches the card at the NEXT DEPLOY, not never: the
 * exposure is bounded by the release cadence, which is what #440 set out to
 * establish.
 *
 * The stranded bytes are a separate question with a worse answer: nothing
 * deletes them and the KV cache writes no TTL, so a card stays readable by
 * key forever even though nothing can route to it. `docs/RELEASE-RUNBOOK.md`
 * §7.4 has the one-key delete for cutting a card between releases, and #107
 * is where "unreachable" needs to become "erased".
 */
export const dynamic = 'force-static';
export const revalidate = false;

// Not inherited from the sibling page — without this export the image route
// prerenders zero params (see lib/handle-static-params.ts).
export async function generateStaticParams() {
  return handleStaticParams();
}

export const alt = t('og.profileAlt', DEFAULT_LOCALE);
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** Lazy so the Worker never touches fs — the redirect branch returns first. */
let fontsPromise: Promise<
  { name: string; data: Buffer; weight: 400 | 600; style: 'normal' | 'italic' }[]
> | null = null;
function loadFonts() {
  fontsPromise ??= (async () => {
    const dir = join(process.cwd(), 'assets', 'og-fonts');
    const [regular, semibold, italic] = await Promise.all([
      readFile(join(dir, 'hanken-400.ttf')),
      readFile(join(dir, 'hanken-600.ttf')),
      readFile(join(dir, 'hanken-italic-400.ttf')),
    ]);
    return [
      { name: 'Hanken Grotesk', data: regular, weight: 400 as const, style: 'normal' as const },
      { name: 'Hanken Grotesk', data: semibold, weight: 600 as const, style: 'normal' as const },
      { name: 'Hanken Grotesk', data: italic, weight: 400 as const, style: 'italic' as const },
    ];
  })();
  return fontsPromise;
}

/**
 * Signed avatar URL → data URI at build time, so the pixels are baked before
 * the 1-hour signature expires and a broken avatar degrades to initials
 * instead of failing the whole build inside Satori's fetch. resvg decodes
 * png/jpeg/gif only — anything else (webp) falls back to initials too.
 */
async function avatarDataUri(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
    if (!['image/png', 'image/jpeg', 'image/gif'].includes(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

function Avatar({
  profile,
  px,
  avatar,
}: {
  profile: PublicProfile;
  px: number;
  avatar: string | null;
}) {
  if (avatar) {
    return (
      <img
        src={avatar}
        width={px}
        height={px}
        alt=""
        style={{ borderRadius: px, objectFit: 'cover' }}
      />
    );
  }
  return (
    <div
      style={{
        width: px,
        height: px,
        borderRadius: px,
        background: semantic.surface,
        border: `1px solid ${semantic.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.round(px * 0.44),
        fontWeight: 600,
      }}
    >
      {cardInitial(profile.displayName, profile.handle)}
    </div>
  );
}

function Wordmark({ fontSize }: { fontSize: number }) {
  // Letterspacing adds a trailing gap; the site-wide card compensates the same way.
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        color: semantic.foregroundMuted,
      }}
    >
      <img src={mandorlaDataUri(3.2)} width={fontSize * 2.2} height={fontSize * 2.2} alt="" />
      <div style={{ display: 'flex', fontSize, letterSpacing: 10, paddingLeft: 10 }}>
        {t('app.name', DEFAULT_LOCALE).toUpperCase()}
      </div>
    </div>
  );
}

/** The member opted the dream public — the quote is the card. */
function DreamCard({ profile, avatar }: { profile: PublicProfile; avatar: string | null }) {
  const text = profile.dream?.text ?? '';
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 72,
        background: semantic.background,
        color: semantic.foreground,
        fontFamily: 'Hanken Grotesk',
      }}
    >
      <div
        style={{
          display: 'flex',
          fontSize: 26,
          letterSpacing: 8,
          fontWeight: 600,
          color: semantic.aura,
        }}
      >
        {t('og.dreamEyebrow', DEFAULT_LOCALE).toUpperCase()}
      </div>
      <div
        style={{
          display: 'flex',
          fontSize: quoteFontSize(text.length),
          lineHeight: 1.25,
          fontStyle: 'italic',
        }}
      >
        {`«${text}»`}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <Avatar profile={profile} px={64} avatar={avatar} />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {profile.displayName ? (
              <div style={{ display: 'flex', fontSize: 30, fontWeight: 600 }}>
                {profile.displayName}
              </div>
            ) : null}
            <div style={{ display: 'flex', fontSize: 24, color: semantic.foregroundMuted }}>
              @{profile.handle}
            </div>
          </div>
        </div>
        <Wordmark fontSize={24} />
      </div>
    </div>
  );
}

/** No public dream — the branded name-card: the person on the brand ground. */
function NameCard({ profile, avatar }: { profile: PublicProfile; avatar: string | null }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
        padding: 72,
        background: semantic.background,
        color: semantic.foreground,
        fontFamily: 'Hanken Grotesk',
      }}
    >
      <Avatar profile={profile} px={140} avatar={avatar} />
      {profile.displayName ? (
        <div style={{ display: 'flex', fontSize: 58, fontWeight: 600 }}>{profile.displayName}</div>
      ) : null}
      <div
        style={{
          display: 'flex',
          fontSize: profile.displayName ? 28 : 58,
          color: profile.displayName ? semantic.aura : semantic.foreground,
          fontWeight: profile.displayName ? 400 : 600,
        }}
      >
        @{profile.handle}
      </div>
      <div style={{ display: 'flex', marginTop: 28 }}>
        <Wordmark fontSize={24} />
      </div>
    </div>
  );
}

/** The build raced a deletion or an identity opt-out — the brand card, inline. */
function BrandCard() {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 36,
        background: semantic.background,
        color: semantic.foreground,
        fontFamily: 'Hanken Grotesk',
      }}
    >
      <img src={mandorlaDataUri(3.2)} width={196} height={196} alt="" />
      <div style={{ display: 'flex', fontSize: 64, letterSpacing: 24, paddingLeft: 24 }}>
        {t('app.name', DEFAULT_LOCALE).toUpperCase()}
      </div>
      <div
        style={{ display: 'flex', fontSize: 30, letterSpacing: 4, color: semantic.foregroundMuted }}
      >
        {t('app.tagline', DEFAULT_LOCALE)}
      </div>
    </div>
  );
}

export default async function Image({ params }: { params: Promise<{ handle: string }> }) {
  // Worker runtime — only a handle absent from the last build's prerender set
  // reaches this branch (or a lost KV entry). Rendering here is what the 10 ms
  // budget forbids (see header), so hand the crawler the site-wide card.
  if (globalThis.navigator?.userAgent === 'Cloudflare-Workers') {
    return Response.redirect(`${SITE_URL}/opengraph-image`, 302);
  }

  const { handle: raw } = await params;
  const handle = resolveHandle(raw);
  // createAnonClient like the page: no cookies() in the render path, or the
  // route stops prerendering and every card becomes a runtime redirect.
  const profile = handle ? await getPublicProfileByHandle(createAnonClient(), handle) : null;

  const fonts = await loadFonts();
  if (!profile) {
    return new ImageResponse(<BrandCard />, { ...size, fonts });
  }
  const avatar = await avatarDataUri(profile.avatarUrl);
  return new ImageResponse(
    profile.dream ? (
      <DreamCard profile={profile} avatar={avatar} />
    ) : (
      <NameCard profile={profile} avatar={avatar} />
    ),
    { ...size, fonts },
  );
}
