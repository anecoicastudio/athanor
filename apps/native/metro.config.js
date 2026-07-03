const { getSentryExpoConfig } = require('@sentry/react-native/metro');
const { withNativewind } = require('nativewind/metro');

// getSentryExpoConfig wraps Expo's getDefaultConfig to emit Hermes-compatible source maps
// for symbolication (P1.4 / RUNBOOK B-3). Drop-in replacement — keep the NativeWind wrap.
/** @type {import('expo/metro-config').MetroConfig} */
const config = getSentryExpoConfig(__dirname);

module.exports = withNativewind(config, {
  // inline variables break PlatformColor in CSS variables
  inlineVariables: false,
  // className support added via src/tw wrappers
  globalClassNamePolyfill: false,
});
