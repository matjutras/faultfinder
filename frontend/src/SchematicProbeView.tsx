import type { MouseEvent } from 'react';
import { useEffect, useState } from 'react';
import { deviceAssetUrl, getDevice, measure } from './api';
import { FaultGuess } from './FaultGuess';
import type { Difficulty } from './faultSelection';
import { pickRandomFault } from './faultSelection';
import { schematicMmToPixels } from './kicadCoords';
import type { Leads, ProbeTarget } from './probeSelection';
import { EMPTY_LEADS, placeLead, selectedNodes, visibleResult } from './probeSelection';
import './SchematicProbeView.css';
import type { Device, MeasureResult } from './types';
import { nearestPointOnSegment } from './wireHitTest';

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
const WIRE_HIT_THICKNESS_PX = 14;
const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard', 'random'];

interface Props {
  deviceId: string;
  onGuess?: (correct: boolean, firstTryThisRound: boolean) => void;
}

// A wire segment's clickable hit-strip: an absolutely-positioned div rotated
// to lie exactly along the segment, wide enough to be comfortably tappable.
// The click handler snaps the placed lead to the nearest point *on* the
// segment (not the raw click pixel), so a lead always visually sits on the
// wire even though the hit-strip is much thicker than the drawn line.
function WireHit({
  wireIndex,
  node,
  x1,
  y1,
  x2,
  y2,
  onPlace,
}: {
  wireIndex: number;
  node: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  onPlace: (target: ProbeTarget) => void;
}) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;

  function handleClick(e: MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.parentElement!.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const hit = nearestPointOnSegment(clickX, clickY, { x1, y1, x2, y2, node });
    onPlace({ targetId: `wire:${wireIndex}:${hit.x.toFixed(1)}:${hit.y.toFixed(1)}`, node, x: hit.x, y: hit.y });
  }

  return (
    <div
      className="wire-hit"
      style={{
        left: x1,
        top: y1,
        width: length,
        height: WIRE_HIT_THICKNESS_PX,
        transform: `translateY(-50%) rotate(${angleDeg}deg)`,
        transformOrigin: '0 50%',
      }}
      onClick={handleClick}
      data-testid={`wire-hit-${wireIndex}`}
      title={node}
    />
  );
}

export function SchematicProbeView({ deviceId, onGuess = () => {} }: Props) {
  const [device, setDevice] = useState<Device | null>(null);
  const [leads, setLeads] = useState<Leads>(EMPTY_LEADS);
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

  const nodes = selectedNodes(leads);

  useEffect(() => {
    setResult(null);
    setError(null);
    if (!nodes) return;
    measure(deviceId, nodes, faultId)
      .then(setResult)
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, nodes?.[0], nodes?.[1], faultId]);

  if (error && !device) return <p className="error">Error: {error}</p>;
  if (!device) return <p>Loading device…</p>;

  const currentFault = device.faults.find((f) => f.id === faultId);
  const shown = visibleResult(result, leads);

  function newFault(tier: Difficulty) {
    if (!device) return;
    setDifficulty(tier);
    setFaultId(pickRandomFault(device.faults, tier).id);
    setRevealed(false);
    setRound((r) => r + 1);
  }

  function place(target: ProbeTarget) {
    setLeads((prev) => placeLead(prev, target));
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
        {device.wires.map((w, i) => {
          const p1 = schematicMmToPixels(w.x1_mm, w.y1_mm, SCHEMATIC_WIDTH, SCHEMATIC_HEIGHT);
          const p2 = schematicMmToPixels(w.x2_mm, w.y2_mm, SCHEMATIC_WIDTH, SCHEMATIC_HEIGHT);
          return (
            <WireHit
              key={i}
              wireIndex={i}
              node={w.node}
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              onPlace={place}
            />
          );
        })}
        {device.pins.map((p) => {
          const { x, y } = schematicMmToPixels(p.x_mm, p.y_mm, SCHEMATIC_WIDTH, SCHEMATIC_HEIGHT);
          const targetId = `${p.ref}:${p.pin}`;
          return (
            <button
              key={targetId}
              type="button"
              className="probe-marker"
              style={{ left: x, top: y }}
              title={`${p.ref} pin ${p.pin} (${p.node})`}
              data-testid={`pin-${p.ref}-${p.pin}`}
              onClick={() => place({ targetId, node: p.node, x, y })}
            />
          );
        })}
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

      <p className="hint">
        Place the red lead, then the black lead — click any pin or anywhere along a wire.
      </p>

      {error && <p className="error">Error: {error}</p>}

      {shown && nodes && (
        <div className="readout">
          <span className="value">{shown.differential_volts.toFixed(3)} V</span>
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
