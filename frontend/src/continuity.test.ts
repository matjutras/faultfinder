import { describe, expect, it } from 'vitest';
import { CONTINUITY_THRESHOLD_OHMS, isContinuous } from './continuity';

describe('isContinuous', () => {
  it('is true for a near-zero resistance (the same node/a solid wire)', () => {
    expect(isContinuous(0.4)).toBe(true);
  });

  it('is true exactly at the threshold', () => {
    expect(isContinuous(CONTINUITY_THRESHOLD_OHMS)).toBe(true);
  });

  it('is false just above the threshold (a real component between the probes)', () => {
    expect(isContinuous(CONTINUITY_THRESHOLD_OHMS + 0.01)).toBe(false);
  });

  it('is false for null (open, "0L")', () => {
    expect(isContinuous(null)).toBe(false);
  });

  it('is false for undefined', () => {
    expect(isContinuous(undefined)).toBe(false);
  });
});
