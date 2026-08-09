import { describe, expect, it } from 'vitest';
import type { AthanorClient } from './client';
import {
  confirmHelpComplete,
  helpKeys,
  listIncomingHelps,
  listMyHelps,
  listMyHelpsForMilestones,
  offerHelp,
  respondToHelp,
} from './helps';
import { makeFakeClient, type FakeResult } from './test-support/fake-client';

const HELPER = '11111111-1111-4111-8111-111111111111';
const MILESTONE = '55555555-5555-4555-8555-555555555555';
const HELP = '66666666-6666-4666-8666-666666666666';
const HELP_2 = '77777777-7777-4777-8777-777777777777';

const db = (script: Record<string, FakeResult[]> = {}) => {
  const fake = makeFakeClient(script);
  return { fake, client: fake as unknown as AthanorClient };
};

const helpRow = (over: Record<string, unknown> = {}) => ({
  id: HELP,
  milestone_id: MILESTONE,
  helper_id: HELPER,
  type: 'skill',
  message: null,
  link: null,
  status: 'offered',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  deleted_at: null,
  ...over,
});

describe('helpKeys', () => {
  it('namespaces incoming + mine distinctly', () => {
    expect(helpKeys.incoming('p1')).toEqual(['milestoneHelps', 'incoming', 'p1']);
    expect(helpKeys.mine('h1')).toEqual(['milestoneHelps', 'mine', 'h1']);
    expect(helpKeys.all).toEqual(['milestoneHelps']);
  });
});

describe('offerHelp', () => {
  it('validates before touching the database', async () => {
    const badMilestone = db();
    await expect(
      offerHelp(badMilestone.client, HELPER, { milestone_id: 'nope', type: 'skill' }),
    ).rejects.toThrow();
    expect(badMilestone.fake.calls).toEqual([]);

    const badLink = db();
    await expect(
      offerHelp(badLink.client, HELPER, {
        milestone_id: MILESTONE,
        type: 'skill',
        link: 'javascript:alert(1)',
      }),
    ).rejects.toThrow();
    expect(badLink.fake.calls).toEqual([]);
  });

  it('writes only the helper-writable columns — status and id stay server-owned', async () => {
    const { fake, client } = db();
    await offerHelp(client, HELPER, {
      milestone_id: MILESTONE,
      type: 'skill',
      message: 'posso aiutarti',
    });

    const call = fake.calls[0]!;
    expect(call.table).toBe('milestone_helps');
    expect(call.op).toBe('insert');
    expect(call.values).toEqual({
      milestone_id: MILESTONE,
      helper_id: HELPER,
      type: 'skill',
      message: 'posso aiutarti',
      link: null,
    });
    // the DB defaults status to 'offered' and the insert policy pins it there
    expect(Object.keys(call.values as object)).not.toContain('status');
    expect(Object.keys(call.values as object)).not.toContain('id');
    expect(Object.keys(call.values as object)).not.toContain('created_at');
  });

  it('takes helper_id from the caller, ignoring one smuggled into the payload', async () => {
    const { fake, client } = db();
    await offerHelp(client, HELPER, {
      helper_id: MILESTONE,
      status: 'completed',
      milestone_id: MILESTONE,
      type: 'connection',
    } as never);

    const values = fake.calls[0]!.values as Record<string, unknown>;
    expect(values.helper_id).toBe(HELPER);
    expect(values).not.toHaveProperty('status');
  });

  it('never writes an aura row (rule #1)', async () => {
    const { fake, client } = db();
    await offerHelp(client, HELPER, { milestone_id: MILESTONE, type: 'opportunity' });
    expect(fake.calls.every((c) => !c.table.startsWith('aura'))).toBe(true);
  });

  it('surfaces the unique-violation on a second offer for the same tappa', async () => {
    const { client } = db({
      'milestone_helps.insert': [{ error: { code: '23505', message: 'duplicate key' } }],
    });
    await expect(
      offerHelp(client, HELPER, { milestone_id: MILESTONE, type: 'skill' }),
    ).rejects.toThrow('duplicate key');
  });
});

describe('respondToHelp', () => {
  it('sends status alone, scoped to a live row', async () => {
    const { fake, client } = db();
    await respondToHelp(client, HELP, 'accepted');

    const call = fake.calls[0]!;
    expect(call.table).toBe('milestone_helps');
    expect(call.op).toBe('update');
    expect(call.values).toEqual({ status: 'accepted' });
    expect(call.filters).toEqual([
      ['eq', 'id', HELP],
      ['is', 'deleted_at', null],
    ]);
  });

  it('never re-sends the columns the owner may not change', async () => {
    const { fake, client } = db();
    await respondToHelp(client, HELP, 'declined');
    const values = fake.calls[0]!.values as Record<string, unknown>;
    for (const locked of ['helper_id', 'milestone_id', 'type', 'message', 'link', 'updated_at']) {
      expect(values).not.toHaveProperty(locked);
    }
  });

  it('surfaces an illegal-transition error from the guard', async () => {
    const { client } = db({
      'milestone_helps.update': [{ error: { code: '23514', message: 'illegal help status' } }],
    });
    await expect(respondToHelp(client, HELP, 'accepted')).rejects.toThrow('illegal help status');
  });
});

