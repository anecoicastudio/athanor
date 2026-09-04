export const dynamic = 'force-static';

/**
 * Android Digital Asset Links — served at `/.well-known/assetlinks.json` via the rewrite
 * in `next.config.ts`. Google fetches this to verify Athanor owns `www.athanor.world`,
 * so `autoVerify` App Links (see `apps/native/app.json` android.intentFilters) open the app
 * directly. Must return 200 + `application/json` with no redirect.
 *
 * `<SHA256>` is a placeholder — fill with the EAS keystore SHA-256 fingerprint at P1.5
 * (`eas credentials` → Android → keystore). Format: uppercase colon-separated hex.
 */
const ASSETLINKS = [
  {
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: 'com.athanor.app',
      sha256_cert_fingerprints: ['<SHA256>'],
    },
  },
];

export function GET() {
  return new Response(JSON.stringify(ASSETLINKS), {
    headers: { 'Content-Type': 'application/json' },
  });
}
