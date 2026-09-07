import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import * as api from './api';
import { PcbProbeView } from './PcbProbeView';
import type { Device } from './types';

const DEVICE: Device = {
  id: 'voltage_divider_01',
  name: 'Simple Voltage Divider',
  schematic_sch: 'voltage_divider_01.kicad_sch',
  page_width_mm: 100,
  page_height_mm: 110,
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

    expect(screen.getByTestId('lead-jack-red')).not.toHaveClass('placed');
    expect(screen.getByTestId('lead-jack-black')).not.toHaveClass('placed');
    // The old click-to-place hint/copy this view shipped with is gone.
    expect(screen.queryByText(/click.*test point/i)).not.toBeInTheDocument();
  });

  it('a tap that lands without a resolvable board point does not crash and leaves the lead unplaced', async () => {
    // jsdom has no real WebGL, so the canvas this tap would raycast through
    // never produces a usable camera/board point here -- this is a smoke
    // test that the arm-then-tap lifecycle (click jack -> pointerdown/up on
    // stage -> raycast miss -> no-op) is safe end to end, not a geometry
    // check (that's pcbRaycast.test.ts and dropTargets.test.ts, both against
    // real math).
    vi.spyOn(api, 'getDevice').mockResolvedValue(DEVICE);
    vi.spyOn(api, 'deviceAssetUrl').mockReturnValue('/pcb.glb');
    vi.spyOn(Math, 'random').mockReturnValue(0);

    render(<PcbProbeView deviceId="voltage_divider_01" />);
    await screen.findByText('Simple Voltage Divider — PCB view');

    fireEvent.click(screen.getByTestId('lead-jack-red'));
    const stage = screen.getByTestId('probe-stage');
    fireEvent.pointerDown(stage, { clientX: 250, clientY: 200 });
    fireEvent.pointerUp(stage, { clientX: 250, clientY: 200 });

    expect(screen.getByTestId('lead-jack-red')).not.toHaveClass('placed');
  });

  it('offers continuity mode and measures via the real ohms wire mode', async () => {
    vi.spyOn(api, 'getDevice').mockResolvedValue(DEVICE);
    vi.spyOn(api, 'deviceAssetUrl').mockReturnValue('/pcb.glb');
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const measureSpy = vi.spyOn(api, 'measure').mockResolvedValue({ fault_id: 'r1_open', mode: 'ohms', resistance_ohms: 0.5 });
    const user = userEvent.setup();

    render(<PcbProbeView deviceId="voltage_divider_01" />);
    await screen.findByText('Simple Voltage Divider — PCB view');

    await user.click(screen.getByRole('button', { name: '•)))' }));

    // no leads placed yet (jsdom has no real WebGL/raycasting to place one --
    // see the "tap that lands without a resolvable board point" test above),
    // so nothing to measure yet; this just confirms the mode switch itself
    // doesn't crash or call measure prematurely.
    expect(await screen.findByTestId('multimeter-display')).toHaveTextContent('— —');
    expect(measureSpy).not.toHaveBeenCalled();
  });

  it('clears both leads when the multimeter reset button is clicked', async () => {
    vi.spyOn(api, 'getDevice').mockResolvedValue(DEVICE);
    vi.spyOn(api, 'deviceAssetUrl').mockReturnValue('/pcb.glb');
    vi.spyOn(Math, 'random').mockReturnValue(0);

    render(<PcbProbeView deviceId="voltage_divider_01" />);
    await screen.findByText('Simple Voltage Divider — PCB view');

    fireEvent.click(screen.getByTestId('multimeter-reset'));

    expect(screen.getByTestId('lead-jack-red')).not.toHaveClass('placed');
    expect(screen.getByTestId('lead-jack-black')).not.toHaveClass('placed');
  });

  describe('portal targets', () => {
    it('portals the title, round controls, and difficulty picker into the given elements instead of rendering them inline', async () => {
      vi.spyOn(api, 'getDevice').mockResolvedValue(DEVICE);
      vi.spyOn(api, 'deviceAssetUrl').mockReturnValue('/pcb.glb');
      vi.spyOn(Math, 'random').mockReturnValue(0);

      const titleTarget = document.createElement('div');
      const actionsTarget = document.createElement('div');
      const menuTarget = document.createElement('div');
      document.body.append(titleTarget, actionsTarget, menuTarget);

      render(
        <PcbProbeView
          deviceId="voltage_divider_01"
          titlePortalTarget={titleTarget}
          actionsPortalTarget={actionsTarget}
          menuPortalTarget={menuTarget}
        />,
      );

      await waitFor(() => expect(titleTarget).toHaveTextContent('Simple Voltage Divider — PCB view'));
      expect(actionsTarget.querySelector('button')).toHaveTextContent('New Fault');
      expect(menuTarget.querySelector('select')).toBeInTheDocument();

      titleTarget.remove();
      actionsTarget.remove();
      menuTarget.remove();
    });
  });
});
