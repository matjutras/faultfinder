import { useEffect, useState } from 'react';
import { deviceAssetUrl, getDevice, measure } from './api';
import { FaultGuess } from './FaultGuess';
import type { Difficulty } from './faultSelection';
import { pickRandomFault } from './faultSelection';
import { schematicMmToPixels } from './kicadCoords';
import { toggleProbe, visibleResult } from './probeSelection';
import './SchematicProbeView.css';
import type { Device, MeasureResult } from './types';

// At the old 500x354 (~3.2px/mm against the 100x110mm page), adjacent TP
// markers needed >13.6mm of separation just for their 44px tap targets not
// to overlap -- every device's real spacing (7.6-12.7mm, driven by realistic
// component/pin geometry) fell short somewhere, confirmed by measuring
// actual rendered marker bounding boxes for pairwise overlap, not by
// eyeballing it. 800x880 (~8px/mm) only needs 5.5mm of separation, clearing
// every device's tightest gap with margin -- fixing this at the render
// scale, not by re-cramming every schematic's layout a second time.
const SCHEMATIC_WIDTH = 800;
const SCHEMATIC_HEIGHT = 880;
const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard', 'random'];

interface Props {
  deviceId: string;
  onGuess?: (correct: boolean, firstTryThisRound: boolean) => void;
}

export function SchematicProbeView({ deviceId, onGuess = () => {} }: Props) {
  const [device, setDevice] = useState<Device | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [difficulty, setDifficulty] = useState<Difficulty>('easy');
  const [faultId, setFaultId] = useState('healthy');
  const [round, setRound] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [result, setResult] = useState<MeasureResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDevice(deviceId)
      .then((d) => {
        setDevice(d);
        setFaultId(pickRandomFault(d.faults, difficulty).id);
      })
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  useEffect(() => {
    setResult(null);
    setError(null);
    if (selected.length !== 2) return;
    measure(deviceId, [selected[0], selected[1]], faultId)
      .then(setResult)
      .catch((e) => setError(e.message));
  }, [deviceId, selected, faultId]);

  if (error && !device) return <p className="error">Error: {error}</p>;
  if (!device) return <p>Loading device…</p>;

  const currentFault = device.faults.find((f) => f.id === faultId);
  const shown = visibleResult(result, selected);

  function newFault(tier: Difficulty) {
    if (!device) return;
    setDifficulty(tier);
    setFaultId(pickRandomFault(device.faults, tier).id);
    setRevealed(false);
    setRound((r) => r + 1);
  }

  return (
    <div className="schematic-probe-view">
      <h2>{device.name}</h2>

      <label>
        Difficulty:{' '}
        <select value={difficulty} onChange={(e) => newFault(e.target.value as Difficulty)}>
          {DIFFICULTIES.map((tier) => (
            <option key={tier} value={tier}>
              {tier}
            </option>
          ))}
        </select>
      </label>{' '}
      <button type="button" onClick={() => newFault(difficulty)}>
        New Fault
      </button>{' '}
      <button type="button" onClick={() => setRevealed((r) => !r)}>
        {revealed ? 'Hide fault' : 'Reveal fault'}
      </button>
      {revealed && currentFault && <p className="revealed-fault">Fault: {currentFault.name}</p>}

      <div className="schematic-stage" style={{ width: SCHEMATIC_WIDTH, height: SCHEMATIC_HEIGHT }}>
        <kicanvas-embed
          src={deviceAssetUrl(deviceId, device.schematic_sch)}
          controls="none"
          style={{ width: SCHEMATIC_WIDTH, height: SCHEMATIC_HEIGHT, display: 'block' }}
        />
        {device.testpoints.map((tp) => {
          const { x, y } = schematicMmToPixels(tp.x_mm, tp.y_mm, SCHEMATIC_WIDTH, SCHEMATIC_HEIGHT);
          return (
            <button
              key={tp.tp_id}
              type="button"
              className={`probe-marker${selected.includes(tp.tp_id) ? ' selected' : ''}`}
              style={{ left: x, top: y }}
              title={tp.label}
              onClick={() => setSelected((prev) => toggleProbe(prev, tp.tp_id))}
            >
              {tp.tp_id}
            </button>
          );
        })}
      </div>

      <p className="hint">Click two test points to place probes.</p>

      {error && <p className="error">Error: {error}</p>}

      {shown && (
        <div className="readout">
          <span className="value">{shown.differential_volts.toFixed(3)} V</span>
          <span className="probes">
            {selected[0]} ({shown.probes[selected[0]].toFixed(3)} V) &rarr; {selected[1]} (
            {shown.probes[selected[1]].toFixed(3)} V)
          </span>
        </div>
      )}

      <FaultGuess key={round} faults={device.faults} actualFaultId={faultId} onGuess={onGuess} />
    </div>
  );
}
