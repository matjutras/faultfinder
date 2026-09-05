import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from './api';
import { SchematicProbeView } from './SchematicProbeView';
import type { Device, MeasureResult } from './types';

const DEVICE: Device = {
  id: 'voltage_divider_01',
  name: 'Simple Voltage Divider',
  schematic_sch: 'voltage_divider_01.kicad_sch',
  pins: [
    { ref: 'TP1', pin: '1', node: 'VIN', x_mm: 101.6, y_mm: 81.28 },
    { ref: 'TP2', pin: '1', node: 'VOUT', x_mm: 101.6, y_mm: 111.76 },
    { ref: 'TP3', pin: '1', node: '0', x_mm: 101.6, y_mm: 96.52 },
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

const RESULTS: Record<string, MeasureResult> = {
  healthy: {
    fault_id: 'healthy',
    probes: [
      { node: 'VIN', volts: 9 },
      { node: 'VOUT', volts: 6 },
    ],
    differential_volts: 3,
  },
  r1_open: {
    fault_id: 'r1_open',
    probes: [
      { node: 'VIN', volts: 9 },
      { node: 'VOUT', volts: 0 },
    ],
    differential_volts: 9,
  },
  r2_open: {
    fault_id: 'r2_open',
    probes: [
      { node: 'VIN', volts: 9 },
      { node: 'VOUT', volts: 9 },
    ],
    differential_volts: 0,
  },
  r1_drift_high: {
    fault_id: 'r1_drift_high',
    probes: [
      { node: 'VIN', volts: 9 },
      { node: 'VOUT', volts: 1.5 },
    ],
    differential_volts: 7.5,
  },
};

async function placeBothProbes(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('pin-TP1-1')); // VIN -> red lead
  await user.click(screen.getByTestId('pin-TP2-1')); // VOUT -> black lead
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

  it('shows a readout once two probes are placed, using a silently-injected fault', async () => {
    const measureSpy = vi.spyOn(api, 'measure');
    const user = userEvent.setup();

    render(<SchematicProbeView deviceId="voltage_divider_01" />);

    await screen.findByText('Simple Voltage Divider');
    await placeBothProbes(user);

    await waitFor(() => expect(measureSpy).toHaveBeenCalledWith('voltage_divider_01', ['VIN', 'VOUT'], 'r1_open'));
    expect(await screen.findByText('9.000 V')).toBeInTheDocument();
  });

  it('never shows the real fault name before Reveal is clicked', async () => {
    const user = userEvent.setup();
    render(<SchematicProbeView deviceId="voltage_divider_01" />);

    await screen.findByText('Simple Voltage Divider');
    await placeBothProbes(user);
    await screen.findByText('9.000 V');

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

  it('does not call measure until two probes are placed', async () => {
    const measureSpy = vi.spyOn(api, 'measure');
    const user = userEvent.setup();

    render(<SchematicProbeView deviceId="voltage_divider_01" />);

    await screen.findByText('Simple Voltage Divider');
    await user.click(screen.getByTestId('pin-TP1-1'));

    expect(measureSpy).not.toHaveBeenCalled();
  });

  it('does not crash when a probe is deselected after a result is shown', async () => {
    const user = userEvent.setup();

    render(<SchematicProbeView deviceId="voltage_divider_01" />);

    await screen.findByText('Simple Voltage Divider');
    await placeBothProbes(user);
    await screen.findByText('9.000 V');

    await user.click(screen.getByTestId('pin-TP2-1')); // re-click the black lead's own pin: removes it

    expect(screen.queryByText('9.000 V')).not.toBeInTheDocument();
  });

  it('does not crash when a third probe is placed after two are already selected, and shows the new pair once measured', async () => {
    const user = userEvent.setup();
    // Regression test for a crash: clicking a third test point slides the
    // lead window (drops the red lead, black becomes red, adds a new black),
    // but the stale `result` for the old pair was rendered for one tick
    // before the effect refetched it, and the stale result didn't carry the
    // new node -- .toFixed() on undefined threw and unmounted the whole tree
    // (no error boundary).
    vi.spyOn(api, 'measure').mockImplementation((_deviceId, nodes, faultId) => {
      const volts: Record<string, number> = { VIN: 9, VOUT: 0, '0': 0 };
      const probes = nodes.map((node) => ({ node, volts: volts[node] }));
      return Promise.resolve({
        fault_id: faultId,
        probes,
        differential_volts: probes[0].volts - probes[1].volts,
      });
    });

    render(<SchematicProbeView deviceId="voltage_divider_01" />);

    await screen.findByText('Simple Voltage Divider');
    await placeBothProbes(user); // VIN (red), VOUT (black)
    await screen.findByText('9.000 V');

    await user.click(screen.getByTestId('pin-TP3-1')); // third probe: 0 (GND)

    // must not throw and unmount the component tree
    expect(await screen.findByText('Simple Voltage Divider')).toBeInTheDocument();
    // and it must settle on the new pair's real reading (VOUT, 0), not stay
    // stuck showing the old VIN/VOUT value or a blank readout
    expect(await screen.findByText('0.000 V')).toBeInTheDocument();
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

  it('"New Fault" can pick a different fault within the same tier and re-measures without reclicking probes', async () => {
    const measureSpy = vi.spyOn(api, 'measure');
    const user = userEvent.setup();

    render(<SchematicProbeView deviceId="voltage_divider_01" />);

    await screen.findByText('Simple Voltage Divider');
    await placeBothProbes(user);
    await screen.findByText('9.000 V');

    vi.spyOn(Math, 'random').mockReturnValue(0.9); // picks index 1 of the 2-item "easy" pool: r2_open
    await user.click(screen.getByRole('button', { name: 'New Fault' }));

    await waitFor(() => expect(measureSpy).toHaveBeenCalledWith('voltage_divider_01', ['VIN', 'VOUT'], 'r2_open'));
    expect(await screen.findByText('0.000 V')).toBeInTheDocument();
  });

  it('changing difficulty draws from the new tier and hides any previously revealed name', async () => {
    const measureSpy = vi.spyOn(api, 'measure');
    const user = userEvent.setup();

    render(<SchematicProbeView deviceId="voltage_divider_01" />);

    await screen.findByText('Simple Voltage Divider');
    await placeBothProbes(user);
    await screen.findByText('9.000 V');
    await user.click(screen.getByRole('button', { name: 'Reveal fault' }));
    await screen.findByText('Fault: R1 open circuit');

    await user.selectOptions(screen.getByLabelText('Difficulty:'), 'medium');

    await waitFor(() => expect(measureSpy).toHaveBeenCalledWith('voltage_divider_01', ['VIN', 'VOUT'], 'r1_drift_high'));
    expect(await screen.findByText('7.500 V')).toBeInTheDocument();
    expect(screen.queryByText(/Fault: R1 open circuit/)).not.toBeInTheDocument();
  });
});
