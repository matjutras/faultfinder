import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import * as api from './api';
import { PcbProbeView } from './PcbProbeView';
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

  it('renders the multimeter with neither lead placed yet, and the TP-orb markers are gone', async () => {
    vi.spyOn(api, 'getDevice').mockResolvedValue(DEVICE);
    vi.spyOn(api, 'deviceAssetUrl').mockReturnValue('/pcb.glb');
    vi.spyOn(Math, 'random').mockReturnValue(0);

    render(<PcbProbeView deviceId="voltage_divider_01" />);
    await screen.findByText('Simple Voltage Divider — PCB view');

    expect(screen.getByTestId('lead-drag-red')).not.toHaveClass('placed');
    expect(screen.getByTestId('lead-drag-black')).not.toHaveClass('placed');
    // The old click-to-place hint/copy this view shipped with is gone.
    expect(screen.queryByText(/click.*test point/i)).not.toBeInTheDocument();
  });

  it('a drag that starts and drops without a resolvable board point does not crash and leaves the lead unplaced', async () => {
    // jsdom has no real WebGL, so the canvas this drop would raycast through
    // never produces a usable camera/board point here -- this is a smoke
    // test that the drag lifecycle (pointerdown -> window pointerup ->
    // raycast miss -> no-op) is safe end to end, not a geometry check (that's
    // pcbRaycast.test.ts and dropTargets.test.ts, both against real math).
    vi.spyOn(api, 'getDevice').mockResolvedValue(DEVICE);
    vi.spyOn(api, 'deviceAssetUrl').mockReturnValue('/pcb.glb');
    vi.spyOn(Math, 'random').mockReturnValue(0);

    render(<PcbProbeView deviceId="voltage_divider_01" />);
    await screen.findByText('Simple Voltage Divider — PCB view');

    fireEvent.pointerDown(screen.getByTestId('lead-drag-red'), { clientX: 0, clientY: 0 });
    fireEvent.pointerUp(window, { clientX: 250, clientY: 200 });

    expect(screen.getByTestId('lead-drag-red')).not.toHaveClass('placed');
  });
});
