import { OrbitControls, useGLTF } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import type { Mesh, PerspectiveCamera } from 'three';
import { deviceAssetUrl, getDevice, measure } from './api';
import { FaultGuess } from './FaultGuess';
import type { Difficulty } from './faultSelection';
import { pickRandomFault } from './faultSelection';
import { pcbCameraFraming, pcbHitTargetWorldRadius, pcbMmToThreeVec3 } from './kicadCoords';
import { toggleProbe, visibleResult } from './probeSelection';
import './SchematicProbeView.css';
import type { Device, MeasureResult } from './types';

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard', 'random'];

interface Props {
  deviceId: string;
  onGuess?: (correct: boolean, firstTryThisRound: boolean) => void;
}

function PcbModel({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  return <primitive object={scene} />;
}

const VISIBLE_RADIUS_M = 0.0006;
const HIT_TARGET_PX = 44; // matches the ~44x44 CSS px tap target used for the 2D schematic markers

export function ProbeMarker({
  position,
  tpId,
  selected,
  onSelect,
}: {
  position: [number, number, number];
  tpId: string;
  selected: boolean;
  onSelect: (tpId: string) => void;
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
          onSelect(tpId);
        }}
        data-testid={`probe-marker-${tpId}`}
      >
        <sphereGeometry args={[1, 8, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh raycast={() => null}>
        <sphereGeometry args={[VISIBLE_RADIUS_M, 12, 12]} />
        <meshStandardMaterial
          color={selected ? '#1b6fd6' : '#e0a800'}
          emissive={selected ? '#1b6fd6' : '#000000'}
        />
      </mesh>
    </group>
  );
}

export function PcbProbeView({ deviceId, onGuess = () => {} }: Props) {
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
  if (!device.pcb_glb || device.board_thickness_mm === undefined || !device.board_size_mm) {
    return <p className="error">No PCB import yet for this device (run the importer first).</p>;
  }

  const currentFault = device.faults.find((f) => f.id === faultId);
  const shown = visibleResult(result, selected);
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

      <div className="pcb-stage" style={{ width: 500, height: 400 }}>
        <Canvas
          camera={{ position: framing.position, near: framing.near, far: framing.far, fov: 40 }}
        >
          <ambientLight intensity={0.6} />
          <directionalLight position={[framing.target[0], framing.target[1] + framing.far / 20, framing.target[2]]} intensity={1.2} />
          <PcbModel url={glbUrl} />
          {device.testpoints.map((tp) => {
            if (tp.pcb_x_mm === undefined || tp.pcb_y_mm === undefined) return null;
            return (
              <ProbeMarker
                key={tp.tp_id}
                tpId={tp.tp_id}
                position={pcbMmToThreeVec3(tp.pcb_x_mm, tp.pcb_y_mm, boardThicknessMm)}
                selected={selected.includes(tp.tp_id)}
                onSelect={(tpId) => setSelected((prev) => toggleProbe(prev, tpId))}
              />
            );
          })}
          <OrbitControls target={framing.target} minPolarAngle={0.15} maxPolarAngle={1.45} />
        </Canvas>
      </div>

      <p className="hint">Drag to orbit, click a probe sphere to place a probe.</p>

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
