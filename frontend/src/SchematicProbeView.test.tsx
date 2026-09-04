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
  testpoints: [
    { tp_id: 'TP1', label: 'Input (VIN)', node: 'VIN', x_mm: 101.6, y_mm: 81.28 },
    { tp_id: 'TP2', label: 'Divider Output (VOUT)', node: 'VOUT', x_mm: 101.6, y_mm: 111.76 },
  ],
  faults: [
    { id: 'healthy', name: 'No fault', difficulty: 'n/a', patch: [] },
    { id: 'r1_open', name: 'R1 open circuit', difficulty: 'easy', patch: [{ ref: 'R1', to: '1e12' }] },
    { id: 'r2_open', name: 'R2 open circuit', difficulty: 'easy', patch: [{ ref: 'R2', to: '1e12' }] },
    { id: 'r1_drift_high', name: 'R1 value drifted high', difficulty: 'medium', patch: [{ ref: 'R1', to: '10k' }] },
  ],
};

const RESULTS: Record<string, MeasureResult> = {
  healthy: { fault_id: 'healthy', probes: { TP1: 9, TP2: 6 }, differential_volts: 3 },
  r1_open: { fault_id: 'r1_open', probes: { TP1: 9, TP2: 0 }, differential_volts: 9 },
  r2_open: { fault_id: 'r2_open', probes: { TP1: 9, TP2: 9 }, differential_volts: 0 },
  r1_drift_high: { fault_id: 'r1_drift_high', probes: { TP1: 9, TP2: 1.5 }, differential_volts: 7.5 },
};

async function placeBothProbes(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTitle('Input (VIN)'));
  await user.click(screen.getByTitle('Divider Output (VOUT)'));
}

describe('SchematicProbeView', () => {
  beforeEach(() => {
    vi.spyOn(api, 'getDevice').mockResolvedValue(DEVICE);
    vi.spyOn(api, 'deviceAssetUrl').mockReturnValue('/voltage_divider_01.kicad_sch');
    vi.spyOn(api, 'measure').mockImplementation((_deviceId, _tpIds, faultId) => Promise.resolve(RESULTS[faultId]));
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

    await waitFor(() => expect(measureSpy).toHaveBeenCalledWith('voltage_divider_01', ['TP1', 'TP2'], 'r1_open'));
    expect(await screen.findByText('9.000 V')).toBeInTheDocument();
  });

  it('never shows the real fault name before Reveal is clicked', async () => {
    const user = userEvent.setup();
    render(<SchematicProbeView deviceId="voltage_divider_01" />);

    await screen.findByText('Simple Voltage Divider');
    await placeBothProbes(user);
    await screen.findByText('9.000 V');

    expect(screen.queryByText(/R1 open circuit/)).not.toBeInTheDocument();
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
    await user.click(screen.getByTitle('Input (VIN)'));

    expect(measureSpy).not.toHaveBeenCalled();
  });

  it('does not crash when a probe is deselected after a result is shown', async () => {
    const user = userEvent.setup();

    render(<SchematicProbeView deviceId="voltage_divider_01" />);

    await screen.findByText('Simple Voltage Divider');
    await placeBothProbes(user);
    await screen.findByText('9.000 V');

    await user.click(screen.getByTitle('Divider Output (VOUT)'));

    expect(screen.queryByText('9.000 V')).not.toBeInTheDocument();
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

    await waitFor(() => expect(measureSpy).toHaveBeenCalledWith('voltage_divider_01', ['TP1', 'TP2'], 'r2_open'));
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

    await user.selectOptions(screen.getByRole('combobox'), 'medium');

    await waitFor(() => expect(measureSpy).toHaveBeenCalledWith('voltage_divider_01', ['TP1', 'TP2'], 'r1_drift_high'));
    expect(await screen.findByText('7.500 V')).toBeInTheDocument();
    expect(screen.queryByText(/Fault: R1 open circuit/)).not.toBeInTheDocument();
  });
});
