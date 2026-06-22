import { describe, it, expect } from 'vitest';
import { reportPenaltyPoints } from './weights';

describe('reportPenaltyPoints', () => {
  it('maps severities to REPORT_PENALTY', () => {
    expect(reportPenaltyPoints('low')).toBe(-50);
    expect(reportPenaltyPoints('medium')).toBe(-100);
    expect(reportPenaltyPoints('high')).toBe(-200);
  });
});
