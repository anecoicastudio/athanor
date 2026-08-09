import { describe, expect, it } from 'vitest';
import type { AthanorClient } from './client';
import { asClient, DB_DOWN, makeFakeClient } from './test-support/fake-client';
import {
  createProject,
  editProject,
  getProject,
  getProjectsPage,
  projectKeys,
  setProjectStatus,
} from './projects';

const AUTHOR = '00000000-0000-4000-8000-000000000001';
const P1 = '00000000-0000-4000-8000-0000000000d1';
const P2 = '00000000-0000-4000-8000-0000000000d2';

const PROJECT_ROW = {
  id: P1,
  author_id: AUTHOR,
  title: 'Coro di quartiere',
  category: 'artistic' as const,
  description: '',
  terms: null,
  status: 'open' as const,
  created_at: '2026-07-02T00:00:00Z',
  updated_at: '2026-07-02T00:00:00Z',
  deleted_at: null,
};

/** Thenable PostgREST-builder stub: records calls; awaiting resolves to { data, error }. */
function stub(rows: Array<Record<string, unknown>> = []) {
  const calls: Array<{ method: string; arg: unknown; arg2?: unknown }> = [];
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'insert', 'update', 'order', 'limit', 'or']) {
    chain[m] = (arg?: unknown, arg2?: unknown) => {
      calls.push({ method: m, arg, arg2 });
      return chain;
    };
  }
  chain['eq'] = (col: unknown, val?: unknown) => {
    calls.push({ method: 'eq', arg: col, arg2: val });
    return chain;
  };
  chain['is'] = (col: unknown, val?: unknown) => {
    calls.push({ method: 'is', arg: col, arg2: val });
    return chain;
  };
  chain['single'] = () => {
    calls.push({ method: 'single', arg: undefined });
    return {
      then: (resolve: (v: { data: unknown; error: null }) => void) =>
        resolve({ data: rows[0] ?? null, error: null }),
    };
  };
  chain['maybeSingle'] = () => {
    calls.push({ method: 'maybeSingle', arg: undefined });
    return {
      then: (resolve: (v: { data: unknown; error: null }) => void) =>
        resolve({ data: rows[0] ?? null, error: null }),
    };
  };
  chain.then = (resolve: (v: { data: unknown; error: null }) => void) =>
    resolve({ data: rows, error: null });
  const client = {
    from: (table: string) => {
      calls.push({ method: 'from', arg: table });
      return chain;
    },
  } as unknown as AthanorClient;
  return { client, calls };
}

describe('projectKeys', () => {
  it('namespaces list-by-category and detail under the projects root', () => {
    expect(projectKeys.all).toEqual(['projects']);
    expect(projectKeys.list('all')).toEqual(['projects', 'list', 'all']);
    expect(projectKeys.list('artistic')).toEqual(['projects', 'list', 'artistic']);
    expect(projectKeys.detail(P1)).toEqual(['projects', 'detail', P1]);
  });
});

describe('getProjectsPage', () => {
  it('category "all" spans every category — no eq(category) filter', async () => {
    const { client, calls } = stub([]);
    await getProjectsPage(client, { category: 'all' });
    expect(calls.some((c) => c.method === 'eq' && c.arg === 'category')).toBe(false);
    expect(calls.some((c) => c.method === 'is' && c.arg === 'deleted_at' && c.arg2 === null)).toBe(
      true,
    );
    expect(calls.filter((c) => c.method === 'order').map((c) => c.arg)).toEqual([
      'created_at',
      'id',
    ]);
  });

  it('a concrete category adds the eq(category) filter', async () => {
    const { client, calls } = stub([]);
    await getProjectsPage(client, { category: 'artistic' });
    expect(
      calls.some((c) => c.method === 'eq' && c.arg === 'category' && c.arg2 === 'artistic'),
    ).toBe(true);
  });

  it('applies the (created_at, id) lt or-cursor when provided — never offset', async () => {
    const cursor = { created_at: '2026-07-03T00:00:00Z', id: P1 };
    const { client, calls } = stub([]);
    await getProjectsPage(client, { category: 'all', cursor });
    const orCall = calls.find((c) => c.method === 'or');
    expect(orCall?.arg).toContain(`created_at.lt.${cursor.created_at}`);
    expect(orCall?.arg).toContain(`id.lt.${cursor.id}`);
  });

  it('full page → nextCursor from the last row; short page → null', async () => {
    const second = { ...PROJECT_ROW, id: P2, created_at: '2026-07-01T00:00:00Z' };
    const full = stub([PROJECT_ROW, second]);
    const fullPage = await getProjectsPage(full.client, { category: 'all', limit: 2 });
    expect(fullPage.projects).toHaveLength(2);
    expect(fullPage.nextCursor).toEqual({ created_at: '2026-07-01T00:00:00Z', id: P2 });

    const short = stub([PROJECT_ROW]);
    const shortPage = await getProjectsPage(short.client, { category: 'all', limit: 2 });
    expect(shortPage.nextCursor).toBeNull();
  });
});