describe('confirmHelpComplete', () => {
  it('delegates to the atomic rpc and makes no table write of its own', async () => {
    const { fake, client } = db();
    await confirmHelpComplete(client, HELP);

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({
      table: 'rpc',
      op: 'rpc',
      columns: 'confirm_milestone_help',
      values: { p_help_id: HELP },
    });
    // the milestone id is derived server-side from the help — never passed by the client
    expect(fake.calls[0]!.values).not.toHaveProperty('p_milestone_id');
  });

  it('never writes an aura row for the +40/+10 event (rule #1)', async () => {
    const { fake, client } = db();
    await confirmHelpComplete(client, HELP);
    expect(fake.calls.every((c) => !c.table.startsWith('aura'))).toBe(true);
  });

  it('surfaces the rpc error when the help is not visible', async () => {
    const { client } = db({
      'rpc.confirm_milestone_help': [{ error: { code: 'P0002', message: 'help not found' } }],
    });
    await expect(confirmHelpComplete(client, HELP)).rejects.toThrow('help not found');
  });
});

describe('listIncomingHelps', () => {
  it('short-circuits on an empty id list without a round trip', async () => {
    const { fake, client } = db();
    await expect(listIncomingHelps(client, [])).resolves.toEqual({ rows: [], nextCursor: null });
    expect(fake.calls).toEqual([]);
  });

  it('reads a BOUNDED page of live rows for the given tappe, keyset-ordered (rule #9)', async () => {
    const { fake, client } = db({ 'milestone_helps.select': [{ data: [helpRow()] }] });
    await listIncomingHelps(client, [MILESTONE]);

    const call = fake.calls[0]!;
    expect(call.filters).toEqual([
      ['in', 'milestone_id', [MILESTONE]],
      ['is', 'deleted_at', null],
    ]);
    expect(call.modifiers.map((m) => m[0])).not.toContain('range');
    expect(call.modifiers).toEqual([
      ['order', 'created_at', { ascending: false }],
      ['order', 'id', { ascending: false }],
      ['limit', 50],
    ]);
  });

  it('honours an explicit page size', async () => {
    const { fake, client } = db({ 'milestone_helps.select': [{ data: [] }] });
    await listIncomingHelps(client, [MILESTONE], null, 5);
    expect(fake.calls[0]!.modifiers).toContainEqual(['limit', 5]);
  });

  it('returns the parsed rows', async () => {
    const { client } = db({
      'milestone_helps.select': [{ data: [helpRow(), helpRow({ status: 'accepted' })] }],
    });
    const { rows } = await listIncomingHelps(client, [MILESTONE]);
    expect(rows.map((r) => r.status)).toEqual(['offered', 'accepted']);
  });

  it('a full page hands back the last row as the keyset cursor', async () => {
    const { client } = db({
      'milestone_helps.select': [
        { data: [helpRow(), helpRow({ id: HELP_2, created_at: '2025-12-31T00:00:00Z' })] },
      ],
    });
    const page = await listIncomingHelps(client, [MILESTONE], null, 2);
    expect(page.nextCursor).toEqual({ created_at: '2025-12-31T00:00:00Z', id: HELP_2 });
  });

  it('a short page ends the walk', async () => {
    const { client } = db({ 'milestone_helps.select': [{ data: [helpRow()] }] });
    const page = await listIncomingHelps(client, [MILESTONE], null, 50);
    expect(page.nextCursor).toBeNull();
  });

  it('carries the cursor as the shared descending keyset disjunction', async () => {
    const { fake, client } = db({ 'milestone_helps.select': [{ data: [] }] });
    await listIncomingHelps(client, [MILESTONE], {
      created_at: '2026-01-01T00:00:00Z',
      id: HELP,
    });
    expect(fake.calls[0]!.filters).toContainEqual([
      'or',
      `created_at.lt.2026-01-01T00:00:00Z,and(created_at.eq.2026-01-01T00:00:00Z,id.lt.${HELP})`,
    ]);
  });

  it('no rows → an empty page, not a throw', async () => {
    const { client } = db({ 'milestone_helps.select': [{ data: null }] });
    await expect(listIncomingHelps(client, [MILESTONE])).resolves.toEqual({
      rows: [],
      nextCursor: null,
    });
  });

  it('surfaces a database error instead of an empty list', async () => {
    const { client } = db({ 'milestone_helps.select': [{ error: { message: 'rls denied' } }] });
    await expect(listIncomingHelps(client, [MILESTONE])).rejects.toThrow('rls denied');
  });

  it('rejects a row the help schema does not recognise', async () => {
    const { client } = db({ 'milestone_helps.select': [{ data: [{ id: 'nope' }] }] });
    await expect(listIncomingHelps(client, [MILESTONE])).rejects.toThrow();
  });
});

