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
  op: 'select' | 'upsert' | 'update' | 'rpc';
  /** upsert/update values, or rpc args */
  values?: unknown;
  /** upsert options ({ onConflict, ignoreDuplicates, count }) */
  options?: unknown;
  /** select() columns, or rpc name */
  columns?: string;
  /** accumulated filters, e.g. [['eq','event_id','evt_1'], ['is','deleted_at',null]] */
  filters: unknown[][];
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
    const call: FakeCall = { table, op: 'select', filters: [] };
    let opSet = false;
    const setOp = (op: FakeCall['op']) => {
      if (!opSet) {
        call.op = op;
        opSet = true;
      }
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
      select(columns?: string) {
        setOp('select'); // no-op when chained after upsert/update (columns still recorded)
        call.columns = columns;
        return b;
      },
      eq(col: string, val: unknown) {
        call.filters.push(['eq', col, val]);
        return b;
      },
      is(col: string, val: unknown) {
        call.filters.push(['is', col, val]);
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
      calls.push({ table: 'rpc', op: 'rpc', values: args, columns: name, filters: [] });
      return Promise.resolve(result(`rpc.${name}`));
    },
  };
}

export type FakeDb = ReturnType<typeof makeFakeDb>;
