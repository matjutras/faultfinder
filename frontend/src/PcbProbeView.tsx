import { Html, OrbitControls, useGLTF } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { deviceAssetUrl, getDevice, measure } from './api';
import { isContinuous } from './continuity';
import { apiDmmMode, formatDmmReading } from './dmmDisplay';
import { resolvePcbDropTarget } from './dropTargets';
import { FaultGuess } from './FaultGuess';
import type { Difficulty } from './faultSelection';
import { pickRandomFault } from './faultSelection';
import { pcbCameraFraming, pcbMmToThreeVec3 } from './kicadCoords';
import { Multimeter } from './Multimeter';
import { componentLabelPositions } from './pcbLabels';
import type { Leads, LeadColor, Measurement } from './probeSelection';
import { EMPTY_LEADS, selectedNodes, setLead, visibleResult } from './probeSelection';
import { screenToBoardMm } from './pcbRaycast';
import './SchematicProbeView.css';
import type { Device, MultimeterMode } from './types';
import { useContinuityBeep } from './useContinuityBeep';
import { useLongPressDrag } from './useLongPressDrag';
import { useTapGesture } from './useTapGesture';

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard', 'random'];

interface Props {
  deviceId: string;
  onGuess?: (correct: boolean, firstTryThisRound: boolean) => void;
  // See SchematicProbeView.tsx's identical props: portals the device-name
  // heading/round controls/difficulty picker into App.tsx's shared slim bar
  // and menu (milestone 11) when given, else renders them inline (every
  // existing unit test's mode).
  titlePortalTarget?: HTMLElement | null;
  actionsPortalTarget?: HTMLElement | null;
  menuPortalTarget?: HTMLElement | null;
}

