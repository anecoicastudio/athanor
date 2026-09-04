export const dynamic = 'force-static';

/**
 * Apple App Site Association (AASA) — served at `/.well-known/apple-app-site-association`
 * via the rewrite in `next.config.ts`. iOS fetches this over HTTPS to verify Athanor owns
 * `www.athanor.world`, enabling Universal Links: `https://www.athanor.world/...`
 * opens the app instead of Safari. Must return 200 + `application/json` with no redirect.
 *
 * `<TEAMID>` is a placeholder — fill with the Apple Developer Team ID at P1.5
 * (the same value goes in `apps/native/eas.json` → submit.production.ios.appleTeamId).
 * Paths mirror `apps/native/app.json`'s android.intentFilters — NOT its associatedDomains,
 * which declares the host and no path list at all. This array IS the iOS path set: it is
 * served from the Worker, so unlike the Android prefixes it is not compiled into the binary
 * and does not wait for a store build (#159).
 */
const AASA = {
  applinks: {
    details: [
      {
        appID: '<TEAMID>.com.athanor.app',
        paths: ['/momento/*', '/event/*', '/post/*', '/dream/*', '/@*', '/invite/*'],
      },
    ],
  },
};

export function GET() {
  return new Response(JSON.stringify(AASA), {
    headers: { 'Content-Type': 'application/json' },
  });
}
