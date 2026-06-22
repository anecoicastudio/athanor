import { describe, it, expect } from 'vitest';
import { resolveReportInput } from './admin';

describe('resolveReportInput', () => {
  it('accepts a dismiss verdict without severity', () => {
    const v = resolveReportInput.parse({
      reportId: crypto.randomUUID(),
      verdict: 'dismiss',
      resolution: 'spam, archived',
    });
    expect(v.verdict).toBe('dismiss');
  });
  it('requires severity when upholding', () => {
    expect(() =>
      resolveReportInput.parse({
        reportId: crypto.randomUUID(),
        verdict: 'uphold',
        resolution: 'x',
      }),
    ).toThrow();
  });
  it('rejects an over-long resolution', () => {
    expect(() =>
      resolveReportInput.parse({
        reportId: crypto.randomUUID(),
        verdict: 'dismiss',
        resolution: 'x'.repeat(2001),
      }),
    ).toThrow();
  });
});
