import { beforeEach, describe, expect, it, vi } from 'vitest';

// The route resolves both of these at module scope, so they must be mocked before the import.
const getWaitlistRows = vi.fn();
const createAuthedClient = vi.fn();

vi.mock('@athanor/api', () => ({ getWaitlistRows: (...a: unknown[]) => getWaitlistRows(...a) }));
vi.mock('@/utils/supabase/server', () => ({
  createAuthedClient: () => createAuthedClient(),
}));

const { GET } = await import('./route');

/** A client whose getUser() returns the given app_metadata role (undefined = signed out). */
const clientAs = (role?: string) => ({
  auth: {
    getUser: async () => ({
      data: { user: role === undefined ? null : { id: 'u1', app_metadata: { role } } },
    }),
  },
});

const row = (over: Record<string, unknown> = {}) => ({
  email: 'a@b.it',
  locale: 'it',
  source: 'landing',
  created_at: '2026-01-01T00:00:00Z',
  ...over,
});

beforeEach(() => {
  getWaitlistRows.mockReset();
  createAuthedClient.mockReset();
});

describe('GET /admin/waitlist/export — authorization', () => {
  it('refuses a signed-out caller with 403 and reads no rows', async () => {
    createAuthedClient.mockResolvedValue(clientAs(undefined));
    const res = await GET();
    expect(res.status).toBe(403);
    // The gate must precede the read: a 403 that still queried has already done the work.
    expect(getWaitlistRows).not.toHaveBeenCalled();
  });

  it('refuses an authenticated NON-admin with 403 and reads no rows', async () => {
    // The whole point of the defence-in-depth check — being signed in is not being an admin.
    createAuthedClient.mockResolvedValue(clientAs('member'));
    const res = await GET();
    expect(res.status).toBe(403);
    expect(getWaitlistRows).not.toHaveBeenCalled();
  });

  it('reads the role from app_metadata, never from user_metadata', async () => {
    // supabase.md: never authorize from user_metadata — it is user-writable.
    createAuthedClient.mockResolvedValue({
      auth: {
        async getUser() {
          return {
            data: { user: { id: 'u1', app_metadata: {}, user_metadata: { role: 'admin' } } },
          };
        },
      },
    });
    const res = await GET();
    expect(res.status).toBe(403);
    expect(getWaitlistRows).not.toHaveBeenCalled();
  });

  it('serves the CSV to an admin', async () => {
    createAuthedClient.mockResolvedValue(clientAs('admin'));
    getWaitlistRows.mockResolvedValue([row()]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    expect(res.headers.get('Content-Disposition')).toContain('attachment');
  });
});

describe('GET /admin/waitlist/export — CSV shape', () => {
  beforeEach(() => createAuthedClient.mockResolvedValue(clientAs('admin')));

  it('emits the header row and CRLF line endings (RFC 4180)', async () => {
    getWaitlistRows.mockResolvedValue([row()]);
    const text = await (await GET()).text();
    const [header, ...body] = text.split('\r\n');
    expect(header).toBe('email,locale,source,created_at');
    expect(body).toEqual(['"a@b.it","it","landing","2026-01-01T00:00:00Z"']);
  });

  it('renders a null source as an empty cell rather than the string "null"', async () => {
    getWaitlistRows.mockResolvedValue([row({ source: null })]);
    const text = await (await GET()).text();
    expect(text.split('\r\n')[1]).toBe('"a@b.it","it","","2026-01-01T00:00:00Z"');
  });

  it('escapes embedded quotes by doubling them', async () => {
    getWaitlistRows.mockResolvedValue([row({ source: 'the "big" one' })]);
    const text = await (await GET()).text();
    expect(text.split('\r\n')[1]).toContain('"the ""big"" one"');
  });

  it('an embedded comma cannot add a column', async () => {
    getWaitlistRows.mockResolvedValue([row({ source: 'a,b,c' })]);
    const text = await (await GET()).text();
    // Quoted, so the row still has exactly four fields.
    expect(text.split('\r\n')[1]).toBe('"a@b.it","it","a,b,c","2026-01-01T00:00:00Z"');
  });

  it('an admin with an empty waitlist gets the header alone, not an error', async () => {
    getWaitlistRows.mockResolvedValue([]);
    expect(await (await GET()).text()).toBe('email,locale,source,created_at');
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
      getWaitlistRows.mockResolvedValue([row({ source: payload })]);
      const text = await (await GET()).text();
      const cell = text.split('\r\n')[1]!.split(',').slice(2).join(',');
      expect(cell.startsWith(`"'${payload[0]}`)).toBe(true);
    },
  );

  it('neutralizes the email column too, not only source', async () => {
    // The email is the field an outsider actually controls.
    getWaitlistRows.mockResolvedValue([row({ email: '=HYPERLINK("http://x","clickme")' })]);
    const text = await (await GET()).text();
    expect(text.split('\r\n')[1]!.startsWith(`"'=HYPERLINK`)).toBe(true);
  });

  it('leaves an ordinary value unprefixed', async () => {
    // The guard must not corrupt normal data — an apostrophe on every cell would.
    getWaitlistRows.mockResolvedValue([row({ source: 'landing' })]);
    const text = await (await GET()).text();
    expect(text).toContain('"landing"');
    expect(text).not.toContain(`"'landing"`);
  });
});
