import { beforeEach, describe, expect, it, vi } from 'vitest';

// The route resolves both of these at module scope, so they must be mocked before the import.
const getWaitlistPage = vi.fn();
const createAuthedClient = vi.fn();

vi.mock('@athanor/api', () => ({ getWaitlistPage: (...a: unknown[]) => getWaitlistPage(...a) }));
vi.mock('@/utils/supabase/server', () => ({
  createAuthedClient: () => createAuthedClient(),
}));

const { GET } = await import('./route');

const HEADER = 'email,locale,source,created_at';

/** A client whose getUser() returns the given app_metadata role (undefined = signed out). */
const clientAs = (role?: string) => ({
  auth: {
    getUser: async () => ({
      data: { user: role === undefined ? null : { id: 'u1', app_metadata: { role } } },
      error: null,
    }),
  },
});

const row = (over: Record<string, unknown> = {}) => ({
  id: '10000000-0000-4000-8000-000000000001',
  email: 'a@b.it',
  locale: 'it',
  source: 'landing',
  created_at: '2026-01-01T00:00:00Z',
  ...over,
});

const page = (rows: unknown[], nextCursor: string | null = null, excluded = 0) => ({
  rows,
  excluded,
  nextCursor,
});

/** The common case: one page, no cursor. */
const onePage = (...rows: unknown[]) => getWaitlistPage.mockResolvedValue(page(rows));

beforeEach(() => {
  getWaitlistPage.mockReset();
  createAuthedClient.mockReset();
});

describe('GET /admin/waitlist/export — authorization', () => {
  it('refuses a signed-out caller with 403 and reads no rows', async () => {
    createAuthedClient.mockResolvedValue(clientAs(undefined));
    const res = await GET();
    expect(res.status).toBe(403);
    // The gate must precede the read: a 403 that still queried has already done the work.
    expect(getWaitlistPage).not.toHaveBeenCalled();
  });

  it('refuses an authenticated NON-admin with 403 and reads no rows', async () => {
    // The whole point of the defence-in-depth check — being signed in is not being an admin.
    createAuthedClient.mockResolvedValue(clientAs('member'));
    const res = await GET();
    expect(res.status).toBe(403);
    expect(getWaitlistPage).not.toHaveBeenCalled();
  });

  it('reads the role from app_metadata, never from user_metadata', async () => {
    // supabase.md: never authorize from user_metadata — it is user-writable.
    createAuthedClient.mockResolvedValue({
      auth: {
        async getUser() {
          return {
            data: { user: { id: 'u1', app_metadata: {}, user_metadata: { role: 'admin' } } },
            error: null,
          };
        },
      },
    });
    const res = await GET();
    expect(res.status).toBe(403);
    expect(getWaitlistPage).not.toHaveBeenCalled();
  });

  it('fails closed when getUser() itself errors (#62)', async () => {
    // An expired or malformed session comes back as { user: null, error }; no user is no admin.
    createAuthedClient.mockResolvedValue({
      auth: {
        async getUser() {
          return { data: { user: null }, error: { message: 'invalid JWT', status: 401 } };
        },
      },
    });
    const res = await GET();
    expect(res.status).toBe(403);
    expect(getWaitlistPage).not.toHaveBeenCalled();
  });

  it('serves the CSV to an admin', async () => {
    createAuthedClient.mockResolvedValue(clientAs('admin'));
    onePage(row());
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    expect(res.headers.get('Content-Disposition')).toContain('attachment');
  });
});

