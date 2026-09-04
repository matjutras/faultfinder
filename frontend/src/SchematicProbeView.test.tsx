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
  ],
};

const RESULT: MeasureResult = {
  fault_id: 'healthy',
  probes: { TP1: 9, TP2: 6 },
  differential_volts: 3,
};

const FAULT_RESULT: MeasureResult = {
  fault_id: 'r1_open',
  probes: { TP1: 9, TP2: 0 },
  differential_volts: 9,
};

describe('SchematicProbeView', () => {
  beforeEach(() => {
    vi.spyOn(api, 'getDevice').mockResolvedValue(DEVICE);
    vi.spyOn(api, 'deviceAssetUrl').mockReturnValue('/voltage_divider_01.kicad_sch');
  });

  it('shows a readout once two probes are placed', async () => {
    const measureSpy = vi.spyOn(api, 'measure').mockResolvedValue(RESULT);
    const user = userEvent.setup();

    render(<SchematicProbeView deviceId="voltage_divider_01" />);

    await screen.findByText('Simple Voltage Divider');
    await user.click(screen.getByTitle('Input (VIN)'));
    await user.click(screen.getByTitle('Divider Output (VOUT)'));

    await waitFor(() => expect(measureSpy).toHaveBeenCalledWith('voltage_divider_01', ['TP1', 'TP2'], 'healthy'));
    expect(await screen.findByText('3.000 V')).toBeInTheDocument();
  });

  it('does not call measure until two probes are placed', async () => {
    const measureSpy = vi.spyOn(api, 'measure').mockResolvedValue(RESULT);
    const user = userEvent.setup();

    render(<SchematicProbeView deviceId="voltage_divider_01" />);

    await screen.findByText('Simple Voltage Divider');
    await user.click(screen.getByTitle('Input (VIN)'));

    expect(measureSpy).not.toHaveBeenCalled();
  });

  it('does not crash when a probe is deselected after a result is shown', async () => {
    vi.spyOn(api, 'measure').mockResolvedValue(RESULT);
    const user = userEvent.setup();

    render(<SchematicProbeView deviceId="voltage_divider_01" />);

    await screen.findByText('Simple Voltage Divider');
    await user.click(screen.getByTitle('Input (VIN)'));
    await user.click(screen.getByTitle('Divider Output (VOUT)'));
    await screen.findByText('3.000 V');

    await user.click(screen.getByTitle('Divider Output (VOUT)'));

    expect(screen.queryByText('3.000 V')).not.toBeInTheDocument();
  });

  it('shows a different reading once a fault is selected', async () => {
    const measureSpy = vi.spyOn(api, 'measure').mockImplementation((_deviceId, _tpIds, faultId) =>
      Promise.resolve(faultId === 'healthy' ? RESULT : FAULT_RESULT),
    );
    const user = userEvent.setup();

    render(<SchematicProbeView deviceId="voltage_divider_01" />);

    await screen.findByText('Simple Voltage Divider');
    await user.click(screen.getByTitle('Input (VIN)'));
    await user.click(screen.getByTitle('Divider Output (VOUT)'));
    await screen.findByText('3.000 V');

    await user.selectOptions(screen.getByRole('combobox'), 'r1_open');
    await user.click(screen.getByTitle('Input (VIN)'));
    await user.click(screen.getByTitle('Divider Output (VOUT)'));

    await waitFor(() => expect(measureSpy).toHaveBeenCalledWith('voltage_divider_01', ['TP1', 'TP2'], 'r1_open'));
    expect(await screen.findByText('9.000 V')).toBeInTheDocument();
    expect(screen.queryByText('3.000 V')).not.toBeInTheDocument();
  });
});
