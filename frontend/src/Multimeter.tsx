import './Multimeter.css';
import type { LeadColor } from './probeSelection';

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
  armedLead: LeadColor | null;
  onLeadClick: (color: LeadColor) => void;
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
export function Multimeter({ mode, onModeChange, display, redPlaced, blackPlaced, armedLead, onLeadClick }: Props) {
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
    </div>
  );
}
