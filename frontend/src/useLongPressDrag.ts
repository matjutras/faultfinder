import { useRef, useState } from 'react';

// Recognizes "press and hold, then drag" on a single element -- specifically
// an already-placed lead marker, which needs to be repositioned by picking
// it up directly rather than re-arming it from the multimeter jack first.
// Deliberately distinct from both:
//   - a plain tap (see useTapGesture.ts), which does nothing when it lands
//     on a marker instead of the workspace background;
//   - a plain drag started elsewhere (e.g. orbiting the PCB view), which
//     never touches this hook at all since it never begins on the marker.
// A quick tap or an accidental brush of the marker must NOT start a drag --
// only a hold past LONG_PRESS_MS with no real movement does. Framework-
// agnostic on purpose (plain x/y in, callbacks out) so both the DOM-based
// schematic view and the react-three-fiber-based PCB view (whose marker is a
// 3D mesh, not a DOM node) can drive it from their own event plumbing.
const LONG_PRESS_MS = 400;
const PRESS_MOVE_CANCEL_PX = 6; // movement before the hold fires reads as "not a hold", not a tiny drag

export interface LongPressDrag {
  dragging: boolean;
  down: (x: number, y: number) => void;
  move: (x: number, y: number) => void;
  up: (x: number, y: number) => void;
  cancel: () => void;
}

export function useLongPressDrag(
  onDragStart: () => void,
  onDragMove: (x: number, y: number) => void,
  onDragEnd: (x: number, y: number) => void,
): LongPressDrag {
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);

  function clearPressTimer() {
    if (pressTimer.current !== null) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }

  function down(x: number, y: number) {
    origin.current = { x, y };
    clearPressTimer();
    pressTimer.current = setTimeout(() => {
      pressTimer.current = null;
      draggingRef.current = true;
      setDragging(true);
      onDragStart();
    }, LONG_PRESS_MS);
  }

  function move(x: number, y: number) {
    if (draggingRef.current) {
      onDragMove(x, y);
      return;
    }
    const from = origin.current;
    if (from && Math.hypot(x - from.x, y - from.y) > PRESS_MOVE_CANCEL_PX) {
      clearPressTimer();
      origin.current = null;
    }
  }

  function reset() {
    clearPressTimer();
    origin.current = null;
    draggingRef.current = false;
    setDragging(false);
  }

  function up(x: number, y: number) {
    const wasDragging = draggingRef.current;
    reset();
    if (wasDragging) onDragEnd(x, y);
  }

  function cancel() {
    reset();
  }

  return { dragging, down, move, up, cancel };
}
