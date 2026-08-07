import { describe, expect, it, vi } from 'vitest';
import type { ErrorEvent } from '@sentry/react-native';

// sentry.ts reads Constants.executionEnvironment at module load and imports the
// native SDK — stub both (init/close are only reached via initSentry/closeSentry).
vi.mock('expo-constants', () => ({
  default: { executionEnvironment: 'storeClient' },
}));
vi.mock('@sentry/react-native', () => ({
  init: vi.fn(),
  close: vi.fn(),
}));

import { redactTokens, scrubEvent } from './sentry';

const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123def456ghi789';

describe('redactTokens', () => {
  it('strips JWT-shaped strings', () => {
    expect(redactTokens(`boom: ${JWT} in message`)).toBe('boom: [redacted] in message');
  });

  it('strips Bearer tokens', () => {
    expect(redactTokens('Authorization: Bearer abc.def-123_x')).toBe('Authorization: [redacted]');
  });

  it('leaves ordinary text alone', () => {
    expect(redactTokens('fetch failed with status 500')).toBe('fetch failed with status 500');
  });
});

describe('scrubEvent', () => {
  const makeEvent = (): ErrorEvent =>
    ({
      user: { id: 'u1', email: 'a@b.c' },
      server_name: 'Marcos-iPhone',
      extra: { chat: 'private text' },
      request: {
        url: `https://x.supabase.co/rest?token=${JWT}`,
        headers: {
          Authorization: `Bearer ${JWT}`,
          Cookie: 'sb=secret',
          'x-client-key': 'k1',
          apikey: 'anonkey',
          'content-type': 'application/json',
        },
        cookies: { sb: 'secret' },
        data: { body: 'posted text' },
        query_string: 'token=abc',
      },
      message: `failed with ${JWT}`,
      logentry: { message: `log ${JWT}` },
      exception: { values: [{ type: 'Error', value: `caught Bearer abc123` }] },
      breadcrumbs: [
        {
          category: 'http',
          message: `GET Bearer tok-1`,
          data: { method: 'GET', status_code: 500 },
        },
        { category: 'ui.click', data: { label: 'Send message' } },
        { category: 'navigation', message: `route?jwt=${JWT}` },
      ],
    }) as unknown as ErrorEvent;

  it('deletes identity, extra, and request payload fields', () => {
    const event = scrubEvent(makeEvent());
    expect(event.user).toBeUndefined();
    expect(event.server_name).toBeUndefined();
    expect(event.extra).toBeUndefined();
    expect(event.request?.cookies).toBeUndefined();
    expect(event.request?.data).toBeUndefined();
    expect(event.request?.query_string).toBeUndefined();
  });

  it('redacts auth-shaped headers, keeps benign ones, redacts the url', () => {
    const event = scrubEvent(makeEvent());
    const headers = event.request?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('[redacted]');
    expect(headers['Cookie']).toBe('[redacted]');
    expect(headers['x-client-key']).toBe('[redacted]');
    expect(headers['apikey']).toBe('[redacted]');
    expect(headers['content-type']).toBe('application/json');
    expect(event.request?.url).toBe('https://x.supabase.co/rest?token=[redacted]');
  });

  it('redacts message, logentry, and exception values', () => {
    const event = scrubEvent(makeEvent());
    expect(event.message).toBe('failed with [redacted]');
    expect(event.logentry?.message).toBe('log [redacted]');
    expect(event.exception?.values?.[0]?.value).toBe('caught [redacted]');
  });

  it('keeps network breadcrumb data, strips the rest, redacts crumb messages', () => {
    const event = scrubEvent(makeEvent());
    const [http, ui, nav] = event.breadcrumbs!;
    expect(http?.data).toEqual({ method: 'GET', status_code: 500 });
    expect(http?.message).toBe('GET [redacted]');
    expect(ui?.data).toBeUndefined();
    expect(nav?.message).toBe('route?jwt=[redacted]');
  });

  it('returns the same (mutated) event object', () => {
    const event = makeEvent();
    expect(scrubEvent(event)).toBe(event);
  });
});
