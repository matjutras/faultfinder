import { useEffect, useRef, useState } from 'react';
import { deviceAssetUrl, getDevice, measure } from './api';
import { resolveSchematicDropTarget } from './dropTargets';
import { FaultGuess } from './FaultGuess';
import type { Difficulty } from './faultSelection';
import { pickRandomFault } from './faultSelection';
import { formatDmmReading } from './dmmDisplay';
import { Multimeter } from './Multimeter';
import type { MultimeterMode } from './Multimeter';
import type { Leads, LeadColor, Measurement } from './probeSelection';
import { EMPTY_LEADS, selectedNodes, setLead, visibleResult } from './probeSelection';
import './SchematicProbeView.css';
import type { Device } from './types';
import { useTapGesture } from './useTapGesture';

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
  const [leads, setLeads] = useState<Leads>(EMPTY_LEADS);
  const [armedLead, setArmedLead] = useState<LeadColor | null>(null);
  const [mode, setMode] = useState<MultimeterMode>('voltage');
  const [difficulty, setDifficulty] = useState<Difficulty>('easy');
  const [faultId, setFaultId] = useState('healthy');
  const [round, setRound] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [measurement, setMeasurement] = useState<Measurement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getDevice(deviceId)
      .then((d) => {
        setDevice(d);
        setFaultId(pickRandomFault(d.faults, difficulty).id);
      })
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  const nodes = selectedNodes(leads);

  useEffect(() => {
    setMeasurement(null);
    setError(null);
    if (!nodes) return;
    measure(deviceId, nodes, faultId, mode)
      .then((result) => setMeasurement({ nodes, mode, result }))
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, nodes?.[0], nodes?.[1], faultId, mode]);

  function place(color: 'red' | 'black', clientX: number, clientY: number) {
    const stage = stageRef.current;
    if (!device || !stage) return;
    const rect = stage.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const target = resolveSchematicDropTarget(
      localX,
      localY,
      device,
      SCHEMATIC_WIDTH,
      SCHEMATIC_HEIGHT,
      device.page_width_mm,
      device.page_height_mm,
    );
    if (!target) return;
    setLeads((prev) => setLead(prev, color, target));
    setArmedLead(null);
  }

  const { onPointerDown, onPointerUp } = useTapGesture((clientX, clientY) => {
    if (!armedLead) return;
    place(armedLead, clientX, clientY);
  });

  function onLeadClick(color: LeadColor) {
    setArmedLead((current) => (current === color ? null : color));
  }

  if (error && !device) return <p className="error">Error: {error}</p>;
  if (!device) return <p>Loading device…</p>;

  const currentFault = device.faults.find((f) => f.id === faultId);
  const shown = visibleResult(measurement, leads, mode);

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

      <div className="probe-workspace">
        <div
          ref={stageRef}
          className="schematic-stage"
          data-testid="probe-stage"
          style={{ width: SCHEMATIC_WIDTH, height: SCHEMATIC_HEIGHT, cursor: armedLead ? 'crosshair' : 'default' }}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
        >
          <kicanvas-embed
            src={deviceAssetUrl(deviceId, device.schematic_sch)}
            controls="none"
            style={{ width: SCHEMATIC_WIDTH, height: SCHEMATIC_HEIGHT, display: 'block' }}
          />
          {leads.red && (
            <div className="lead-marker red" style={{ left: leads.red.x, top: leads.red.y }} data-testid="lead-red" />
          )}
          {leads.black && (
            <div
              className="lead-marker black"
              style={{ left: leads.black.x, top: leads.black.y }}
              data-testid="lead-black"
            />
          )}
        </div>
        <Multimeter
          mode={mode}
          onModeChange={setMode}
          display={formatDmmReading(mode, shown)}
          redPlaced={leads.red !== null}
          blackPlaced={leads.black !== null}
          armedLead={armedLead}
          onLeadClick={onLeadClick}
        />
      </div>

      <p className="hint">Click a lead on the multimeter, then tap any pin or wire to place it.</p>

      {error && <p className="error">Error: {error}</p>}

      {shown && mode === 'voltage' && nodes && shown.probes && (
        <div className="readout">
          <span className="value">{(shown.differential_volts ?? 0).toFixed(3)} V</span>
          <span className="probes">
            {nodes[0]} ({shown.probes.find((p) => p.node === nodes[0])!.volts.toFixed(3)} V) &rarr; {nodes[1]} (
            {shown.probes.find((p) => p.node === nodes[1])!.volts.toFixed(3)} V)
          </span>
        </div>
      )}

      <FaultGuess key={round} faults={device.faults} actualFaultId={faultId} onGuess={onGuess} />
    </div>
  );
}
