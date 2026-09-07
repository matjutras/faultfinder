import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { deviceAssetUrl, getDevice, measure } from './api';
import { isContinuous } from './continuity';
import { apiDmmMode, formatDmmReading } from './dmmDisplay';
import { resolveSchematicDropTarget } from './dropTargets';
import { FaultGuess } from './FaultGuess';
import type { Difficulty } from './faultSelection';
import { pickRandomFault } from './faultSelection';
import { Multimeter } from './Multimeter';
import type { Leads, LeadColor, Measurement } from './probeSelection';
import { EMPTY_LEADS, selectedNodes, setLead, visibleResult } from './probeSelection';
import './SchematicProbeView.css';
import type { Device, MultimeterMode } from './types';
import { useContinuityBeep } from './useContinuityBeep';
import { useElementSize } from './useElementSize';
import { useLongPressDrag } from './useLongPressDrag';
import { useTapGesture } from './useTapGesture';

// At the old 500x354 (~3.2px/mm against the 100x110mm page), adjacent TP
// markers needed >13.6mm of separation just for their 44px tap targets not
// to overlap -- every device's real spacing (7.6-12.7mm, driven by realistic
// component/pin geometry) fell short somewhere, confirmed by measuring
// actual rendered marker bounding boxes for pairwise overlap, not by
// eyeballing it. 800x880 (~8px/mm) only needs 5.5mm of separation, clearing
// every device's tightest gap with margin -- these are now just the initial/
// fallback size (see useElementSize.ts): milestone 11 makes the stage fill
// whatever real space the full-viewport layout gives it, and
// resolveSchematicDropTarget/schematicMmToPixels already take the
// container's actual width/height as plain parameters, not a hardcoded
// constant, so a real measured size threads through the same way.
const FALLBACK_SIZE = { width: 800, height: 880 };
const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard', 'random'];

interface Props {
  deviceId: string;
  onGuess?: (correct: boolean, firstTryThisRound: boolean) => void;
  // Where to portal the device-name heading, the round controls (New Fault/
  // Reveal fault), and the difficulty picker, so App.tsx's slim
  // always-visible bar and collapsible menu (milestone 11) can host controls
  // this component still owns the state for. Left undefined (as every
  // existing unit test renders this component) renders them inline in their
  // old spot instead -- this component works standalone either way.
  titlePortalTarget?: HTMLElement | null;
  actionsPortalTarget?: HTMLElement | null;
  menuPortalTarget?: HTMLElement | null;
}

export function SchematicProbeView({
  deviceId,
  onGuess = () => {},
  titlePortalTarget,
  actionsPortalTarget,
  menuPortalTarget,
}: Props) {
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
  // The marker actively being long-press-dragged, at its live (unsnapped)
  // pointer position -- overrides that lead's stored position only while
  // dragging; on release it either resolves to a real new target (place())
  // or, if none was under the final point, just reverts to rendering from
  // `leads` again, i.e. springs back.
  const [dragPreview, setDragPreview] = useState<{ color: LeadColor; x: number; y: number } | null>(null);
  // A state-tracked element, not a plain useRef -- see useElementSize.ts for
  // why a plain ref's `.current` doesn't reliably re-trigger the size
  // effect on this component's own second render (once its device finishes
  // loading and the stage div first exists).
  const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null);
  const stageSize = useElementSize(stageEl, FALLBACK_SIZE);

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
    if (!device || !stageEl) return;
    const rect = stageEl.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const target = resolveSchematicDropTarget(
      localX,
      localY,
      device,
      stageSize.width,
      stageSize.height,
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

  function resetLeads() {
    setLeads(EMPTY_LEADS);
    setArmedLead(null);
  }

  const shown = visibleResult(measurement, leads, mode);
  useContinuityBeep(mode === 'continuity' && isContinuous(shown?.resistance_ohms));

  if (error && !device) return <p className="error">Error: {error}</p>;
  if (!device) return <p>Loading device…</p>;

  const currentFault = device.faults.find((f) => f.id === faultId);

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

  return (
    <div className="schematic-probe-view">
      {titlePortalTarget ? createPortal(<h2>{device.name}</h2>, titlePortalTarget) : <h2>{device.name}</h2>}

      {actionsPortalTarget ? createPortal(roundControls, actionsPortalTarget) : roundControls}
      {menuPortalTarget ? createPortal(difficultyControl, menuPortalTarget) : difficultyControl}

      <div className="probe-workspace">
        <div
          ref={setStageEl}
          className="schematic-stage"
          data-testid="probe-stage"
          style={{ cursor: armedLead ? 'crosshair' : 'default' }}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
        >
          <kicanvas-embed
            src={deviceAssetUrl(deviceId, device.schematic_sch)}
            controls="none"
            style={{ width: stageSize.width, height: stageSize.height, display: 'block' }}
          />
          {leads.red && (
            <LeadMarker
              color="red"
              x={dragPreview?.color === 'red' ? dragPreview.x : leads.red.x}
              y={dragPreview?.color === 'red' ? dragPreview.y : leads.red.y}
              stageEl={stageEl}
              onDragMove={(x, y) => setDragPreview({ color: 'red', x, y })}
              onDragEnd={(clientX, clientY) => {
                setDragPreview(null);
                place('red', clientX, clientY);
              }}
            />
          )}
          {leads.black && (
            <LeadMarker
              color="black"
              x={dragPreview?.color === 'black' ? dragPreview.x : leads.black.x}
              y={dragPreview?.color === 'black' ? dragPreview.y : leads.black.y}
              stageEl={stageEl}
              onDragMove={(x, y) => setDragPreview({ color: 'black', x, y })}
              onDragEnd={(clientX, clientY) => {
                setDragPreview(null);
                place('black', clientX, clientY);
              }}
            />
          )}
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
            Click a lead on the multimeter, then tap any pin or wire to place it. Long-press a placed lead to drag it
            to a new point.
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

function LeadMarker({
  color,
  x,
  y,
  stageEl,
  onDragMove,
  onDragEnd,
}: {
  color: LeadColor;
  x: number;
  y: number;
  stageEl: HTMLDivElement | null;
  onDragMove: (localX: number, localY: number) => void;
  onDragEnd: (clientX: number, clientY: number) => void;
}) {
  const longPress = useLongPressDrag(
    () => {},
    (clientX, clientY) => {
      const rect = stageEl?.getBoundingClientRect();
      if (!rect) return;
      onDragMove(clientX - rect.left, clientY - rect.top);
    },
    onDragEnd,
  );

  return (
    <div
      className={`lead-marker ${color} ${longPress.dragging ? 'dragging' : ''}`}
      style={{ left: x, top: y }}
      data-testid={`lead-${color}`}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        longPress.down(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        e.stopPropagation();
        longPress.move(e.clientX, e.clientY);
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        e.currentTarget.releasePointerCapture?.(e.pointerId);
        longPress.up(e.clientX, e.clientY);
      }}
      onPointerCancel={(e) => {
        e.stopPropagation();
        longPress.cancel();
      }}
    />
  );
}
