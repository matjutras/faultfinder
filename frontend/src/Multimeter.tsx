import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import './Multimeter.css';
import type { LeadColor } from './probeSelection';
import type { MultimeterMode } from './types';

export type { MultimeterMode } from './types';

const MODES: { id: MultimeterMode; label: string }[] = [
  { id: 'voltage', label: 'V' },
  { id: 'ohms', label: 'Ω' },
  { id: 'diode', label: '➞|' },
  { id: 'continuity', label: '•)))' },
];

interface Props {
  mode: MultimeterMode;
  onModeChange: (mode: MultimeterMode) => void;
  display: string;
  redPlaced: boolean;
  blackPlaced: boolean;
  armedLead: LeadColor | null;
  onLeadClick: (color: LeadColor) => void;
  onReset?: () => void;
}

// A literal multimeter graphic: a mode selector, a digital display, and two
// wireless leads (red/black). Clicking a jack arms that lead (highlighted --
// clicking an already-armed jack disarms it instead); the next tap on the
// schematic/PCB workspace places the armed lead on whatever real
// pin/pad/wire/track is under it (see dropTargets.ts) and disarms. Replaces
// the earlier drag-and-drop flow, which real user feedback found fiddly
// (dragging a small handle precisely onto a pad) -- a real handheld
// multimeter's leads are wired to the meter and moved by hand one at a time
// anyway, so click-to-arm/tap-to-place is the closer analogue, not a
// downgrade from "more physical."
export function Multimeter({
  mode,
  onModeChange,
  display,
  redPlaced,
  blackPlaced,
  armedLead,
  onLeadClick,
  onReset = () => {},
}: Props) {
  // Repositioning the meter graphic itself on the canvas (milestone 11) --
  // an offset from wherever the CSS anchors the overlay by default, dragged
  // from a dedicated handle strip so it doesn't fight the mode/jack buttons'
  // own clicks. Not persisted across a device switch/remount, same as every
  // other per-round UI state here.
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragOrigin = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);

  function onHandlePointerDown(e: ReactPointerEvent) {
    e.stopPropagation();
    dragOrigin.current = { x: e.clientX, y: e.clientY, offsetX: offset.x, offsetY: offset.y };
    // jsdom (the test environment) has no Pointer Events capture at all --
    // optional-chained so a real browser still gets capture (keeps the drag
    // tracking the pointer even if it briefly leaves the small handle strip)
    // without every test needing a capture stub.
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function onHandlePointerMove(e: ReactPointerEvent) {
    const origin = dragOrigin.current;
    if (!origin) return;
    e.stopPropagation();
    setOffset({ x: origin.offsetX + (e.clientX - origin.x), y: origin.offsetY + (e.clientY - origin.y) });
  }

  function onHandlePointerUp(e: ReactPointerEvent) {
    e.stopPropagation();
    dragOrigin.current = null;
  }

  return (
    <div
      className="multimeter"
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
      data-testid="multimeter"
    >
      <div
        className="multimeter-handle"
        data-testid="multimeter-handle"
        title="Drag to move the multimeter"
        onPointerDown={onHandlePointerDown}
        onPointerMove={onHandlePointerMove}
        onPointerUp={onHandlePointerUp}
        onPointerCancel={onHandlePointerUp}
      />
      <div className="multimeter-display" data-testid="multimeter-display">
        {display}
      </div>
      <div className="multimeter-modes" role="group" aria-label="Multimeter mode">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            className="multimeter-mode-button"
            aria-pressed={mode === m.id}
            onClick={() => onModeChange(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="multimeter-jacks">
        <button
          type="button"
          className={`lead-jack red ${redPlaced ? 'placed' : ''} ${armedLead === 'red' ? 'armed' : ''}`}
          data-testid="lead-jack-red"
          aria-pressed={armedLead === 'red'}
          title="Click, then tap a pin, pad, wire, or trace to place this lead"
          onClick={() => onLeadClick('red')}
        />
        <button
          type="button"
          className={`lead-jack black ${blackPlaced ? 'placed' : ''} ${armedLead === 'black' ? 'armed' : ''}`}
          data-testid="lead-jack-black"
          aria-pressed={armedLead === 'black'}
          title="Click, then tap a pin, pad, wire, or trace to place this lead"
          onClick={() => onLeadClick('black')}
        />
      </div>
      <button type="button" className="multimeter-reset" data-testid="multimeter-reset" title="Clear both leads" onClick={onReset}>
        Clear leads
      </button>
    </div>
  );
}
