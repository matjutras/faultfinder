import { OrbitControls, useGLTF } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { deviceAssetUrl, getDevice, measure } from './api';
import { formatDmmReading } from './dmmDisplay';
import { resolvePcbDropTarget } from './dropTargets';
import { FaultGuess } from './FaultGuess';
import type { Difficulty } from './faultSelection';
import { pickRandomFault } from './faultSelection';
import { pcbCameraFraming, pcbMmToThreeVec3 } from './kicadCoords';
import { DraggingLead, Multimeter } from './Multimeter';
import type { MultimeterMode } from './Multimeter';
import type { Leads, Measurement } from './probeSelection';
import { EMPTY_LEADS, selectedNodes, setLead, visibleResult } from './probeSelection';
import { screenToBoardMm } from './pcbRaycast';
import './SchematicProbeView.css';
import type { Device } from './types';
import { useLeadDrag } from './useLeadDrag';

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard', 'random'];

interface Props {
  deviceId: string;
  onGuess?: (correct: boolean, firstTryThisRound: boolean) => void;
}

function PcbModel({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  return <primitive object={scene} />;
}

export interface PcbRaycastHandle {
  screenToWorldMm: (clientX: number, clientY: number) => { xMm: number; yMm: number } | null;
}

// Lives inside <Canvas> (needs useThree for the real camera/renderer) and
// exposes a plain screen-point -> board-mm conversion imperatively, so a drop
// event handled *outside* the canvas (in the plain DOM onPointerUp from
// useLeadDrag) can still raycast through the real camera at that point --
// see pcbRaycast.ts for the actual (React-free, independently testable) math.
const DropRaycaster = forwardRef<PcbRaycastHandle, { boardThicknessMm: number }>(function DropRaycaster(
  { boardThicknessMm },
  ref,
) {
  const { camera, gl } = useThree();
  useImperativeHandle(ref, () => ({
    screenToWorldMm(clientX, clientY) {
      const rect = gl.domElement.getBoundingClientRect();
      return screenToBoardMm(camera, clientX, clientY, rect, boardThicknessMm);
    },
  }));
  return null;
});

// A floating indicator for wherever the red/black lead actually landed,
// rendered independently at the lead's exact (x_mm, y_mm) landing point.
export function LeadIndicator({
  xMm,
  yMm,
  boardThicknessMm,
  color,
  testId,
}: {
  xMm: number;
  yMm: number;
  boardThicknessMm: number;
  color: string;
  testId?: string;
}) {
  const VISIBLE_RADIUS_M = 0.0006;
  return (
    <mesh position={pcbMmToThreeVec3(xMm, yMm, boardThicknessMm)} raycast={() => null} data-testid={testId}>
      <sphereGeometry args={[VISIBLE_RADIUS_M * 1.3, 12, 12]} />
      <meshStandardMaterial color={color} emissive={color} />
    </mesh>
  );
}

export function PcbProbeView({ deviceId, onGuess = () => {} }: Props) {
  const [device, setDevice] = useState<Device | null>(null);
  const [leads, setLeads] = useState<Leads>(EMPTY_LEADS);
  const [mode, setMode] = useState<MultimeterMode>('voltage');
  const [difficulty, setDifficulty] = useState<Difficulty>('easy');
  const [faultId, setFaultId] = useState('healthy');
  const [round, setRound] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [measurement, setMeasurement] = useState<Measurement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const raycastRef = useRef<PcbRaycastHandle>(null);

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
    if (!device) return;
    const worldMm = raycastRef.current?.screenToWorldMm(clientX, clientY);
    if (!worldMm) return;
    const target = resolvePcbDropTarget(worldMm.xMm, worldMm.yMm, device);
    if (!target) return;
    setLeads((prev) => setLead(prev, color, target));
  }

  const { drag, startDrag } = useLeadDrag(place);

  if (error && !device) return <p className="error">Error: {error}</p>;
  if (!device) return <p>Loading device…</p>;
  if (!device.pcb_glb || device.board_thickness_mm === undefined || !device.board_size_mm) {
    return <p className="error">No PCB import yet for this device (run the importer first).</p>;
  }

  const currentFault = device.faults.find((f) => f.id === faultId);
  const shown = visibleResult(measurement, leads, mode);
  const glbUrl = deviceAssetUrl(deviceId, device.pcb_glb);
  const boardThicknessMm = device.board_thickness_mm;
  const framing = pcbCameraFraming(device.board_size_mm, boardThicknessMm);

  function newFault(tier: Difficulty) {
    if (!device) return;
    setDifficulty(tier);
    setFaultId(pickRandomFault(device.faults, tier).id);
    setRevealed(false);
    setRound((r) => r + 1);
  }

  return (
    <div className="schematic-probe-view">
      <h2>{device.name} — PCB view</h2>

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
        <div className="pcb-stage" style={{ width: 500, height: 400 }}>
          <Canvas camera={{ position: framing.position, near: framing.near, far: framing.far, fov: 40 }}>
            <ambientLight intensity={0.6} />
            <directionalLight
              position={[framing.target[0], framing.target[1] + framing.far / 20, framing.target[2]]}
              intensity={1.2}
            />
            <PcbModel url={glbUrl} />
            <DropRaycaster ref={raycastRef} boardThicknessMm={boardThicknessMm} />
            {leads.red && (
              <LeadIndicator
                xMm={leads.red.x}
                yMm={leads.red.y}
                boardThicknessMm={boardThicknessMm}
                color="#c0392b"
                testId="lead-red"
              />
            )}
            {leads.black && (
              <LeadIndicator
                xMm={leads.black.x}
                yMm={leads.black.y}
                boardThicknessMm={boardThicknessMm}
                color="#1a1a1a"
                testId="lead-black"
              />
            )}
            <OrbitControls target={framing.target} minPolarAngle={0.15} maxPolarAngle={1.45} zoomToCursor />
          </Canvas>
        </div>
        <Multimeter
          mode={mode}
          onModeChange={setMode}
          display={formatDmmReading(mode, shown)}
          redPlaced={leads.red !== null}
          blackPlaced={leads.black !== null}
          onLeadPointerDown={(color, e) => startDrag(color, e.clientX, e.clientY)}
        />
      </div>
      {drag && <DraggingLead color={drag.color} clientX={drag.clientX} clientY={drag.clientY} />}

      <p className="hint">Drag to orbit the board. Drag a lead from the multimeter onto a pad or copper trace.</p>

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