function PcbModel({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  return <primitive object={scene} />;
}

export interface PcbRaycastHandle {
  screenToWorldMm: (clientX: number, clientY: number) => { xMm: number; yMm: number } | null;
}

// Lives inside <Canvas> (needs useThree for the real camera/renderer) and
// exposes a plain screen-point -> board-mm conversion imperatively, so a tap
// handled *outside* the canvas (in the plain DOM onPointerUp from
// useTapGesture) can still raycast through the real camera at that point --
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
// Also the long-press-drag handle for repositioning it (milestone 11): a
// real mesh pointer-down disables the parent's OrbitControls for the whole
// gesture (any interaction starting here, tap or hold, never orbits the
// camera -- simpler and more robust than only disabling once a hold is
// confirmed) and tracks the rest of the gesture via window-level pointer
// listeners rather than further mesh events, since the pointer almost
// immediately leaves this tiny sphere's own raycast hit area once dragging.
export function LeadIndicator({
  xMm,
  yMm,
  boardThicknessMm,
  color,
  testId,
  onMarkerPointerDown,
  onMarkerPointerUp,
  onDragMove,
  onDragEnd,
}: {
  xMm: number;
  yMm: number;
  boardThicknessMm: number;
  color: string;
  testId?: string;
  onMarkerPointerDown?: () => void;
  onMarkerPointerUp?: () => void;
  onDragMove?: (clientX: number, clientY: number) => void;
  onDragEnd?: (clientX: number, clientY: number) => void;
}) {
  const VISIBLE_RADIUS_M = 0.0006;
  const longPress = useLongPressDrag(
    () => {},
    (x, y) => onDragMove?.(x, y),
    (x, y) => onDragEnd?.(x, y),
  );

  function handlePointerDown(e: ThreeEvent<PointerEvent>) {
    e.stopPropagation();
    onMarkerPointerDown?.();
    longPress.down(e.clientX, e.clientY);

    const onWindowMove = (ev: PointerEvent) => longPress.move(ev.clientX, ev.clientY);
    const onWindowUp = (ev: PointerEvent) => {
      longPress.up(ev.clientX, ev.clientY);
      onMarkerPointerUp?.();
      window.removeEventListener('pointermove', onWindowMove);
      window.removeEventListener('pointerup', onWindowUp);
    };
    window.addEventListener('pointermove', onWindowMove);
    window.addEventListener('pointerup', onWindowUp);
  }

  return (
    <mesh
      position={pcbMmToThreeVec3(xMm, yMm, boardThicknessMm)}
      onPointerDown={handlePointerDown}
      data-testid={testId}
    >
      <sphereGeometry args={[VISIBLE_RADIUS_M * (longPress.dragging ? 1.8 : 1.3), 12, 12]} />
      <meshStandardMaterial color={color} emissive={color} />
    </mesh>
  );
}

export function PcbProbeView({ deviceId, onGuess = () => {}, titlePortalTarget, actionsPortalTarget, menuPortalTarget }: Props) {
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
  const [showHint, setShowHint] = useState(false);
  // See SchematicProbeView.tsx's identical field: the marker actively being
  // long-press-dragged, at its live (unsnapped) raycast position -- overrides
  // that lead's stored position only while dragging.
  const [dragPreview, setDragPreview] = useState<{ color: LeadColor; xMm: number; yMm: number } | null>(null);
  const raycastRef = useRef<PcbRaycastHandle>(null);
  const orbitRef = useRef<OrbitControlsImpl>(null);

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
    measure(deviceId, nodes, faultId, apiDmmMode(mode))
      .then((result) => setMeasurement({ nodes, mode, result }))
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, nodes?.[0], nodes?.[1], faultId, mode]);

  function place(color: LeadColor, clientX: number, clientY: number) {
    if (!device) return;
    const worldMm = raycastRef.current?.screenToWorldMm(clientX, clientY);
    if (!worldMm) return;
    const target = resolvePcbDropTarget(worldMm.xMm, worldMm.yMm, device);
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

  function resetLeads() {
    setLeads(EMPTY_LEADS);
    setArmedLead(null);
  }

  function disableOrbit() {
    if (orbitRef.current) orbitRef.current.enabled = false;
  }

  function enableOrbit() {
    if (orbitRef.current) orbitRef.current.enabled = true;
  }

  function dragMoveFor(color: LeadColor) {
    return (clientX: number, clientY: number) => {
      const worldMm = raycastRef.current?.screenToWorldMm(clientX, clientY);
      if (!worldMm) return;
      setDragPreview({ color, xMm: worldMm.xMm, yMm: worldMm.yMm });
    };
  }

  function dragEndFor(color: LeadColor) {
    return (clientX: number, clientY: number) => {
      setDragPreview(null);
      place(color, clientX, clientY);
    };
  }

  const shown = visibleResult(measurement, leads, mode);
  useContinuityBeep(mode === 'continuity' && isContinuous(shown?.resistance_ohms));

  if (error && !device) return <p className="error">Error: {error}</p>;
  if (!device) return <p>Loading device…</p>;
  if (!device.pcb_glb || device.board_thickness_mm === undefined || !device.board_size_mm) {
    return <p className="error">No PCB import yet for this device (run the importer first).</p>;
  }

  const currentFault = device.faults.find((f) => f.id === faultId);
  const glbUrl = deviceAssetUrl(deviceId, device.pcb_glb);
  const boardThicknessMm = device.board_thickness_mm;
  const framing = pcbCameraFraming(device.board_size_mm, boardThicknessMm);
  const componentLabels = componentLabelPositions(device.pcb_pads);

  function newFault(tier: Difficulty) {
    if (!device) return;
    setDifficulty(tier);
    setFaultId(pickRandomFault(device.faults, tier).id);
    setRevealed(false);
    setRound((r) => r + 1);
  }

  const roundControls = (
    <>
      <button type="button" onClick={() => newFault(difficulty)}>
        New Fault
      </button>{' '}
      <button type="button" onClick={() => setRevealed((r) => !r)}>
        {revealed ? 'Hide fault' : 'Reveal fault'}
      </button>
      {revealed && currentFault && <p className="revealed-fault">Fault: {currentFault.name}</p>}
    </>
  );

  const difficultyControl = (
    <label>
      Difficulty:{' '}
      <select value={difficulty} onChange={(e) => newFault(e.target.value as Difficulty)}>
        {DIFFICULTIES.map((tier) => (
          <option key={tier} value={tier}>
            {tier}
          </option>
        ))}
      </select>
    </label>
  );

  const title = <h2>{device.name} — PCB view</h2>;

  function leadPosition(color: LeadColor): { xMm: number; yMm: number } | null {
    if (dragPreview?.color === color) return dragPreview;
    const lead = leads[color];
    return lead ? { xMm: lead.x, yMm: lead.y } : null;
  }

  const redPos = leadPosition('red');
  const blackPos = leadPosition('black');

  return (
    <div className="schematic-probe-view">
      {titlePortalTarget ? createPortal(title, titlePortalTarget) : title}

      {actionsPortalTarget ? createPortal(roundControls, actionsPortalTarget) : roundControls}
      {menuPortalTarget ? createPortal(difficultyControl, menuPortalTarget) : difficultyControl}

      <div className="probe-workspace">
        <div
          className="pcb-stage"
          data-testid="probe-stage"
          style={{ cursor: armedLead ? 'crosshair' : 'auto' }}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
        >
          <Canvas camera={{ position: framing.position, near: framing.near, far: framing.far, fov: 40 }}>
            <ambientLight intensity={0.6} />
            <directionalLight
              position={[framing.target[0], framing.target[1] + framing.far / 20, framing.target[2]]}
              intensity={1.2}
            />
            <PcbModel url={glbUrl} />
            {componentLabels.map((label) => (
              <Html
                key={label.ref}
                position={pcbMmToThreeVec3(label.xMm, label.yMm, boardThicknessMm)}
                center
                className="pcb-ref-label"
                style={{ pointerEvents: 'none' }}
              >
                {label.ref}
              </Html>
            ))}
            <DropRaycaster ref={raycastRef} boardThicknessMm={boardThicknessMm} />
            {redPos && (
              <LeadIndicator
                xMm={redPos.xMm}
                yMm={redPos.yMm}
                boardThicknessMm={boardThicknessMm}
                color="#c0392b"
                testId="lead-red"
                onMarkerPointerDown={disableOrbit}
                onMarkerPointerUp={enableOrbit}
                onDragMove={dragMoveFor('red')}
                onDragEnd={dragEndFor('red')}
              />
            )}
            {blackPos && (
              <LeadIndicator
                xMm={blackPos.xMm}
                yMm={blackPos.yMm}
                boardThicknessMm={boardThicknessMm}
                color="#1a1a1a"
                testId="lead-black"
                onMarkerPointerDown={disableOrbit}
                onMarkerPointerUp={enableOrbit}
                onDragMove={dragMoveFor('black')}
                onDragEnd={dragEndFor('black')}
              />
            )}
            <OrbitControls
              ref={orbitRef}
              target={framing.target}
              minPolarAngle={0.05}
              maxPolarAngle={Math.PI - 0.05}
              zoomToCursor
            />
          </Canvas>
        </div>

        <div className="multimeter-overlay">
          <Multimeter
            mode={mode}
            onModeChange={setMode}
            display={formatDmmReading(mode, shown)}
            redPlaced={leads.red !== null}
            blackPlaced={leads.black !== null}
            armedLead={armedLead}
            onLeadClick={onLeadClick}
            onReset={resetLeads}
          />
        </div>

        <button
          type="button"
          className="hint-button"
          aria-label="How to use this view"
          aria-expanded={showHint}
          onClick={() => setShowHint((s) => !s)}
        >
          ?
        </button>
        {showHint && (
          <p className="hint-tooltip" role="tooltip">
            Drag to orbit the board. Click a lead on the multimeter, then tap a pad or copper trace to place it.
            Long-press a placed lead to drag it to a new point.
          </p>
        )}
      </div>

      {error && <p className="error">Error: {error}</p>}

      <div className="fault-guess-bar">
        <FaultGuess key={round} faults={device.faults} actualFaultId={faultId} onGuess={onGuess} />
      </div>
    </div>
  );
}
