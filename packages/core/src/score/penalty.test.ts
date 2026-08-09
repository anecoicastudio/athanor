import { describe, it, expect } from 'vitest';
import { reportPenaltyPoints } from './weights';

describe('reportPenaltyPoints', () => {
  it('maps severities to REPORT_PENALTY', () => {
    expect(reportPenaltyPoints('low')).toBe(-50);
    expect(reportPenaltyPoints('medium')).toBe(-100);
    expect(reportPenaltyPoints('high')).toBe(-200);
  });

  // PRD §4.9 bounds the penalty at −50…−200. A severity added later must land inside it.
  it('keeps every severity inside the −50…−200 band', () => {
    for (const severity of ['low', 'medium', 'high'] as const) {
      expect(reportPenaltyPoints(severity)).toBeLessThanOrEqual(-50);
      expect(reportPenaltyPoints(severity)).toBeGreaterThanOrEqual(-200);
    }
  });

  it('never costs less for a more severe report', () => {
    expect(reportPenaltyPoints('low')).toBeGreaterThanOrEqual(reportPenaltyPoints('medium'));
    expect(reportPenaltyPoints('medium')).toBeGreaterThanOrEqual(reportPenaltyPoints('high'));
  });
});
