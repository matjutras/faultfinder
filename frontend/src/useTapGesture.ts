import { useRef } from 'react';

// A real click/tap on the workspace, cleanly distinguished from a
// click-and-drag gesture (e.g. orbiting the PCB view) using the same
// element's own pointerdown/pointerup -- a plain onClick can't do this: a
// browser still fires a native click at pointerup after a large-movement
// drag, as long as it ends over the same element, which would place a lead
// after every orbit gesture on the PCB view. Attaching these handlers
// alongside react-three-fiber's OrbitControls (which listens on the same DOM
// node without stopping propagation) is safe for the same reason.
const TAP_MOVE_TOLERANCE_PX = 6;

export function useTapGesture(onTap: (clientX: number, clientY: number) => void) {
  const start = useRef<{ x: number; y: number } | null>(null);

  function onPointerDown(e: { clientX: number; clientY: number }) {
    start.current = { x: e.clientX, y: e.clientY };
  }

  function onPointerUp(e: { clientX: number; clientY: number }) {
    const from = start.current;
    start.current = null;
    if (!from) return;
    if (Math.hypot(e.clientX - from.x, e.clientY - from.y) > TAP_MOVE_TOLERANCE_PX) return;
    onTap(e.clientX, e.clientY);
  }

  return { onPointerDown, onPointerUp };
}
