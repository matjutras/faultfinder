import { useEffect, useState } from 'react';
import { deviceAssetUrl, getDevice, measure } from './api';
import type { Difficulty } from './faultSelection';
import { pickRandomFault } from './faultSelection';
import { schematicMmToPixels } from './kicadCoords';
import { toggleProbe } from './probeSelection';
import './SchematicProbeView.css';
import type { Device, MeasureResult } from './types';

const SCHEMATIC_WIDTH = 500;
const SCHEMATIC_HEIGHT = 354;
const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard', 'random'];

interface Props {
  deviceId: string;
}

export function SchematicProbeView({ deviceId }: Props) {
  const [device, setDevice] = useState<Device | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [difficulty, setDifficulty] = useState<Difficulty>('easy');
  const [faultId, setFaultId] = useState('healthy');
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

  function newFault(tier: Difficulty) {
    if (!device) return;
    setDifficulty(tier);
    setFaultId(pickRandomFault(device.faults, tier).id);
    setRevealed(false);
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

      {result && selected.length === 2 && (
        <div className="readout">
          <span className="value">{result.differential_volts.toFixed(3)} V</span>
          <span className="probes">
            {selected[0]} ({result.probes[selected[0]].toFixed(3)} V) &rarr; {selected[1]} (
            {result.probes[selected[1]].toFixed(3)} V)
          </span>
        </div>
      )}
    </div>
  );
}
