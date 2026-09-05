import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useLeadDrag } from './useLeadDrag';

function firePointer(type: string, clientX: number, clientY: number) {
  window.dispatchEvent(new PointerEvent(type, { clientX, clientY }));
}

describe('useLeadDrag', () => {
  it('has no drag in progress before a lead is picked up', () => {
    const { result } = renderHook(() => useLeadDrag(vi.fn()));
    expect(result.current.drag).toBeNull();
  });

  it('tracks the drag position as the pointer moves', () => {
    const { result } = renderHook(() => useLeadDrag(vi.fn()));

    act(() => result.current.startDrag('red', 10, 20));
    expect(result.current.drag).toEqual({ color: 'red', clientX: 10, clientY: 20 });

    act(() => firePointer('pointermove', 30, 40));
    expect(result.current.drag).toEqual({ color: 'red', clientX: 30, clientY: 40 });
  });

  it('calls onDrop with the drag color and final pointer position, then clears the drag', () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() => useLeadDrag(onDrop));

    act(() => result.current.startDrag('black', 10, 20));
    act(() => firePointer('pointerup', 99, 88));

    expect(onDrop).toHaveBeenCalledWith('black', 99, 88);
    expect(result.current.drag).toBeNull();
  });

  it('does not react to pointer events before any drag has started', () => {
    const onDrop = vi.fn();
    renderHook(() => useLeadDrag(onDrop));

    firePointer('pointermove', 1, 2);
    firePointer('pointerup', 3, 4);

    expect(onDrop).not.toHaveBeenCalled();
  });

  it('starting a second drag after a drop tracks independently', () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() => useLeadDrag(onDrop));

    act(() => result.current.startDrag('red', 0, 0));
    act(() => firePointer('pointerup', 5, 5));
    expect(onDrop).toHaveBeenCalledWith('red', 5, 5);

    act(() => result.current.startDrag('black', 1, 1));
    act(() => firePointer('pointerup', 6, 6));
    expect(onDrop).toHaveBeenCalledWith('black', 6, 6);
    expect(onDrop).toHaveBeenCalledTimes(2);
  });
});
