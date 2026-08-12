## What this changes

<!-- One or two sentences. Issue: #NNN (merging into `dev` does not auto-close it; the release PR to `main` does). -->

## Beyond the issue

<!--
Work you found while implementing that the issue never asked for. It belongs
here, on this branch, in this PR — see README §"Git workflow". Whoever wrote the
issue could not see every detail the implementation exposes, so extra fixes are
expected, not scope creep. List each one. Delete this section only if there
genuinely was none.
-->

-

## Checks

- [ ] `./node_modules/.bin/turbo run lint typecheck test --force` green locally — `--force` because turbo's cache is not sound in this repo, so a plain run can print `FULL TURBO` and prove nothing
- [ ] `pnpm i18n:check` and `pnpm format:check` green — turbo does not cover either, and CI runs both
- [ ] Touched `supabase/functions`? `cd supabase/functions && deno test --allow-env --allow-read .` — outside the pnpm workspace, so turbo never sees it
- [ ] Touched `packages/core` or `packages/schemas`? CI also runs a mutation score with a failing threshold
- [ ] Migration, if any: pushed to **staging** first, `pnpm gen:types` re-run, generated types committed
- [ ] User-facing strings: IT **and** EN keys added in the same change