describe('listMyHelps', () => {
  it('scopes to the helper, hides soft-deleted offers, and bounds the page (rule #9)', async () => {
    const { fake, client } = db({ 'milestone_helps.select': [{ data: [helpRow()] }] });
    await listMyHelps(client, HELPER);

    const call = fake.calls[0]!;
    expect(call.filters).toEqual([
      ['eq', 'helper_id', HELPER],
      ['is', 'deleted_at', null],
    ]);
    expect(call.modifiers.map((m) => m[0])).not.toContain('range');
    expect(call.modifiers).toContainEqual(['limit', 50]);
  });

  it('walks forward on the cursor, never on an offset', async () => {
    const { fake, client } = db({ 'milestone_helps.select': [{ data: [] }] });
    await listMyHelps(client, HELPER, { created_at: '2026-01-01T00:00:00Z', id: HELP }, 10);

    const call = fake.calls[0]!;
    expect(call.modifiers).toContainEqual(['limit', 10]);
    expect(call.modifiers.map((m) => m[0])).not.toContain('range');
    expect(String(call.filters.find((f) => f[0] === 'or')?.[1])).toContain(
      'created_at.lt.2026-01-01T00:00:00Z',
    );
  });

  it('a full page hands back the last row as the keyset cursor', async () => {
    const { client } = db({
      'milestone_helps.select': [
        { data: [helpRow(), helpRow({ id: HELP_2, created_at: '2025-12-31T00:00:00Z' })] },
      ],
    });
    const page = await listMyHelps(client, HELPER, null, 2);
    expect(page.nextCursor).toEqual({ created_at: '2025-12-31T00:00:00Z', id: HELP_2 });
  });

  it('no rows → an empty page, not a throw', async () => {
    const { client } = db({ 'milestone_helps.select': [{ data: null }] });
    await expect(listMyHelps(client, HELPER)).resolves.toEqual({ rows: [], nextCursor: null });
  });

  it('surfaces a database error instead of an empty list', async () => {
    const { client } = db({ 'milestone_helps.select': [{ error: { message: 'rls denied' } }] });
    await expect(listMyHelps(client, HELPER)).rejects.toThrow('rls denied');
  });
});

describe('listMyHelpsForMilestones', () => {
  it('narrows to the tappe on screen as well as the helper', async () => {
    // The per-tappa help-state has to be answered by a query, not by hoping the offer is
    // recent enough to appear in an unscoped page.
    const { fake, client } = db({ 'milestone_helps.select': [{ data: [helpRow()] }] });
    await listMyHelpsForMilestones(client, HELPER, [MILESTONE, 'm-2']);

    const call = fake.calls[0]!;
    expect(call.filters).toEqual([
      ['eq', 'helper_id', HELPER],
      ['is', 'deleted_at', null],
      ['in', 'milestone_id', [MILESTONE, 'm-2']],
    ]);
    expect(call.modifiers.map((m) => m[0])).not.toContain('range');
  });

  it('no tappe → no query at all', async () => {
    const { fake, client } = db({});
    await expect(listMyHelpsForMilestones(client, HELPER, [])).resolves.toEqual({
      rows: [],
      nextCursor: null,
    });
    expect(fake.calls).toEqual([]);
  });

  it('an offer made long ago still comes back when its tappa is in scope', async () => {
    // The regression this exists for: unscoped, an old offer falls outside the newest page and
    // the tappa renders as un-helped; re-offering then hits the (milestone_id, helper_id)
    // unique index, which the help sheet reports as success.
    const old = helpRow({ id: HELP_2, created_at: '2024-01-01T00:00:00Z' });
    const { client } = db({ 'milestone_helps.select': [{ data: [old] }] });
    const page = await listMyHelpsForMilestones(client, HELPER, [MILESTONE]);
    expect(page.rows.map((r) => r.id)).toEqual([HELP_2]);
  });

  it('still paginates by cursor, never by offset (rule #9)', async () => {
    const { fake, client } = db({ 'milestone_helps.select': [{ data: [] }] });
    await listMyHelpsForMilestones(
      client,
      HELPER,
      [MILESTONE],
      { created_at: '2026-01-01T00:00:00Z', id: HELP },
      10,
    );

    const call = fake.calls[0]!;
    expect(call.modifiers).toContainEqual(['limit', 10]);
    expect(call.modifiers.map((m) => m[0])).not.toContain('range');
    expect(String(call.filters.find((f) => f[0] === 'or')?.[1])).toContain(
      'created_at.lt.2026-01-01T00:00:00Z',
    );
  });

  it('surfaces a database error instead of an empty list', async () => {
    const { client } = db({ 'milestone_helps.select': [{ error: { message: 'rls denied' } }] });
    await expect(listMyHelpsForMilestones(client, HELPER, [MILESTONE])).rejects.toThrow(
      'rls denied',
    );
  });
});
