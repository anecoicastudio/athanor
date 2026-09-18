export const dynamic = 'force-static';

/**
 * Android Digital Asset Links — served at `/.well-known/assetlinks.json` via the rewrite
 * in `next.config.ts`. Google fetches this to verify Athanor owns `www.athanor.world`,
 * so `autoVerify` App Links (see `apps/native/app.json` android.intentFilters) open the app
 * directly. Must return 200 + `application/json` with no redirect.
 *
 * Two certificates, because an install can carry either signature:
 * - **Play app signing key** — every install from Google Play is re-signed with it. Read from
 *   Play Console → Test and release → App integrity, or the Play Developer API's
 *   `generatedApks` for any uploaded versionCode. This is the one real users hit.
 * - **EAS upload key** — the keystore `eas build` signs with (`eas credentials` → Android).
 *   Covers an APK signed with the upload keystore and installed outside Play, e.g. an EAS
 *   internal-distribution build.
 * Rotating either key means replacing its line here. Format: uppercase colon-separated hex.
 */
const ASSETLINKS = [
  {
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: 'world.athanor.app',
      sha256_cert_fingerprints: [
        // Play app signing key
        '7E:F8:14:E3:80:A6:E0:C2:1D:26:BF:D5:C0:D8:AA:52:1D:B1:A2:E2:89:6A:43:64:05:67:79:2C:5A:95:C9:28',
        // EAS upload key
        '18:8A:9B:D8:07:4B:40:C8:9B:DB:4B:57:2B:33:EE:DC:1D:65:D8:A2:14:6A:6D:44:28:E6:25:E8:FA:9D:78:95',
      ],
    },
  },
];

export function GET() {
  return new Response(JSON.stringify(ASSETLINKS), {
    headers: { 'Content-Type': 'application/json' },
  });
}
