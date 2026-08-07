// TEST-ONLY fake of the PostgREST client surface the edge handlers use.
// Mirrors the hand-rolled thenable-builder pattern from packages/api tests
// (see packages/api/src/moments.test.ts): each chain records its call and,
// when awaited, resolves the next scripted result for its `<table>.<op>` key.
// Never import this from an index.ts — deploys bundle from the entrypoint,
// so this file ships nowhere.

export type FakeResult = {
  data?: unknown;
  error?: unknown;
  count?: number | null;
};

export type FakeCall = {
  table: string; // table name, or 'rpc'
  op: 'select' | 'upsert' | 'update' | 'insert' | 'delete' | 'rpc';
  /** upsert/update/insert values, or rpc args */
  values?: unknown;
  /** upsert options ({ onConflict, ignoreDuplicates, count }) or select options ({ count, head }) */
  options?: unknown;
  /** select() columns, or rpc name */
  columns?: string;
  /** accumulated filters, e.g. [['eq','event_id','evt_1'], ['is','deleted_at',null]] */
  filters: unknown[][];
  /** order()/limit() modifiers, e.g. [['order','created_at',{ascending:false}], ['limit',20]] */
  modifiers: unknown[][];
  terminal?: 'single' | 'maybeSingle';
};

/**
 * makeFakeDb({ 'event_tickets.upsert': [{ error: null }], 'rpc.recompute_fund_aggregate': [{}] })
 * Results are consumed FIFO per key; an unscripted await resolves { data: null, error: null, count: null }.
 * Assert behavior via `db.calls`.
 */
export function makeFakeDb(script: Record<string, FakeResult[]> = {}) {
  const calls: FakeCall[] = [];
  const result = (key: string): FakeResult => ({
    data: null,
    error: null,
    count: null,
    ...(script[key]?.shift() ?? {}),
  });

  function builder(table: string) {
    const call: FakeCall = { table, op: 'select', filters: [], modifiers: [] };
    let opSet = false;
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
        setOp('select'); // no-op when chained after a write op (columns still recorded)
        call.columns = columns;
        if (options !== undefined) call.options = options;
        return b;
      },
      eq: filter('eq'),
      is: filter('is'),
      neq: filter('neq'),
      lt: filter('lt'),
      lte: filter('lte'),
      gt: filter('gt'),
      gte: filter('gte'),
      in: filter('in'),
      not(col: string, operator: string, val: unknown) {
        call.filters.push(['not', col, operator, val]);
        return b;
      },
      or(expr: string) {
        call.filters.push(['or', expr]);
        return b;
      },
      order(col: string, opts?: unknown) {
        call.modifiers.push(['order', col, opts]);
        return b;
      },
      limit(n: number) {
        call.modifiers.push(['limit', n]);
        return b;
      },
      single() {
        call.terminal = 'single';
        return b;
      },
      maybeSingle() {
        call.terminal = 'maybeSingle';
        return b;
      },
      // Thenable: awaiting the chain records the call and yields the scripted result.
      then(
        resolve: (v: FakeResult) => unknown,
        reject?: (e: unknown) => unknown,
      ): Promise<unknown> {
        calls.push(call);
        return Promise.resolve(result(`${call.table}.${call.op}`)).then(resolve, reject);
      },
    };
    return b;
  }

  return {
    calls,
    from: (table: string) => builder(table),
    rpc(name: string, args?: unknown): Promise<FakeResult> {
      calls.push({
        table: 'rpc',
        op: 'rpc',
        values: args,
        columns: name,
        filters: [],
        modifiers: [],
      });
      return Promise.resolve(result(`rpc.${name}`));
    },
  };
}

export type FakeDb = ReturnType<typeof makeFakeDb>;
