import { describe, expect, it } from 'vitest';
import { VERIFICATION_STATUSES } from './verification';

describe('verification statuses', () => {
  it('exposes the three statuses', () => {
    expect(VERIFICATION_STATUSES).toEqual(['pending', 'verified', 'failed']);
  });
});