describe('createProject', () => {
  it('rejects a blank title at the Zod boundary without touching from()', async () => {
    const { client, calls } = stub([PROJECT_ROW]);
    await expect(
      // description/terms carry schema defaults — omitted here on purpose, so the
      // input is the shape a caller actually writes, not the parsed one.
      createProject(client, {
        author_id: AUTHOR,
        category: 'artistic',
        title: '   ',
      } as Parameters<typeof createProject>[1]),
    ).rejects.toThrow();
    expect(calls.some((c) => c.method === 'from')).toBe(false);
  });

  it('rejects a payload missing required fields (author_id / category / title)', async () => {
    const { client, calls } = stub([PROJECT_ROW]);
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createProject(client, { title: 'Coro di quartiere' } as any),
    ).rejects.toThrow();
    expect(calls.some((c) => c.method === 'from')).toBe(false);
  });

  it('parses the insert (defaults description/terms), returns the parsed row', async () => {
    const { client, calls } = stub([PROJECT_ROW]);
    const created = await createProject(client, {
      author_id: AUTHOR,
      category: 'artistic',
      title: 'Coro di quartiere',
    } as Parameters<typeof createProject>[1]);
    const insert = calls.find((c) => c.method === 'insert');
    expect(insert?.arg).toEqual({
      author_id: AUTHOR,
      category: 'artistic',
      title: 'Coro di quartiere',
      description: '',
      terms: null,
    });
    expect(created.id).toBe(P1);
    expect(created.status).toBe('open');
  });
});

describe('editProject', () => {
  it('updates the parsed patch scoped by id and not soft-deleted', async () => {
    const { client, calls } = stub([{ ...PROJECT_ROW, title: 'Coro nuovo' }]);
    const updated = await editProject(client, P1, { title: 'Coro nuovo' });
    const update = calls.find((c) => c.method === 'update');
    expect(update?.arg).toEqual({ title: 'Coro nuovo' });
    expect(calls.some((c) => c.method === 'eq' && c.arg === 'id' && c.arg2 === P1)).toBe(true);
    expect(calls.some((c) => c.method === 'is' && c.arg === 'deleted_at' && c.arg2 === null)).toBe(
      true,
    );
    expect(updated.title).toBe('Coro nuovo');
  });
});

describe('setProjectStatus', () => {
  it('updates only the status, scoped by id and not soft-deleted', async () => {
    const { client, calls } = stub();
    await setProjectStatus(client, P1, 'closed');
    const update = calls.find((c) => c.method === 'update');
    expect(update?.arg).toEqual({ status: 'closed' });
    expect(calls.some((c) => c.method === 'eq' && c.arg === 'id' && c.arg2 === P1)).toBe(true);
    expect(calls.some((c) => c.method === 'is' && c.arg === 'deleted_at' && c.arg2 === null)).toBe(
      true,
    );
  });
});

describe('getProject', () => {
  it('reads by id excluding soft-deleted via maybeSingle', async () => {
    const { client, calls } = stub([PROJECT_ROW]);
    const project = await getProject(client, P1);
    expect(calls.some((c) => c.method === 'eq' && c.arg === 'id' && c.arg2 === P1)).toBe(true);
    expect(calls.some((c) => c.method === 'is' && c.arg === 'deleted_at' && c.arg2 === null)).toBe(
      true,
    );
    expect(calls.some((c) => c.method === 'maybeSingle')).toBe(true);
    expect(project?.id).toBe(P1);
  });

  it('passes null through when the row is missing or soft-deleted', async () => {
    const { client } = stub([]);
    expect(await getProject(client, P1)).toBeNull();
  });
});

// The `stub()` above hardcodes `error: null`, so no test in this file could express a database
// failure — every `if (error) throw error` arm was unreachable. `makeFakeClient` exists to fix
// exactly that (it replaced fifteen such copies); these use it rather than teaching the local
// stub a new trick.

describe('projects — every write and read surfaces a database failure', () => {
  // These must THROW rather than resolve to an empty page or a null project. A board that
  // renders "no projects yet" when the database is unreachable is indistinguishable from a
  // board that is genuinely empty, and the caller can never show a retry.
  it('getProjectsPage rethrows instead of returning an empty page', async () => {
    const fake = makeFakeClient({ 'projects.select': [{ error: DB_DOWN }] });
    await expect(getProjectsPage(asClient(fake), { category: 'all' })).rejects.toMatchObject({
      code: '57P01',
    });
  });

  it('getProject rethrows instead of reporting the project missing', async () => {
    const fake = makeFakeClient({ 'projects.select': [{ error: DB_DOWN }] });
    await expect(getProject(asClient(fake), P1)).rejects.toMatchObject({ code: '57P01' });
  });

  it('createProject rethrows so the composer can keep the draft', async () => {
    const fake = makeFakeClient({ 'projects.insert': [{ error: DB_DOWN }] });
    await expect(
      createProject(asClient(fake), {
        author_id: AUTHOR,
        title: 'Coro di quartiere',
        category: 'artistic',
        description: '',
        terms: null,
      }),
    ).rejects.toMatchObject({ code: '57P01' });
  });

  it('editProject rethrows', async () => {
    const fake = makeFakeClient({ 'projects.update': [{ error: DB_DOWN }] });
    await expect(editProject(asClient(fake), P1, { title: 'nuovo' })).rejects.toMatchObject({
      code: '57P01',
    });
  });

  it('setProjectStatus rethrows rather than reporting a silent success', async () => {
    const fake = makeFakeClient({ 'projects.update': [{ error: DB_DOWN }] });
    await expect(setProjectStatus(asClient(fake), P1, 'closed')).rejects.toMatchObject({
      code: '57P01',
    });
  });

  // Not a response PostgREST can send — a zero-match list select returns [], and after the
  // rethrow above TypeScript has already narrowed `data` to T[]. The `?? []` is a belt-and-braces
  // guard, and this pins it so a "simplification" that removes it fails rather than passing.
  // `?? []` arm is what keeps that from becoming a TypeError on `.map`.
  it('getProjectsPage treats a null payload as an empty page, not a crash', async () => {
    const fake = makeFakeClient({ 'projects.select': [{ data: null }] });
    await expect(getProjectsPage(asClient(fake), { category: 'all' })).resolves.toEqual({
      projects: [],
      nextCursor: null,
    });
  });
});
