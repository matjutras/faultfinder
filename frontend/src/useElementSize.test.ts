import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useElementSize } from './useElementSize';

type Callback = (entries: { contentRect: { width: number; height: number } }[]) => void;

describe('useElementSize', () => {
  let observedCallback: Callback | null = null;
  let realResizeObserver: typeof ResizeObserver;

  beforeEach(() => {
    realResizeObserver = globalThis.ResizeObserver;
    observedCallback = null;
    class FakeResizeObserver {
      constructor(cb: Callback) {
        observedCallback = cb;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).ResizeObserver = FakeResizeObserver;
  });

  afterEach(() => {
    globalThis.ResizeObserver = realResizeObserver;
  });

  it('returns the fallback size until a real observation arrives', () => {
    const el = document.createElement('div');
    const { result } = renderHook(() => useElementSize(el, { width: 800, height: 880 }));

    expect(result.current).toEqual({ width: 800, height: 880 });
  });

  it('updates to the observed content-box size once ResizeObserver reports one', () => {
    const el = document.createElement('div');
    const { result } = renderHook(() => useElementSize(el, { width: 800, height: 880 }));

    act(() => observedCallback?.([{ contentRect: { width: 1200, height: 900 } }]));

    expect(result.current).toEqual({ width: 1200, height: 900 });
  });

  it('ignores a zero-size observation (e.g. a momentarily display:none container)', () => {
    const el = document.createElement('div');
    const { result } = renderHook(() => useElementSize(el, { width: 800, height: 880 }));

    act(() => observedCallback?.([{ contentRect: { width: 0, height: 0 } }]));

    expect(result.current).toEqual({ width: 800, height: 880 });
  });

  it('re-attaches when the element changes (e.g. a remount after a device switch), not just once on first mount', () => {
    const first = document.createElement('div');
    const second = document.createElement('div');
    const { result, rerender } = renderHook(({ el }) => useElementSize(el, { width: 800, height: 880 }), {
      initialProps: { el: first as Element | null },
    });

    act(() => observedCallback?.([{ contentRect: { width: 1200, height: 900 } }]));
    expect(result.current).toEqual({ width: 1200, height: 900 });

    rerender({ el: second });
    act(() => observedCallback?.([{ contentRect: { width: 1400, height: 1150 } }]));
    expect(result.current).toEqual({ width: 1400, height: 1150 });
  });
});
