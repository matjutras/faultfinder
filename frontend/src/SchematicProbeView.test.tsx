import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from './api';
import { SchematicProbeView } from './SchematicProbeView';
import { dragLeadTo } from './test/dragLead';
import type { Device, MeasureResult } from './types';

const DEVICE: Device = {
  id: 'voltage_divider_01',
  name: 'Simple Voltage Divider',
  schematic_sch: 'voltage_divider_01.kicad_sch',
  pins: [
    { ref: 'TP1', pin: '1', node: 'VIN', x_mm: 50, y_mm: 20 },
    { ref: 'TP2', pin: '1', node: 'VOUT', x_mm: 50, y_mm: 40 },
    { ref: 'TP3', pin: '1', node: '0', x_mm: 50, y_mm: 60 },
  ],
  wires: [],
  pcb_pads: [],
  pcb_tracks: [],
  faults: [
    { id: 'healthy', name: 'No fault', difficulty: 'n/a', patch: [] },
    { id: 'r1_open', name: 'R1 open circuit', difficulty: 'easy', patch: [{ ref: 'R1', to: '1e12' }] },
    { id: 'r2_open', name: 'R2 open circuit', difficulty: 'easy', patch: [{ ref: 'R2', to: '1e12' }] },
    { id: 'r1_drift_high', name: 'R1 value drifted high', difficulty: 'medium', patch: [{ ref: 'R1', to: '10k' }] },
  ],
};

// The stage renders at 800x880px against the device's 100x110mm page -> 8
// px/mm, offset 0 (jsdom's default getBoundingClientRect is an all-zero
// rect, which conveniently makes clientX/Y == local stage px directly).
const TP1_PX = { x: 50 * 8, y: 20 * 8 };
const TP2_PX = { x: 50 * 8, y: 40 * 8 };
const TP3_PX = { x: 50 * 8, y: 60 * 8 };

const RESULTS: Record<string, MeasureResult> = {
  healthy: {
    fault_id: 'healthy',
    mode: 'voltage',
    probes: [
      { node: 'VIN', volts: 9 },
      { node: 'VOUT', volts: 6 },
    ],
    differential_volts: 3,
  },
  r1_open: {
    fault_id: 'r1_open',
    mode: 'voltage',
    probes: [
      { node: 'VIN', volts: 9 },
      { node: 'VOUT', volts: 0 },
    ],
    differential_volts: 9,
  },
  r2_open: {
    fault_id: 'r2_open',
    mode: 'voltage',
    probes: [
      { node: 'VIN', volts: 9 },
      { node: 'VOUT', volts: 9 },
    ],
    differential_volts: 0,
  },
  r1_drift_high: {
    fault_id: 'r1_drift_high',
    mode: 'voltage',
    probes: [
      { node: 'VIN', volts: 9 },
      { node: 'VOUT', volts: 1.5 },
    ],
    differential_volts: 7.5,
  },
};

function placeBothProbes() {
  dragLeadTo('red', TP1_PX.x, TP1_PX.y); // VIN -> red lead
  dragLeadTo('black', TP2_PX.x, TP2_PX.y); // VOUT -> black lead
}

// The same "X.XXX V" text appears in both the multimeter's own display and
// the detailed readout below it -- a plain findByText would match both and
// throw "multiple elements", so assertions go through the display testid,
// which is unambiguous.
async function waitForDisplay(text: string) {
  await waitFor(() => expect(screen.getByTestId('multimeter-display')).toHaveTextContent(text));
}

