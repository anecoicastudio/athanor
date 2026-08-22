import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `scripts/deploy-check.mjs` is the deploy-parity guard (#472): it is the only thing that can
 * see whether an edge function in the repo is actually deployed to staging and production.
 *
 * It lives at the repo root because it is an operator command, so it belongs to no workspace —
 * the same situation as `scripts/check-i18n-hardcoded.mjs`, which `packages/i18n` tests for the
 * same reason. This package is the closest owner: the hosted Supabase projects are `@athanor/api`'s
 * subject, and `packages/api/turbo.json` declares the script as a `$TURBO_ROOT$` test input so a
 * change to it invalidates this suite's cache.
 *
 * Only the PURE half is exercised. The two network calls are not testable without a Management
 * API token, and the point of splitting them out is that the set comparisons — above all
 * `STAGING_ONLY_SECRETS`, which is the difference between "expected" and "someone arms the
 * staging seed against production" — are a tested invariant rather than a line of code.
 *
 * Found by walking UP rather than counting `../`, the same trap `hardcoded-checker.test.ts` and
 * `audit-log-actions.mirror.test.ts` document: a runner may execute the suite from a sandbox copy.
 */
const SCRIPT = (() => {
  let dir = fileURLToPath(new URL('.', import.meta.url).href);
  for (;;) {
    const candidate = join(dir, 'scripts', 'deploy-check.mjs');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('no scripts/deploy-check.mjs above this test');
    dir = parent;
  }
})();

interface DeployedFunction {
  slug: string;
  verify_jwt: boolean;
}

interface DeployCheck {
  STAGING_REF: string;
  PRODUCTION_REF: string;
  STAGING_ONLY_SECRETS: string[];
  // Declared as properties, not methods: these are standalone module exports, and the test
  // destructures them — a method signature would make that an unbound-method lint error.
  readRepoFunctions: (functionsDir: string) => string[];
  parseConfigPostures: (toml: string) => Map<string, boolean>;
  diffDeployments: (sets: { repo: string[]; staging: string[]; production: string[] }) => {
    missingFromStaging: string[];
    missingFromProduction: string[];
    orphanStaging: string[];
    orphanProduction: string[];
  };
  diffSecrets: (sets: {
    staging: string[];
    production: string[];
    stagingOnlyByDesign?: string[];
  }) => {
    stagingOnly: string[];
    expectedStagingOnly: string[];
    productionOnly: string[];
    unexpectedOnProduction: string[];
  };
  postureDrift: (input: { postures: Map<string, boolean>; deployed: DeployedFunction[] }) => {
    slug: string;
    declared: boolean;
    deployed: boolean;
  }[];
  formatAge: (updatedAtMs: unknown, nowMs: number) => string;
}

const {
  STAGING_REF,
  PRODUCTION_REF,
  STAGING_ONLY_SECRETS,
  readRepoFunctions,
  parseConfigPostures,
  diffDeployments,
  diffSecrets,
  postureDrift,
  formatAge,
} = (await import(pathToFileURL(SCRIPT).href)) as DeployCheck;

describe('project refs', () => {
  // The script names both projects explicitly and never reads
  // `supabase/.temp/linked-project.json` — that file is a single global `db push` also obeys.
  // Pinning the constants is what makes "it cannot look at the wrong project" checkable.
  it('are the two hosted projects, staging and production kept distinct', () => {
    expect(STAGING_REF).toBe('eralyiwkfrpqsawivegz');
    expect(PRODUCTION_REF).toBe('kwzeiqvrnnaagccyoose');
  });
});

describe('readRepoFunctions', () => {
  function tree(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), 'deploy-check-'));
    for (const [name, body] of Object.entries(files)) {
      const file = join(root, name);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, body, 'utf8');
    }
    return root;
  }

  it('returns every directory holding an index.ts, sorted', () => {
    const root = tree({
      'score-engine/index.ts': '',
      'announce-cycle/index.ts': '',
      'media-process/index.ts': '',
    });
    expect(readRepoFunctions(root)).toEqual(['announce-cycle', 'media-process', 'score-engine']);
  });

  it('excludes _shared, which is library code and is deployed by no one', () => {
    const root = tree({ '_shared/index.ts': '', 'check-in/index.ts': '' });
    expect(readRepoFunctions(root)).toEqual(['check-in']);
  });

  it('excludes a directory with no index.ts — there is nothing there to deploy', () => {
    const root = tree({ 'check-in/index.ts': '', 'notes/README.md': '' });
    expect(readRepoFunctions(root)).toEqual(['check-in']);
  });

  it('agrees with the real supabase/functions tree', () => {
    const real = readRepoFunctions(join(dirname(dirname(SCRIPT)), 'supabase', 'functions'));
    expect(real).toContain('score-engine');
    expect(real).not.toContain('_shared');
  });
});

