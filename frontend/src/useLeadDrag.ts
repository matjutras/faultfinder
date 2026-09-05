import { useEffect, useRef, useState } from 'react';

export type LeadColor = 'red' | 'black';

export interface DragState {
  color: LeadColor;
  clientX: number;
  clientY: number;
}

// Shared pointer-drag tracking for the multimeter's two leads, used by both
// the schematic and PCB views: a lead handle's onPointerDown starts the drag,
// window-level pointermove/pointerup follow it wherever it goes (including
// off the element that started it -- a plain onPointerUp on the handle itself
// would miss every drop that ends over the board), and pointerup resolves the
// drop via the caller's own view-specific hit-testing.
export function useLeadDrag(onDrop: (color: LeadColor, clientX: number, clientY: number) => void) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  useEffect(() => {
    if (!drag) return;

    function handleMove(e: PointerEvent) {
      setDrag((d) => (d ? { ...d, clientX: e.clientX, clientY: e.clientY } : d));
    }
    function handleUp(e: PointerEvent) {
      onDropRef.current(drag!.color, e.clientX, e.clientY);
      setDrag(null);
    }

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.color]);

  function startDrag(color: LeadColor, clientX: number, clientY: number) {
    setDrag({ color, clientX, clientY });
  }

  return { drag, startDrag };
}
