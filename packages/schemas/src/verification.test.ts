import { describe, expect, it } from 'vitest';
import { VERIFICATION_STATUSES } from './verification.ts';

describe('verification statuses', () => {
  it('exposes the three statuses', () => {
    expect(VERIFICATION_STATUSES).toEqual(['pending', 'verified', 'failed']);
  });
});
