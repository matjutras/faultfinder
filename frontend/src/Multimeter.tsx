import type { PointerEvent } from 'react';
import './Multimeter.css';
import type { LeadColor } from './useLeadDrag';

export type MultimeterMode = 'voltage' | 'ohms' | 'diode';

const MODES: { id: MultimeterMode; label: string }[] = [
  { id: 'voltage', label: 'V' },
  { id: 'ohms', label: 'Ω' },
  { id: 'diode', label: '➞|' },
];

interface Props {
  mode: MultimeterMode;
  onModeChange: (mode: MultimeterMode) => void;
  display: string;
  redPlaced: boolean;
  blackPlaced: boolean;
  onLeadPointerDown: (color: LeadColor, e: PointerEvent) => void;
}

// A literal multimeter graphic: a mode selector, a digital display, and two
// draggable leads (red/black) the user drags onto the schematic/PCB and
// drops on a real pin/pad/wire/track (see dropTargets.ts) -- replaces the
// old click-to-place TP markers entirely, not just visually.
export function Multimeter({ mode, onModeChange, display, redPlaced, blackPlaced, onLeadPointerDown }: Props) {
  return (
    <div className="multimeter">
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
        <div
          className={`lead-jack red ${redPlaced ? 'placed' : ''}`}
          data-testid="lead-drag-red"
          title="Drag onto a pin, pad, wire, or trace"
          onPointerDown={(e) => onLeadPointerDown('red', e)}
        />
        <div
          className={`lead-jack black ${blackPlaced ? 'placed' : ''}`}
          data-testid="lead-drag-black"
          title="Drag onto a pin, pad, wire, or trace"
          onPointerDown={(e) => onLeadPointerDown('black', e)}
        />
      </div>
    </div>
  );
}

// The lead's floating "flying tip" rendered at the pointer's current position
// while a drag is in progress -- fixed-position so it can visually travel
// over the board regardless of where the multimeter itself sits in the page.
export function DraggingLead({ color, clientX, clientY }: { color: LeadColor; clientX: number; clientY: number }) {
  return (
    <div
      className={`dragging-lead ${color}`}
      style={{ left: clientX, top: clientY }}
      data-testid={`dragging-lead-${color}`}
    />
  );
}
