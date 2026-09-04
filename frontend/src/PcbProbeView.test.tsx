import { render, screen } from '@testing-library/react';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { useEffect, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import * as api from './api';
import { PcbProbeView, ProbeMarker } from './PcbProbeView';
import { toggleProbe, visibleResult } from './probeSelection';
import type { Device, MeasureResult } from './types';

const DEVICE: Device = {
  id: 'voltage_divider_01',
  name: 'Simple Voltage Divider',
  schematic_sch: 'voltage_divider_01.kicad_sch',
  pcb_glb: 'pcb.glb',
  board_size_mm: { width: 36, height: 24 },
  board_thickness_mm: 1.51,
  testpoints: [
    { tp_id: 'TP1', label: 'Input (VIN)', node: 'VIN', x_mm: 101.6, y_mm: 81.28, pcb_x_mm: 30, pcb_y_mm: 6 },
    { tp_id: 'TP2', label: 'Output (VOUT)', node: 'VOUT', x_mm: 101.6, y_mm: 111.76, pcb_x_mm: 6, pcb_y_mm: 18 },
  ],
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
  it('calls onSelect with its own tp_id when clicked, via real three.js raycasting', async () => {
    const onSelect = vi.fn();
    const renderer = await ReactThreeTestRenderer.create(
      <ProbeMarker position={[0.01, 0.002, 0.02]} tpId="TP1" selected={false} onSelect={onSelect} />,
    );

    const mesh = renderer.scene.findByProps({ 'data-testid': 'probe-marker-TP1' });
    await renderer.fireEvent(mesh, 'click');

    expect(onSelect).toHaveBeenCalledWith('TP1');
  });
});

// A minimal stand-in for PcbProbeView's own state wiring (toggleProbe +
// visibleResult + a `selected`-driven effect that fetches a measurement),
// built from the same production modules PcbProbeView imports. This lets a
// third real raycasted click drive the exact same stale-result-vs-selection
// race that used to crash the real component, without needing a DOM Canvas
// (@react-three/test-renderer can't mix in host DOM elements -- see
// PcbProbeView's own <div>/<p> wrapper, which is why this only covers the
// r3f scene, not the full page).
const HARNESS_VOLTS: Record<string, number> = { TP1: 9, TP2: 0, TP3: 6 };

function ThreeProbeSelectionHarness() {
  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<MeasureResult | null>(null);

  useEffect(() => {
    if (selected.length !== 2) {
      setResult(null);
      return;
    }
    const probes = Object.fromEntries(selected.map((id) => [id, HARNESS_VOLTS[id]]));
    setResult({ fault_id: 'healthy', probes, differential_volts: probes[selected[0]] - probes[selected[1]] });
  }, [selected]);

  const shown = visibleResult(result, selected);
  if (shown) {
    // Exercises the exact read that used to throw: .toFixed() on a probe
    // value from a `result` that didn't match the freshly-slid `selected`.
    void shown.differential_volts.toFixed(3);
    void shown.probes[selected[0]].toFixed(3);
    void shown.probes[selected[1]].toFixed(3);
  }

  const onSelect = (tpId: string) => setSelected((prev) => toggleProbe(prev, tpId));

  return (
    <>
      <ProbeMarker position={[0, 0, 0]} tpId="TP1" selected={selected.includes('TP1')} onSelect={onSelect} />
      <ProbeMarker position={[0, 0, 0.02]} tpId="TP2" selected={selected.includes('TP2')} onSelect={onSelect} />
      <ProbeMarker position={[0, 0, 0.04]} tpId="TP3" selected={selected.includes('TP3')} onSelect={onSelect} />
    </>
  );
}

describe('PcbProbeView probe selection integration', () => {
  it('does not crash when a third probe sphere is clicked via real raycasting, and slides to the new pair', async () => {
    const renderer = await ReactThreeTestRenderer.create(<ThreeProbeSelectionHarness />);

    const findMarker = (tpId: string) => renderer.scene.findByProps({ 'data-testid': `probe-marker-${tpId}` });

    await renderer.fireEvent(findMarker('TP1'), 'click');
    await renderer.fireEvent(findMarker('TP2'), 'click');
    // This third click used to throw ("Cannot read properties of undefined
    // (reading 'toFixed')") and unmount the whole tree.
    await renderer.fireEvent(findMarker('TP3'), 'click');

    const colorOf = (tpId: string) => {
      const group = findMarker(tpId).parent!; // <group> wrapping the hit-target + visible meshes
      const visibleMesh = group.children.find((c) => !('data-testid' in c.props));
      return visibleMesh?.allChildren.find((m) => /meshstandardmaterial/i.test(m.type))?.props.color;
    };
    const SELECTED = '#1b6fd6';
    const UNSELECTED = '#e0a800';

    expect(colorOf('TP1')).toBe(UNSELECTED); // dropped, oldest
    expect(colorOf('TP2')).toBe(SELECTED); // kept
    expect(colorOf('TP3')).toBe(SELECTED); // newly added
  });
});
