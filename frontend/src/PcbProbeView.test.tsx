import { render, screen } from '@testing-library/react';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import * as api from './api';
import { LeadIndicator, PcbProbeView, ProbeMarker } from './PcbProbeView';
import type { Leads, ProbeTarget } from './probeSelection';
import { EMPTY_LEADS, placeLead } from './probeSelection';
import type { Device } from './types';

const DEVICE: Device = {
  id: 'voltage_divider_01',
  name: 'Simple Voltage Divider',
  schematic_sch: 'voltage_divider_01.kicad_sch',
  pcb_glb: 'pcb.glb',
  board_size_mm: { width: 36, height: 24 },
  board_thickness_mm: 1.51,
  pins: [],
  wires: [],
  pcb_pads: [
    { ref: 'TP1', pin: '1', node: 'VIN', x_mm: 30, y_mm: 6 },
    { ref: 'TP2', pin: '1', node: 'VOUT', x_mm: 6, y_mm: 18 },
  ],
  pcb_tracks: [],
  faults: [
    { id: 'healthy', name: 'No fault', difficulty: 'n/a', patch: [] },
    { id: 'r1_open', name: 'R1 open circuit', difficulty: 'easy', patch: [{ ref: 'R1', to: '1e12' }] },
  ],
};

describe('PcbProbeView', () => {
  it('renders the device name and difficulty controls once loaded', async () => {
    vi.spyOn(api, 'getDevice').mockResolvedValue(DEVICE);
    vi.spyOn(api, 'deviceAssetUrl').mockReturnValue('/pcb.glb');
    vi.spyOn(Math, 'random').mockReturnValue(0);

    render(<PcbProbeView deviceId="voltage_divider_01" />);

    expect(await screen.findByText('Simple Voltage Divider — PCB view')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New Fault' })).toBeInTheDocument();
  });

  it('shows a message instead of a canvas when the device has no PCB import yet', async () => {
    vi.spyOn(api, 'getDevice').mockResolvedValue({
      ...DEVICE,
      pcb_glb: undefined,
      board_thickness_mm: undefined,
    });

    render(<PcbProbeView deviceId="voltage_divider_01" />);

    expect(await screen.findByText(/No PCB import yet/)).toBeInTheDocument();
  });
});

describe('ProbeMarker', () => {
  it('calls onSelect when clicked, via real three.js raycasting', async () => {
    const onSelect = vi.fn();
    const renderer = await ReactThreeTestRenderer.create(
      <ProbeMarker position={[0.01, 0.002, 0.02]} targetId="TP1:1" onSelect={onSelect} />,
    );

    const mesh = renderer.scene.findByProps({ 'data-testid': 'probe-marker-TP1:1' });
    await renderer.fireEvent(mesh, 'click');

    expect(onSelect).toHaveBeenCalled();
  });
});

// A minimal stand-in for PcbProbeView's own state wiring (placeLead +
// LeadIndicator rendering, driven by real ProbeMarker clicks), built from the
// same production modules PcbProbeView imports. This lets a third real
// raycasted click drive the exact same lead-sliding logic the real component
// uses, without needing a DOM Canvas (@react-three/test-renderer can't mix in
// host DOM elements -- see PcbProbeView's own <div>/<p> wrapper, which is why
// this only covers the r3f scene, not the full page).
const TARGETS: Record<string, ProbeTarget> = {
  TP1: { targetId: 'TP1:1', node: 'VIN', x: 0, y: 0 },
  TP2: { targetId: 'TP2:1', node: 'VOUT', x: 1, y: 0 },
  TP3: { targetId: 'TP3:1', node: '0', x: 2, y: 0 },
};

function ThreeProbeSelectionHarness() {
  const [leads, setLeads] = useState<Leads>(EMPTY_LEADS);
  const place = (t: ProbeTarget) => setLeads((prev) => placeLead(prev, t));

  return (
    <>
      <ProbeMarker position={[0, 0, 0]} targetId="TP1:1" onSelect={() => place(TARGETS.TP1)} />
      <ProbeMarker position={[0, 0, 0.02]} targetId="TP2:1" onSelect={() => place(TARGETS.TP2)} />
      <ProbeMarker position={[0, 0, 0.04]} targetId="TP3:1" onSelect={() => place(TARGETS.TP3)} />
      {leads.red && (
        <LeadIndicator xMm={leads.red.x} yMm={leads.red.y} boardThicknessMm={0} color="#c0392b" testId="lead-red" />
      )}
      {leads.black && (
        <LeadIndicator
          xMm={leads.black.x}
          yMm={leads.black.y}
          boardThicknessMm={0}
          color="#1a1a1a"
          testId="lead-black"
        />
      )}
    </>
  );
}

describe('PcbProbeView probe selection integration', () => {
  it('does not crash when a third probe sphere is clicked via real raycasting, and slides to the new pair', async () => {
    const renderer = await ReactThreeTestRenderer.create(<ThreeProbeSelectionHarness />);

    const findMarker = (targetId: string) => renderer.scene.findByProps({ 'data-testid': `probe-marker-${targetId}` });

    await renderer.fireEvent(findMarker('TP1:1'), 'click'); // -> red
    await renderer.fireEvent(findMarker('TP2:1'), 'click'); // -> black
    // This third click used to throw ("Cannot read properties of undefined
    // (reading 'toFixed')") in the old selection-window model -- verifying
    // the equivalent slide (red dropped, black -> red, new -> black) here.
    await renderer.fireEvent(findMarker('TP3:1'), 'click');

    const redLead = renderer.scene.findByProps({ 'data-testid': 'lead-red' });
    const blackLead = renderer.scene.findByProps({ 'data-testid': 'lead-black' });

    expect(redLead.props.position[0]).toBeCloseTo(TARGETS.TP2.x / 1000); // TP2 slid into red
    expect(blackLead.props.position[0]).toBeCloseTo(TARGETS.TP3.x / 1000); // TP3 newly placed as black
  });
});
