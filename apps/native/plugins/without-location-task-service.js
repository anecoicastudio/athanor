/**
 * Removes expo-location's `LocationTaskService` from the merged Android manifest (#776).
 *
 * expo-location declares the service in its own library manifest with
 * `android:foregroundServiceType="location"`, whatever the app config says. It exists only for
 * TaskManager background updates (`startLocationUpdatesAsync` with a foreground service, via
 * `LocationTaskConsumer`), and this app has neither expo-task-manager nor a background fix — its
 * two callers take one foreground `getCurrentPositionAsync`, which goes through the fused
 * provider and never touches the service. The FOREGROUND_SERVICE permissions are already blocked
 * in app.json, so the service could not start anyway; removing the element is what keeps a
 * `location` foreground-service type out of the manifest Play reads.
 *
 * `tools:node="remove"` on an app-manifest element of the same name is how the manifest merger
 * drops a library's declaration. `native-config.test.ts` pins the wiring and the pure half below.
 */
const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

const LOCATION_TASK_SERVICE = 'expo.modules.location.services.LocationTaskService';
const TOOLS_NS = 'http://schemas.android.com/tools';

/**
 * The pure half: mark the service for removal at merge, idempotently.
 * @param {import('expo/config-plugins').AndroidConfig.Manifest.AndroidManifest} manifest
 */
function removeLocationTaskService(manifest) {
  manifest.manifest.$['xmlns:tools'] = TOOLS_NS;
  const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  const others = (application.service ?? []).filter(
    (service) => service.$['android:name'] !== LOCATION_TASK_SERVICE,
  );
  application.service = [
    ...others,
    // `tools:node` is a manifest-merger attribute, not an Android one.
    { $: { 'android:name': LOCATION_TASK_SERVICE, 'tools:node': 'remove' } },
  ];
  return manifest;
}

/** @type {import('expo/config-plugins').ConfigPlugin} */
const withoutLocationTaskService = (config) =>
  withAndroidManifest(config, (mod) => {
    mod.modResults = removeLocationTaskService(mod.modResults);
    return mod;
  });

module.exports = withoutLocationTaskService;
module.exports.removeLocationTaskService = removeLocationTaskService;
module.exports.LOCATION_TASK_SERVICE = LOCATION_TASK_SERVICE;
