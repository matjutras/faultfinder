import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLongPressDrag } from './useLongPressDrag';

describe('useLongPressDrag', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not start dragging before the hold threshold', () => {
    const onDragStart = vi.fn();
    const { result } = renderHook(() => useLongPressDrag(onDragStart, vi.fn(), vi.fn()));

    act(() => result.current.down(10, 10));
    act(() => vi.advanceTimersByTime(399));

    expect(result.current.dragging).toBe(false);
    expect(onDragStart).not.toHaveBeenCalled();
  });

  it('starts dragging once held past the threshold with no movement', () => {
    const onDragStart = vi.fn();
    const { result } = renderHook(() => useLongPressDrag(onDragStart, vi.fn(), vi.fn()));

    act(() => result.current.down(10, 10));
    act(() => vi.advanceTimersByTime(400));

    expect(result.current.dragging).toBe(true);
    expect(onDragStart).toHaveBeenCalledTimes(1);
  });

  it('cancels the pending hold if the pointer moves before the threshold (a plain tap, not a hold)', () => {
    const onDragStart = vi.fn();
    const { result } = renderHook(() => useLongPressDrag(onDragStart, vi.fn(), vi.fn()));

    act(() => result.current.down(10, 10));
    act(() => result.current.move(30, 10)); // > 6px tolerance
    act(() => vi.advanceTimersByTime(1000));

    expect(result.current.dragging).toBe(false);
    expect(onDragStart).not.toHaveBeenCalled();
  });

  it('tolerates small jitter before the threshold without cancelling the hold', () => {
    const onDragStart = vi.fn();
    const { result } = renderHook(() => useLongPressDrag(onDragStart, vi.fn(), vi.fn()));

    act(() => result.current.down(10, 10));
    act(() => result.current.move(13, 12)); // within 6px tolerance
    act(() => vi.advanceTimersByTime(400));

    expect(result.current.dragging).toBe(true);
    expect(onDragStart).toHaveBeenCalledTimes(1);
  });

  it('forwards movement to onDragMove only once actually dragging', () => {
    const onDragMove = vi.fn();
    const { result } = renderHook(() => useLongPressDrag(vi.fn(), onDragMove, vi.fn()));

    act(() => result.current.down(10, 10));
    act(() => result.current.move(11, 11)); // pre-threshold jitter, not forwarded
    expect(onDragMove).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(400));
    act(() => result.current.move(50, 60));

    expect(onDragMove).toHaveBeenCalledWith(50, 60);
  });

  it('calls onDragEnd with the final point only if a drag was actually in progress', () => {
    const onDragEnd = vi.fn();
    const { result } = renderHook(() => useLongPressDrag(vi.fn(), vi.fn(), onDragEnd));

    // release before the hold threshold: a plain tap, no onDragEnd
    act(() => result.current.down(10, 10));
    act(() => result.current.up(10, 10));
    expect(onDragEnd).not.toHaveBeenCalled();

    // a real drag: onDragEnd fires with the release point
    act(() => result.current.down(10, 10));
    act(() => vi.advanceTimersByTime(400));
    act(() => result.current.up(80, 90));
    expect(onDragEnd).toHaveBeenCalledWith(80, 90);
  });

  it('cancel() stops a pending or in-progress hold without calling onDragEnd', () => {
    const onDragEnd = vi.fn();
    const { result } = renderHook(() => useLongPressDrag(vi.fn(), vi.fn(), onDragEnd));

    act(() => result.current.down(10, 10));
    act(() => vi.advanceTimersByTime(400));
    expect(result.current.dragging).toBe(true);

    act(() => result.current.cancel());
    expect(result.current.dragging).toBe(false);
    act(() => result.current.up(999, 999));
    expect(onDragEnd).not.toHaveBeenCalled();
  });
});
