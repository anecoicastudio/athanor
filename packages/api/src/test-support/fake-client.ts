// TEST-ONLY fake of the PostgREST surface this package calls. One implementation, so a
// change to the shape is made once rather than in the fifteen hand-rolled copies this
// replaces — each of which hardcoded `error: null`, leaving 36 of 38 test files unable to
// express a database failure at all.
//
// Counterpart of supabase/functions/_shared/fake-db.ts, which does the same job for the
// Deno edge functions. Keep the two in step: same call record, same FIFO scripting.

export type FakeResult = {
  data?: unknown;
  error?: unknown;
  count?: number | null;
};

export type FakeCall = {
  /** table name, or 'rpc' */
  table: string;
  op: 'select' | 'upsert' | 'update' | 'insert' | 'delete' | 'rpc';
  /** upsert/update/insert values, or rpc args */
  values?: unknown;
  /** upsert options ({ onConflict, ignoreDuplicates, count }) or select options ({ count, head }) */
  options?: unknown;
  /** select() columns, or rpc name */
  columns?: string;
  /** accumulated filters, e.g. [['eq','post_id','p1'], ['is','deleted_at',null]] */
  filters: unknown[][];
  /** order()/limit()/range() modifiers */
  modifiers: unknown[][];
  terminal?: 'single' | 'maybeSingle';
};

/** PostgREST's own code for "single()/maybeSingle() did not match exactly one row". */
const rowCountError = (rows: number) => ({
  code: 'PGRST116',
  message: 'JSON object requested, multiple (or no) rows returned',
  details: `The result contains ${rows} rows`,
  hint: null,
});

