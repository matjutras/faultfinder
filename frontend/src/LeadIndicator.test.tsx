import ReactThreeTestRenderer from '@react-three/test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LeadIndicator } from './PcbProbeView';

// LeadIndicator is a real react-three-fiber <mesh>, not a DOM node, so
// @react-three/test-renderer (not @testing-library/react/jsdom) is what can
// actually mount it and dispatch pointer events through r3f's own event
// system without needing real WebGL -- see PcbProbeView.tsx's own comment
// on why the drag-tracking itself happens via window-level listeners rather
// than further mesh events (the pointer leaves this tiny sphere's own
// raycast hit area almost immediately once a real drag starts).
describe('LeadIndicator', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('disables orbit (onMarkerPointerDown) immediately on pointer down, and re-enables it on release -- even for a plain tap that never becomes a drag', async () => {
    const onMarkerPointerDown = vi.fn();
    const onMarkerPointerUp = vi.fn();
    const renderer = await ReactThreeTestRenderer.create(
      <LeadIndicator
        xMm={5}
        yMm={5}
        boardThicknessMm={1.6}
        color="#c0392b"
        onMarkerPointerDown={onMarkerPointerDown}
        onMarkerPointerUp={onMarkerPointerUp}
      />,
    );
    const mesh = renderer.scene.children[0];

    await renderer.fireEvent(mesh, 'pointerDown', { clientX: 10, clientY: 10, pointerId: 1 });
    expect(onMarkerPointerDown).toHaveBeenCalledTimes(1);
    expect(onMarkerPointerUp).not.toHaveBeenCalled();

    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 10, clientY: 10 }));
    expect(onMarkerPointerUp).toHaveBeenCalledTimes(1);
  });

  it('does not report a drag for a plain tap released before the long-press threshold', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onDragMove = vi.fn();
    const onDragEnd = vi.fn();
    const renderer = await ReactThreeTestRenderer.create(
      <LeadIndicator
        xMm={5}
        yMm={5}
        boardThicknessMm={1.6}
        color="#c0392b"
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
      />,
    );
    const mesh = renderer.scene.children[0];

    await renderer.fireEvent(mesh, 'pointerDown', { clientX: 10, clientY: 10 });
    vi.advanceTimersByTime(200); // under the 400ms hold threshold
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 10, clientY: 10 }));

    expect(onDragMove).not.toHaveBeenCalled();
    expect(onDragEnd).not.toHaveBeenCalled();
  });

  it('reports a drag (onDragMove then onDragEnd) once held past the long-press threshold and moved', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onDragMove = vi.fn();
    const onDragEnd = vi.fn();
    const renderer = await ReactThreeTestRenderer.create(
      <LeadIndicator
        xMm={5}
        yMm={5}
        boardThicknessMm={1.6}
        color="#c0392b"
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
      />,
    );
    const mesh = renderer.scene.children[0];

    await renderer.fireEvent(mesh, 'pointerDown', { clientX: 10, clientY: 10 });
    vi.advanceTimersByTime(400);

    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 40, clientY: 60 }));
    expect(onDragMove).toHaveBeenCalledWith(40, 60);

    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 40, clientY: 60 }));
    expect(onDragEnd).toHaveBeenCalledWith(40, 60);
  });
});
