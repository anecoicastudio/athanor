# Native harness gap

Type: research
Status: open

## Question

`apps/native` has 213 source files and **1** test file. What is actually in the way?

`package.json` declares `"test": "vitest run"` but there is **no `vitest.config.ts`** in the app —
so there is no environment, no coverage, no thresholds. The single test is
`src/lib/large-secure-store.test.ts`.

Determine:
- What does `pnpm test` currently do in this workspace — pass vacuously, or fail?
- What is testable *today* with no new harness: `src/lib/`, `src/hooks/`, `src/tw` wrappers,
  pure helpers such as the `time.ts` extracted in commit `050153e`?
- What needs real harness work: components, screens, expo-router routes, NativeWind `className`
  rendering?
- What does Expo SDK 54 + NativeWind v5 + React 19 constrain here — is `jest-expo` the supported
  path, or does vitest work? Check the `expo:*` plugin skills and Expo SDK 54 docs, not memory.
- Rough count: how many of the 213 files fall in each bucket?