describe('parseConfigPostures', () => {
  it('reads verify_jwt per function', () => {
    const postures = parseConfigPostures(
      [
        '[functions.check-in]',
        'verify_jwt = true',
        '',
        '[functions.score-engine]',
        'verify_jwt = false',
        '',
      ].join('\n'),
    );
    expect(postures.get('check-in')).toBe(true);
    expect(postures.get('score-engine')).toBe(false);
  });

  it('does not attribute a later section’s verify_jwt to the last function seen', () => {
    // The trap: `[auth]` also has keys, and a parser that only tracks the last
    // `[functions.x]` header would hand `[db]`'s settings to that function.
    const postures = parseConfigPostures(
      ['[functions.check-in]', 'verify_jwt = true', '', '[auth]', 'verify_jwt = false'].join('\n'),
    );
    expect(postures.get('check-in')).toBe(true);
    expect(postures.size).toBe(1);
  });

  it('omits a function whose posture it cannot read rather than guessing one', () => {
    const postures = parseConfigPostures(['[functions.check-in]', 'verify_jwt = maybe'].join('\n'));
    expect(postures.has('check-in')).toBe(false);
  });

  it('reads the real supabase/config.toml and finds the postures rule 8 declares', () => {
    const configPath = join(dirname(dirname(SCRIPT)), 'supabase', 'config.toml');
    const postures = parseConfigPostures(readFileSync(configPath, 'utf8'));
    expect(postures.get('stripe-webhook')).toBe(false);
    expect(postures.get('check-in')).toBe(true);
  });
});

describe('diffDeployments', () => {
  const repo = ['a', 'b', 'c'];

  it('reports a repo function missing from either project — the one thing that gates', () => {
    const d = diffDeployments({ repo, staging: ['a', 'b', 'c'], production: ['a', 'b'] });
    expect(d.missingFromProduction).toEqual(['c']);
    expect(d.missingFromStaging).toEqual([]);
  });

  it('is symmetric: staging behind the repo is a failure too', () => {
    const d = diffDeployments({ repo, staging: ['a'], production: ['a', 'b', 'c'] });
    expect(d.missingFromStaging).toEqual(['b', 'c']);
    expect(d.missingFromProduction).toEqual([]);
  });

  it('reports an orphan — deployed with no repo directory — separately from a miss', () => {
    // Deleting a live function is a decision, not something a checking script should imply,
    // so an orphan is printed and never gated. Keeping it out of `missing*` is what keeps
    // the exit code meaning exactly one thing.
    const d = diffDeployments({ repo, staging: ['a', 'b', 'c', 'ghost'], production: repo });
    expect(d.orphanStaging).toEqual(['ghost']);
    expect(d.missingFromStaging).toEqual([]);
  });

  it('is quiet when all three sets agree', () => {
    const d = diffDeployments({ repo, staging: repo, production: repo });
    expect(d).toEqual({
      missingFromStaging: [],
      missingFromProduction: [],
      orphanStaging: [],
      orphanProduction: [],
    });
  });
});