describe('GET /admin/waitlist/export — streaming the cursor walk (#335)', () => {
  beforeEach(() => createAuthedClient.mockResolvedValue(clientAs('admin')));

  it('walks the cursor one bounded page at a time and stitches the file in order', async () => {
    getWaitlistPage
      .mockResolvedValueOnce(page([row({ email: 'one@b.it' }), row({ email: 'two@b.it' })], 'c1'))
      .mockResolvedValueOnce(page([row({ email: 'three@b.it' })], null));

    const text = await (await GET()).text();

    expect(text.split('\r\n')).toEqual([
      HEADER,
      '"one@b.it","it","landing","2026-01-01T00:00:00Z"',
      '"two@b.it","it","landing","2026-01-01T00:00:00Z"',
      '"three@b.it","it","landing","2026-01-01T00:00:00Z"',
    ]);
    // Every page asks for the same bounded size; page two carries page one's cursor.
    expect(getWaitlistPage).toHaveBeenCalledTimes(2);
    expect(getWaitlistPage.mock.calls[0]![1]).toEqual({ limit: 500 });
    expect(getWaitlistPage.mock.calls[1]![1]).toEqual({ cursor: 'c1', limit: 500 });
  });

  it('never asks for the whole table: the page size stays well under the RPC clamp', async () => {
    onePage(row());
    await (await GET()).text();
    const { limit } = getWaitlistPage.mock.calls[0]![1] as { limit: number };
    expect(limit).toBeLessThan(1000);
  });

  it('reads the first page before answering, so a refused RPC is an error and not a truncated 200', async () => {
    getWaitlistPage.mockRejectedValue(Object.assign(new Error('not an admin'), { code: '42501' }));
    await expect(GET()).rejects.toThrow('not an admin');
  });

  it('a failure after the first page errors the stream rather than ending the file quietly', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    getWaitlistPage
      .mockResolvedValueOnce(page([row()], 'c1'))
      .mockRejectedValueOnce(new Error('connection reset'));

    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.text()).rejects.toThrow('connection reset');
    expect(error).toHaveBeenCalledWith(expect.stringContaining('mid-stream'), expect.any(Error));
    error.mockRestore();
  });

  it('an admin with an empty waitlist gets the header alone, not an error', async () => {
    onePage();
    expect(await (await GET()).text()).toBe(HEADER);
  });

  it('logs withheld rows instead of silently shortening the file', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    getWaitlistPage.mockResolvedValue(page([row()], null, 2));
    await (await GET()).text();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('2 row(s) withheld'));
    warn.mockRestore();
  });
});

describe('GET /admin/waitlist/export — CSV shape', () => {
  beforeEach(() => createAuthedClient.mockResolvedValue(clientAs('admin')));

  it('emits the header row and CRLF line endings (RFC 4180)', async () => {
    onePage(row());
    const text = await (await GET()).text();
    const [header, ...body] = text.split('\r\n');
    expect(header).toBe(HEADER);
    expect(body).toEqual(['"a@b.it","it","landing","2026-01-01T00:00:00Z"']);
  });

  it('renders a null source as an empty cell rather than the string "null"', async () => {
    onePage(row({ source: null }));
    const text = await (await GET()).text();
    expect(text.split('\r\n')[1]).toBe('"a@b.it","it","","2026-01-01T00:00:00Z"');
  });

  it('escapes embedded quotes by doubling them', async () => {
    onePage(row({ source: 'the "big" one' }));
    const text = await (await GET()).text();
    expect(text.split('\r\n')[1]).toContain('"the ""big"" one"');
  });

  it('an embedded comma cannot add a column', async () => {
    onePage(row({ source: 'a,b,c' }));
    const text = await (await GET()).text();
    // Quoted, so the row still has exactly four fields.
    expect(text.split('\r\n')[1]).toBe('"a@b.it","it","a,b,c","2026-01-01T00:00:00Z"');
  });

  it('never writes the row id into the file — it is a cursor, not an export column', async () => {
    onePage(row());
    const text = await (await GET()).text();
    expect(text).not.toContain('10000000-0000-4000-8000-000000000001');
  });
});

describe('GET /admin/waitlist/export — formula injection', () => {
  beforeEach(() => createAuthedClient.mockResolvedValue(clientAs('admin')));

  // A waitlist email is attacker-supplied and this CSV is opened in Excel/Sheets by an
  // operator. A cell starting with any of these is executed as a formula, so it is prefixed
  // with an apostrophe and rendered as text.
  it.each(['=cmd|calc', '+1+1', '-1+1', '@SUM(A1)', '\tlead', '\rlead'])(
    'neutralizes a cell starting with %j',
    async (payload) => {
      onePage(row({ source: payload }));
      const text = await (await GET()).text();
      const cell = text.split('\r\n')[1]!.split(',').slice(2).join(',');
      expect(cell.startsWith(`"'${payload[0]}`)).toBe(true);
    },
  );

  it('neutralizes the email column too, not only source', async () => {
    // The email is the field an outsider actually controls.
    onePage(row({ email: '=HYPERLINK("http://x","clickme")' }));
    const text = await (await GET()).text();
    expect(text.split('\r\n')[1]!.startsWith(`"'=HYPERLINK`)).toBe(true);
  });

  it('leaves an ordinary value unprefixed', async () => {
    // The guard must not corrupt normal data — an apostrophe on every cell would.
    onePage(row({ source: 'landing' }));
    const text = await (await GET()).text();
    expect(text).toContain('"landing"');
    expect(text).not.toContain(`"'landing"`);
  });
});
