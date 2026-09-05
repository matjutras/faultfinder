import { OrbitControls, useGLTF } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import type { Mesh, PerspectiveCamera } from 'three';
import { deviceAssetUrl, getDevice, measure } from './api';
import { FaultGuess } from './FaultGuess';
import type { Difficulty } from './faultSelection';
import { pickRandomFault } from './faultSelection';
import { pcbCameraFraming, pcbHitTargetWorldRadius, pcbMmToThreeVec3 } from './kicadCoords';
import type { Leads, ProbeTarget } from './probeSelection';
import { EMPTY_LEADS, placeLead, selectedNodes, visibleResult } from './probeSelection';
import './SchematicProbeView.css';
import type { Device, MeasureResult } from './types';
import { hitTestSegments } from './wireHitTest';

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard', 'random'];
const TRACK_HIT_TOLERANCE_MM = 1; // track width is 0.25mm; generous slack for click/raycast imprecision

interface Props {
  deviceId: string;
  onGuess?: (correct: boolean, firstTryThisRound: boolean) => void;
}

function PcbModel({ url, onBoardClick }: { url: string; onBoardClick: (e: ThreeEvent<MouseEvent>) => void }) {
  const { scene } = useGLTF(url);
  return <primitive object={scene} onClick={onBoardClick} />;
}

const VISIBLE_RADIUS_M = 0.0006;
const HIT_TARGET_PX = 44; // matches the ~44x44 CSS px tap target used for the 2D schematic markers

export function ProbeMarker({
  position,
  targetId,
  onSelect,
}: {
  position: [number, number, number];
  targetId: string;
  onSelect: () => void;
}) {
  const hitMeshRef = useRef<Mesh>(null);
  const { camera, size } = useThree();

  // The invisible hit-target sphere is a unit sphere whose *scale* we keep
  // updated every frame so it always subtends ~HIT_TARGET_PX on screen,
  // regardless of how far OrbitControls has zoomed the camera in or out --
  // a fixed world-space radius would only be right at one particular zoom
  // level, which matters a lot on mobile where pinch-zoom is the norm.
  useFrame(() => {
    if (!hitMeshRef.current) return;
    const dx = camera.position.x - position[0];
    const dy = camera.position.y - position[1];
    const dz = camera.position.z - position[2];
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const fovDeg = (camera as PerspectiveCamera).fov ?? 40;
    const desiredWorldRadius = pcbHitTargetWorldRadius(distance, fovDeg, size.height, HIT_TARGET_PX);
    hitMeshRef.current.scale.setScalar(desiredWorldRadius);
  });

  return (
    <group position={position}>
      <mesh
        ref={hitMeshRef}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        data-testid={`probe-marker-${targetId}`}
      >
        <sphereGeometry args={[1, 8, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh raycast={() => null}>
        <sphereGeometry args={[VISIBLE_RADIUS_M, 12, 12]} />
        <meshStandardMaterial color="#e0a800" />
      </mesh>
    </group>
  );
}

// A floating indicator for wherever the red/black lead actually landed --
// unlike ProbeMarker (one per fixed pad location), a lead placed on a wire
// or copper trace has no pre-existing marker to recolor, so this renders
// independently at the lead's exact (x_mm, y_mm) landing point.
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
  if (!device.pcb_glb || device.board_thickness_mm === undefined || !device.board_size_mm) {
    return <p className="error">No PCB import yet for this device (run the importer first).</p>;
  }

  const currentFault = device.faults.find((f) => f.id === faultId);
  const shown = visibleResult(result, leads);
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

  function place(target: ProbeTarget) {
    setLeads((prev) => placeLead(prev, target));
  }

  // Pad clicks are handled by each ProbeMarker's own hit-sphere (which
  // stopPropagation()s), so this only fires for a click that missed every
  // pad -- i.e. somewhere on the board body or a copper trace. The click's
  // world-space intersection point converts back to board mm coordinates
  // (inverting pcbMmToThreeVec3's X/Z mapping) and is hit-tested against the
  // real track manifest geometry, exactly like the schematic view's wires --
  // same "exact parsed geometry, not proximity-guessing" principle, just in
  // 3D. A click that also misses every track (empty board area) is a no-op.
  function handleBoardClick(e: ThreeEvent<MouseEvent>) {
    e.stopPropagation();
    if (!device) return;
    const xMm = e.point.x * 1000;
    const yMm = e.point.z * 1000;
    const segments = device.pcb_tracks.map((t) => ({
      x1: t.x1_mm,
      y1: t.y1_mm,
      x2: t.x2_mm,
      y2: t.y2_mm,
      node: t.node,
    }));
    const hit = hitTestSegments(xMm, yMm, segments, TRACK_HIT_TOLERANCE_MM);
    if (!hit) return;
    place({
      targetId: `track:${hit.node}:${hit.x.toFixed(2)}:${hit.y.toFixed(2)}`,
      node: hit.node,
      x: hit.x,
      y: hit.y,
    });
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

      <div className="pcb-stage" style={{ width: 500, height: 400 }}>
        <Canvas
          camera={{ position: framing.position, near: framing.near, far: framing.far, fov: 40 }}
        >
          <ambientLight intensity={0.6} />
          <directionalLight position={[framing.target[0], framing.target[1] + framing.far / 20, framing.target[2]]} intensity={1.2} />
          <PcbModel url={glbUrl} onBoardClick={handleBoardClick} />
          {device.pcb_pads.map((pad) => {
            const targetId = `${pad.ref}:${pad.pin}`;
            return (
              <ProbeMarker
                key={targetId}
                targetId={targetId}
                position={pcbMmToThreeVec3(pad.x_mm, pad.y_mm, boardThicknessMm)}
                onSelect={() => place({ targetId, node: pad.node, x: pad.x_mm, y: pad.y_mm })}
              />
            );
          })}
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
          <OrbitControls target={framing.target} minPolarAngle={0.15} maxPolarAngle={1.45} />
        </Canvas>
      </div>

      <p className="hint">
        Drag to orbit. Click a pad, or anywhere along a copper trace, to place the red lead, then the black lead.
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
