import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useTapGesture } from './useTapGesture';

describe('useTapGesture', () => {
  it('calls onTap when pointerup lands close to pointerdown', () => {
    const onTap = vi.fn();
    const { result } = renderHook(() => useTapGesture(onTap));

    act(() => result.current.onPointerDown({ clientX: 10, clientY: 20 }));
    act(() => result.current.onPointerUp({ clientX: 12, clientY: 21 }));

    expect(onTap).toHaveBeenCalledWith(12, 21);
  });

  it('does not call onTap when pointerup is far from pointerdown (a drag, not a tap)', () => {
    const onTap = vi.fn();
    const { result } = renderHook(() => useTapGesture(onTap));

    act(() => result.current.onPointerDown({ clientX: 10, clientY: 20 }));
    act(() => result.current.onPointerUp({ clientX: 200, clientY: 20 }));

    expect(onTap).not.toHaveBeenCalled();
  });

  it('ignores a pointerup with no preceding pointerdown', () => {
    const onTap = vi.fn();
    const { result } = renderHook(() => useTapGesture(onTap));

    act(() => result.current.onPointerUp({ clientX: 10, clientY: 20 }));

    expect(onTap).not.toHaveBeenCalled();
  });

  it('resets after each gesture, so a second tap is tracked independently', () => {
    const onTap = vi.fn();
    const { result } = renderHook(() => useTapGesture(onTap));

    act(() => result.current.onPointerDown({ clientX: 0, clientY: 0 }));
    act(() => result.current.onPointerUp({ clientX: 0, clientY: 0 }));
    act(() => result.current.onPointerDown({ clientX: 100, clientY: 100 }));
    act(() => result.current.onPointerUp({ clientX: 101, clientY: 100 }));

    expect(onTap).toHaveBeenNthCalledWith(1, 0, 0);
    expect(onTap).toHaveBeenNthCalledWith(2, 101, 100);
    expect(onTap).toHaveBeenCalledTimes(2);
  });
});