describe('SchematicProbeView', () => {
  beforeEach(() => {
    vi.spyOn(api, 'getDevice').mockResolvedValue(DEVICE);
    vi.spyOn(api, 'deviceAssetUrl').mockReturnValue('/voltage_divider_01.kicad_sch');
    vi.spyOn(api, 'measure').mockImplementation((_deviceId, _nodes, faultId) => Promise.resolve(RESULTS[faultId]));
    // Deterministic: pickRandomFault always takes index 0 of whichever pool is
    // active, so the "easy" tier (the default on mount) resolves to r1_open.
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  it('shows a readout once two leads are dropped on pins, using a silently-injected fault', async () => {
    const measureSpy = vi.spyOn(api, 'measure');

    render(<SchematicProbeView deviceId="voltage_divider_01" />);

    await screen.findByText('Simple Voltage Divider');
    placeBothProbes();

    await waitFor(() => expect(measureSpy).toHaveBeenCalledWith('voltage_divider_01', ['VIN', 'VOUT'], 'r1_open', 'voltage'));
    await waitForDisplay('9.000 V');
  });

  it('never shows the real fault name before Reveal is clicked', async () => {
    render(<SchematicProbeView deviceId="voltage_divider_01" />);

    await screen.findByText('Simple Voltage Divider');
    placeBothProbes();
    await waitForDisplay('9.000 V');

    // Exact match, not a substring regex: "R1 open circuit" alone also
    // appears as one of the (deliberately non-identifying) guess dropdown's
    // options, which isn't a leak -- the reveal display's own text is
    // "Fault: R1 open circuit", so that's what must be absent.
    expect(screen.queryByText('Fault: R1 open circuit')).not.toBeInTheDocument();
  });

  it('reveals and hides the fault name on demand', async () => {
    const user = userEvent.setup();
    render(<SchematicProbeView deviceId="voltage_divider_01" />);

    await screen.findByText('Simple Voltage Divider');
    await user.click(screen.getByRole('button', { name: 'Reveal fault' }));
    expect(await screen.findByText('Fault: R1 open circuit')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Hide fault' }));
    expect(screen.queryByText(/Fault: R1 open circuit/)).not.toBeInTheDocument();
  });

  it('does not call measure until two leads are placed', async () => {
    const measureSpy = vi.spyOn(api, 'measure');

    render(<SchematicProbeView deviceId="voltage_divider_01" />);

    await screen.findByText('Simple Voltage Divider');
    dragLeadTo('red', TP1_PX.x, TP1_PX.y);

    expect(measureSpy).not.toHaveBeenCalled();
  });

  it('a drop that lands nowhere near a pin or wire is ignored', async () => {
    const measureSpy = vi.spyOn(api, 'measure');

    render(<SchematicProbeView deviceId="voltage_divider_01" />);

    await screen.findByText('Simple Voltage Divider');
    dragLeadTo('red', 5, 5); // far from every pin/wire in this fixture

    expect(screen.getByTestId('lead-drag-red')).not.toHaveClass('placed');
    expect(measureSpy).not.toHaveBeenCalled();
  });

  it('does not crash when a lead is re-dragged after a result is shown, and re-measures the new pair', async () => {
    vi.spyOn(api, 'measure').mockImplementation((_deviceId, nodes, faultId) => {
      const volts: Record<string, number> = { VIN: 9, VOUT: 0, '0': 0 };
      const probes = nodes.map((node) => ({ node, volts: volts[node] }));
      return Promise.resolve({
        fault_id: faultId,
        mode: 'voltage',
        probes,
        differential_volts: probes[0].volts - probes[1].volts,
      });
    });

    render(<SchematicProbeView deviceId="voltage_divider_01" />);

    await screen.findByText('Simple Voltage Divider');
    placeBothProbes(); // VIN (red), VOUT (black)
    await waitForDisplay('9.000 V');

    dragLeadTo('black', TP3_PX.x, TP3_PX.y); // re-drag black onto the third probe: 0 (GND)

    // must not throw and unmount the component tree
    expect(await screen.findByText('Simple Voltage Divider')).toBeInTheDocument();
    // and it must settle on the new pair's real reading (VIN, 0), not stay
    // stuck showing the old VIN/VOUT value or a blank readout
    await waitForDisplay('9.000 V');
  });

  it('resets the guess form on "New Fault" even when the same fault is drawn again', async () => {
    // Regression test: FaultGuess was keyed on `faultId`, so when the random
    // draw happens to redraw the SAME fault (easy has only 2 candidates here,
    // a 50/50 chance), the key didn't change, React didn't remount it, and it
    // kept showing the previous round's "Correct!" message forever instead of
    // a fresh guess form -- fixed by keying on a monotonic round counter
    // instead of the fault id itself.
    const user = userEvent.setup();
    render(<SchematicProbeView deviceId="voltage_divider_01" />); // Math.random mocked to 0 -> always r1_open

    await screen.findByText('Simple Voltage Divider');
    await user.selectOptions(screen.getByRole('combobox', { name: /which fault/i }), 'r1_open');
    await user.click(screen.getByRole('button', { name: 'Submit guess' }));
    expect(await screen.findByText(/Correct!/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'New Fault' })); // redraws r1_open again

    expect(screen.queryByText(/Correct!/)).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Submit guess' })).toBeInTheDocument();
  });

  it('"New Fault" can pick a different fault within the same tier and re-measures without re-dragging leads', async () => {
    const measureSpy = vi.spyOn(api, 'measure');
    const user = userEvent.setup();

    render(<SchematicProbeView deviceId="voltage_divider_01" />);

    await screen.findByText('Simple Voltage Divider');
    placeBothProbes();
    await waitForDisplay('9.000 V');

    vi.spyOn(Math, 'random').mockReturnValue(0.9); // picks index 1 of the 2-item "easy" pool: r2_open
    await user.click(screen.getByRole('button', { name: 'New Fault' }));

    await waitFor(() => expect(measureSpy).toHaveBeenCalledWith('voltage_divider_01', ['VIN', 'VOUT'], 'r2_open', 'voltage'));
    await waitForDisplay('0.000 V');
  });

  it('changing difficulty draws from the new tier and hides any previously revealed name', async () => {
    const measureSpy = vi.spyOn(api, 'measure');
    const user = userEvent.setup();

    render(<SchematicProbeView deviceId="voltage_divider_01" />);

    await screen.findByText('Simple Voltage Divider');
    placeBothProbes();
    await waitForDisplay('9.000 V');
    await user.click(screen.getByRole('button', { name: 'Reveal fault' }));
    await screen.findByText('Fault: R1 open circuit');

    await user.selectOptions(screen.getByLabelText('Difficulty:'), 'medium');

    await waitFor(() => expect(measureSpy).toHaveBeenCalledWith('voltage_divider_01', ['VIN', 'VOUT'], 'r1_drift_high', 'voltage'));
    await waitForDisplay('7.500 V');
    expect(screen.queryByText(/Fault: R1 open circuit/)).not.toBeInTheDocument();
  });

  it('switching to ohms mode re-measures in that mode and shows the multimeter reading', async () => {
    const measureSpy = vi.spyOn(api, 'measure').mockImplementation((_deviceId, _nodes, faultId, mode) => {
      if (mode === 'ohms') return Promise.resolve({ fault_id: faultId, mode: 'ohms', resistance_ohms: 666.667 });
      return Promise.resolve(RESULTS[faultId]);
    });
    const user = userEvent.setup();

    render(<SchematicProbeView deviceId="voltage_divider_01" />);
    await screen.findByText('Simple Voltage Divider');
    placeBothProbes();
    await waitForDisplay('9.000 V');

    await user.click(screen.getByRole('button', { name: 'Ω' }));

    await waitFor(() => expect(measureSpy).toHaveBeenCalledWith('voltage_divider_01', ['VIN', 'VOUT'], 'r1_open', 'ohms'));
    expect(await screen.findByTestId('multimeter-display')).toHaveTextContent('666.7 Ω');
  });
});