export function makeFakeClient(script: Record<string, FakeResult[]> = {}) {
  const calls: FakeCall[] = [];

  const result = (key: string, call: FakeCall): FakeResult => {
    const scripted = script[key]?.shift();
    const base: FakeResult = { data: null, error: null, count: null, ...(scripted ?? {}) };

    if (!call.terminal) return base;
    if (base.error) return base; // a scripted failure wins over any row-count rule

    // `single()` and `maybeSingle()` are NOT interchangeable, and the copies this replaces
    // treated them as identical (`rows[0] ?? null` for both). Real PostgREST:
    //   0 rows  → single() errors PGRST116, maybeSingle() returns null
    //   1 row   → both return the row
    //   >1 rows → BOTH error PGRST116
    // An unscripted call is 0 rows, not "success with null" — otherwise a handler whose
    // "row missing ⇒ throw" contract is broken passes whenever the author forgets to script
    // `data: []`. A scripted object (not array) counts as the one row it obviously is.
    const rows = Array.isArray(base.data) ? base.data : base.data == null ? [] : [base.data];
    if (rows.length === 1) return { ...base, data: rows[0] };
    if (rows.length === 0 && call.terminal === 'maybeSingle') {
      return { data: null, error: null, count: base.count ?? null };
    }
    return { data: null, error: rowCountError(rows.length), count: base.count ?? null };
  };

  function builder(init: Partial<FakeCall> & { table: string }, keyOverride?: string) {
    const call: FakeCall = { op: 'select', filters: [], modifiers: [], ...init };
    let opSet = init.op !== undefined;
    const setOp = (op: FakeCall['op']) => {
      if (!opSet) {
        call.op = op;
        opSet = true;
      }
    };
    const filter = (name: string) => (col: string, val: unknown) => {
      call.filters.push([name, col, val]);
      return b;
    };
    const modifier =
      (name: string) =>
      (...args: unknown[]) => {
        call.modifiers.push([name, ...args]);
        return b;
      };

    const b = {
      upsert(values: unknown, options?: unknown) {
        setOp('upsert');
        call.values = values;
        call.options = options;
        return b;
      },
      update(values: unknown) {
        setOp('update');
        call.values = values;
        return b;
      },
      insert(values: unknown) {
        setOp('insert');
        call.values = values;
        return b;
      },
      delete() {
        setOp('delete');
        return b;
      },
      select(columns?: string, options?: unknown) {
        setOp('select'); // no-op after a write op; columns are still recorded
        call.columns = columns;
        if (options !== undefined) call.options = options;
        return b;
      },
      eq: filter('eq'),
      neq: filter('neq'),
      is: filter('is'),
      lt: filter('lt'),
      lte: filter('lte'),
      gt: filter('gt'),
      gte: filter('gte'),
      in: filter('in'),
      like: filter('like'),
      ilike: filter('ilike'),
      contains: filter('contains'),
      overlaps: filter('overlaps'),
      textSearch: filter('textSearch'),
      match(query: unknown) {
        call.filters.push(['match', query]);
        return b;
      },
      not(col: string, operator: string, val: unknown) {
        call.filters.push(['not', col, operator, val]);
        return b;
      },
      or(expr: string) {
        call.filters.push(['or', expr]);
        return b;
      },
      order: modifier('order'),
      limit: modifier('limit'),
      // Recorded so a test can assert rule 9 — cursor pagination, never offset.
      range: modifier('range'),
      single() {
        call.terminal = 'single';
        return b;
      },
      maybeSingle() {
        call.terminal = 'maybeSingle';
        return b;
      },
      then(
        resolve: (v: FakeResult) => unknown,
        reject?: (e: unknown) => unknown,
      ): Promise<unknown> {
        calls.push(call);
        return Promise.resolve(result(keyOverride ?? `${call.table}.${call.op}`, call)).then(
          resolve,
          reject,
        );
      },
    };
    return b;
  }

  type ChannelRecord = {
    name: string;
    events: unknown[][];
    subscribed: boolean;
    removed: boolean;
  };
  const channels: ChannelRecord[] = [];
  const handles = new WeakMap<object, ChannelRecord>();

  return {
    calls,
    channels,
    from: (table: string) => builder({ table }),
    // Chainable, because callers do `client.rpc(...).maybeSingle()` (profiles.ts:25,39,81,
    // notificationPreferences.ts:42). Returning a bare Promise forced those tests to hand-roll
    // a stub that hardcoded `error: null` — the exact defect this fake exists to remove.
    rpc: (name: string, args?: unknown) =>
      builder({ table: 'rpc', op: 'rpc', values: args, columns: name }, `rpc.${name}`),
    auth: {
      getUser: () =>
        Promise.resolve(
          script['auth.getUser']?.shift() ?? { data: { user: { id: 'prof-1' } }, error: null },
        ),
    },
    storage: {
      from: (bucket: string) => ({
        upload: (path: string, body: unknown, options?: unknown) => {
          calls.push({
            table: `storage.${bucket}`,
            op: 'insert',
            values: { path, body, options },
            filters: [],
            modifiers: [],
          });
          return Promise.resolve(
            result(`storage.${bucket}.upload`, {
              table: bucket,
              op: 'insert',
              filters: [],
              modifiers: [],
            }),
          );
        },
        createSignedUrl: (path: string, expiresIn: number) => {
          calls.push({
            table: `storage.${bucket}`,
            op: 'select',
            values: { path, expiresIn },
            filters: [],
            modifiers: [],
          });
          return Promise.resolve(
            result(`storage.${bucket}.createSignedUrl`, {
              table: bucket,
              op: 'select',
              filters: [],
              modifiers: [],
            }),
          );
        },
      }),
    },
    // Realtime: records the channel so a test can assert `.claude/rules/api.md`'s requirement
    // that every subscription hands back a working cleanup function.
    channel(name: string) {
      const entry = { name, events: [] as unknown[][], subscribed: false, removed: false };
      channels.push(entry);
      const ch = {
        on(...args: unknown[]) {
          entry.events.push(args);
          return ch;
        },
        subscribe(cb?: (status: string) => void) {
          entry.subscribed = true;
          cb?.('SUBSCRIBED');
          return ch;
        },
      };
      // The handle handed to callers is not the record we keep, so identity has to be mapped
      // rather than searched for. Falling back to "the last channel" would let a test that
      // asserts WHICH channel was removed pass against a cleanup that removed the wrong one.
      handles.set(ch, entry);
      return ch;
    },
    removeChannel(ch: unknown) {
      const entry = handles.get(ch as object);
      if (!entry) throw new Error('removeChannel called with a channel this client never created');
      entry.removed = true;
      return Promise.resolve('ok');
    },
  };
}

export type FakeClient = ReturnType<typeof makeFakeClient>;
