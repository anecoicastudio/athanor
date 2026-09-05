// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    // eslint-config-expo 57 ships the React Compiler rules as errors, and the tree trips them at
    // 152 sites in 42 files — the compiler's own bail-out list made visible. Held at `warn` so
    // the SDK 57 dependency bump does not carry a 42-file behaviour sweep; #691 is that sweep,
    // and deleting this block is its acceptance test.
    rules: {
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/use-memo': 'warn',
    },
  },
]);
