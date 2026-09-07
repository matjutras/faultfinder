import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { shouldBeep, useContinuityBeep } from './useContinuityBeep';

describe('shouldBeep', () => {
  it('beeps on the rising edge into continuous', () => {
    expect(shouldBeep(false, true)).toBe(true);
  });

  it('does not beep again while it stays continuous', () => {
    expect(shouldBeep(true, true)).toBe(false);
  });

  it('does not beep while it stays open', () => {
    expect(shouldBeep(false, false)).toBe(false);
  });

  it('does not beep on the falling edge', () => {
    expect(shouldBeep(true, false)).toBe(false);
  });
});

describe('useContinuityBeep', () => {
  it('does not throw in an environment with no AudioContext (jsdom)', () => {
    const { rerender } = renderHook(({ active }) => useContinuityBeep(active), {
      initialProps: { active: false },
    });
    expect(() => rerender({ active: true })).not.toThrow();
  });
});