describe('diffSecrets', () => {
  it('never reports app.settings.environment as drift', () => {
    // THE invariant. `app.settings.environment` is one of the two factors guarding
    // seed-staging.sql; its absence on production is correct. A naive diff calls it drift and
    // invites someone to "fix" it — which arms the staging seed against the production database.
    expect(STAGING_ONLY_SECRETS).toContain('app.settings.environment');
    const d = diffSecrets({
      staging: ['app.settings.environment', 'app.settings.push_dispatch_url'],
      production: ['app.settings.push_dispatch_url'],
    });
    expect(d.stagingOnly).toEqual([]);
    expect(d.expectedStagingOnly).toEqual(['app.settings.environment']);
  });

  it('still reports every other staging-only name', () => {
    const d = diffSecrets({
      staging: ['app.settings.environment', 'app.settings.story_segment_reaper_key'],
      production: [],
    });
    expect(d.stagingOnly).toEqual(['app.settings.story_segment_reaper_key']);
  });

  it('reports production-only names too — staging behind production is the other drift', () => {
    const d = diffSecrets({ staging: [], production: ['app.settings.moderation_enforce_url'] });
    expect(d.productionOnly).toEqual(['app.settings.moderation_enforce_url']);
  });

  it('flags a staging-only-by-design secret that turned up ON production', () => {
    // The dangerous direction, and the one a plain diff cannot see: it is not "missing"
    // anywhere, so nothing else would say a word about it.
    const d = diffSecrets({
      staging: ['app.settings.environment'],
      production: ['app.settings.environment'],
    });
    expect(d.unexpectedOnProduction).toEqual(['app.settings.environment']);
    expect(d.stagingOnly).toEqual([]);
  });

  it('takes the exception list as a parameter so the invariant is testable, not baked in', () => {
    const d = diffSecrets({ staging: ['x'], production: [], stagingOnlyByDesign: ['x'] });
    expect(d.stagingOnly).toEqual([]);
    expect(d.expectedStagingOnly).toEqual(['x']);
  });
});

describe('postureDrift', () => {
  const postures = new Map([
    ['score-engine', false],
    ['check-in', true],
  ]);

  it('reports a deployed verify_jwt that disagrees with config.toml', () => {
    const drift = postureDrift({
      postures,
      deployed: [{ slug: 'score-engine', verify_jwt: true }],
    });
    expect(drift).toEqual([{ slug: 'score-engine', declared: false, deployed: true }]);
  });

  it('says nothing when the deployed posture matches', () => {
    expect(postureDrift({ postures, deployed: [{ slug: 'check-in', verify_jwt: true }] })).toEqual(
      [],
    );
  });

  it('ignores a deployed slug config.toml does not declare — that is the orphan report’s job', () => {
    expect(postureDrift({ postures, deployed: [{ slug: 'ghost', verify_jwt: true }] })).toEqual([]);
  });
});

describe('formatAge', () => {
  const now = Date.UTC(2026, 7, 22, 12, 0, 0);
  const ago = (ms: number) => formatAge(now - ms, now);

  it('reads the clock from its argument, never from Date.now()', () => {
    // Same deploy, two clocks: the age moves with the argument, so nothing here reads Date.now().
    expect(formatAge(now - 30 * 60_000, now)).toBe('30m');
    expect(formatAge(now - 30 * 60_000, now + 60 * 60_000)).toBe('1h');
  });

  it('scales minutes → hours → days', () => {
    expect(ago(5 * 60_000)).toBe('5m');
    expect(ago(3 * 3_600_000)).toBe('3h');
    expect(ago(47 * 3_600_000)).toBe('47h');
    expect(ago(11 * 86_400_000)).toBe('11d');
  });

  it('does not print a negative age when a clock is skewed', () => {
    expect(formatAge(now + 60_000, now)).toBe('just now');
  });

  it('returns ? rather than NaN when the API omits updated_at', () => {
    expect(formatAge(undefined, now)).toBe('?');
    expect(formatAge('nope', now)).toBe('?');
    expect(formatAge(null, now)).toBe('?');
  });

  it('normalises the unit instead of trusting it', () => {
    // The age column is the report's only staleness signal, and #472 exists because a STALE
    // deploy failed silently. A seconds-valued `updated_at` would print `29000000d` and an ISO
    // string would print `?` on every row — both read as "nothing to see here".
    const threeDays = 3 * 86_400_000;
    expect(formatAge(now - threeDays, now)).toBe('3d');
    expect(formatAge((now - threeDays) / 1000, now)).toBe('3d');
    expect(formatAge(new Date(now - threeDays).toISOString(), now)).toBe('3d');
  });
});
