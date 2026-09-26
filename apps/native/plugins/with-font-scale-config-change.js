/**
 * Declares `fontScale` in MainActivity's `android:configChanges` (#845).
 *
 * The bare template's list (`keyboard|keyboardHidden|orientation|screenSize|screenLayout|uiMode|
 * smallestScreenSize|assetsPaths`) has no `fontScale`, so a system font-size change destroyed and
 * recreated the Activity. The template's `MainActivity.onCreate` passes `null` to `super`, so
 * nothing was restored, and every unsent draft held in component state was lost. With the flag,
 * Android hands the change to `onConfigurationChanged` instead: React Native re-reads the display
 * metrics and re-lays out every surface, and `DeviceInfoModule` emits the dimensions event that
 * `FontScaleProvider` (`src/tw/font-scale.tsx`) listens to, which remounts the Text leaves at the
 * new size (#754).
 *
 * `density` (Settings → Display size) is deliberately not added; that is a separate change.
 * `native-config.test.ts` pins the wiring and the pure half below.
 */
const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

const FONT_SCALE = 'fontScale';

/**
 * The pure half: append `fontScale` to the main activity's configChanges, idempotently.
 * @param {import('expo/config-plugins').AndroidConfig.Manifest.AndroidManifest} manifest
 */
function addFontScaleConfigChange(manifest) {
  const activity = AndroidConfig.Manifest.getMainActivityOrThrow(manifest);
  const current = activity.$['android:configChanges'];
  const flags = current ? current.split('|') : [];
  if (!flags.includes(FONT_SCALE)) {
    activity.$['android:configChanges'] = [...flags, FONT_SCALE].join('|');
  }
  return manifest;
}

/** @type {import('expo/config-plugins').ConfigPlugin} */
const withFontScaleConfigChange = (config) =>
  withAndroidManifest(config, (mod) => {
    mod.modResults = addFontScaleConfigChange(mod.modResults);
    return mod;
  });

module.exports = withFontScaleConfigChange;
module.exports.addFontScaleConfigChange = addFontScaleConfigChange;
