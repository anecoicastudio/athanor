export const dynamic = 'force-static';

/**
 * Apple App Site Association (AASA) — served at `/.well-known/apple-app-site-association`
 * via the rewrite in `next.config.ts`. iOS fetches this over HTTPS to verify Athanor owns
 * `athanor-page.vercel.app`, enabling Universal Links: `https://athanor-page.vercel.app/...`
 * opens the app instead of Safari. Must return 200 + `application/json` with no redirect.
 *
 * `<TEAMID>` is a placeholder — fill with the Apple Developer Team ID at P1.5
 * (the same value goes in `apps/mobile/eas.json` → submit.production.ios.appleTeamId).
 * Paths mirror `apps/mobile/app.json` ios.associatedDomains + android.intentFilters.
 */
const AASA = {
  applinks: {
    details: [
      {
        appID: '<TEAMID>.com.athanor.app',
        paths: ['/momento/*', '/event/*', '/post/*', '/@*', '/invite/*'],
      },
    ],
  },
};

export function GET() {
  return new Response(JSON.stringify(AASA), {
    headers: { 'Content-Type': 'application/json' },
  });
}
