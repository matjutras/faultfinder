import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import App from './App';
import * as api from './api';

const DEVICE = {
  id: 'voltage_divider_01',
  name: 'Simple Voltage Divider',
  schematic_sch: 'voltage_divider_01.kicad_sch',
  pcb_glb: 'pcb.glb',
  board_size_mm: { width: 36, height: 24 },
  board_thickness_mm: 1.51,
  testpoints: [
    { tp_id: 'TP1', label: 'Input (VIN)', node: 'VIN', x_mm: 101.6, y_mm: 81.28 },
    { tp_id: 'TP2', label: 'Output (VOUT)', node: 'VOUT', x_mm: 101.6, y_mm: 111.76 },
  ],
  faults: [{ id: 'healthy', name: 'No fault', difficulty: 'n/a', patch: [] }],
};

const OTHER_DEVICE = {
  ...DEVICE,
  id: 'resistor_bridge_05',
  name: 'Resistor Bridge',
};

const DEVICE_LIST = [
  { id: DEVICE.id, name: DEVICE.name },
  { id: OTHER_DEVICE.id, name: OTHER_DEVICE.name },
];

describe('App', () => {
  it('renders the device name once loaded, in the schematic view by default', async () => {
    vi.spyOn(api, 'listDevices').mockResolvedValue(DEVICE_LIST);
    vi.spyOn(api, 'getDevice').mockResolvedValue(DEVICE);

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Simple Voltage Divider' })).toBeInTheDocument();
  });

  it('switches to the PCB view and back, sharing the same device', async () => {
    vi.spyOn(api, 'listDevices').mockResolvedValue(DEVICE_LIST);
    vi.spyOn(api, 'getDevice').mockResolvedValue(DEVICE);
    const user = userEvent.setup();

    render(<App />);
    await screen.findByRole('heading', { name: 'Simple Voltage Divider' });

    await user.click(screen.getByRole('button', { name: 'PCB view' }));
    expect(await screen.findByText('Simple Voltage Divider — PCB view')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Schematic view' }));
    expect(await screen.findByRole('heading', { name: 'Simple Voltage Divider' })).toBeInTheDocument();
  });

  it('lists every device from the API and switches to the one the user picks', async () => {
    vi.spyOn(api, 'listDevices').mockResolvedValue(DEVICE_LIST);
    const getDeviceSpy = vi
      .spyOn(api, 'getDevice')
      .mockImplementation((id) => Promise.resolve(id === OTHER_DEVICE.id ? OTHER_DEVICE : DEVICE));
    const user = userEvent.setup();

    render(<App />);
    await screen.findByRole('heading', { name: 'Simple Voltage Divider' });

    const select = screen.getByLabelText('Device:');
    expect(select).toHaveDisplayValue('Simple Voltage Divider');

    await user.selectOptions(select, OTHER_DEVICE.id);

    expect(await screen.findByRole('heading', { name: 'Resistor Bridge' })).toBeInTheDocument();
    expect(getDeviceSpy).toHaveBeenCalledWith(OTHER_DEVICE.id);
  });

  it('clears placed probes and any reading when the user switches devices', async () => {
    // Regression test: switching the device dropdown used to leave the
    // previous device's `selected` probes (and its stale reading) in place,
    // because SchematicProbeView's own state isn't reset just by its
    // deviceId prop changing -- only remounting it (via `key={deviceId}`)
    // does. Without that, clicking a testpoint after switching devices could
    // even silently *deselect* a same-named leftover probe instead of
    // selecting the new device's one.
    vi.spyOn(api, 'listDevices').mockResolvedValue(DEVICE_LIST);
    vi.spyOn(api, 'getDevice').mockImplementation((id) =>
      Promise.resolve(id === OTHER_DEVICE.id ? OTHER_DEVICE : DEVICE),
    );
    vi.spyOn(api, 'measure').mockResolvedValue({
      fault_id: 'healthy',
      probes: { TP1: 9, TP2: 6 },
      differential_volts: 3,
    });
    const user = userEvent.setup();

    render(<App />);
    await screen.findByRole('heading', { name: 'Simple Voltage Divider' });

    await user.click(screen.getByTitle('Input (VIN)'));
    await user.click(screen.getByTitle('Output (VOUT)'));
    expect(await screen.findByText('3.000 V')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Device:'), OTHER_DEVICE.id);
    await screen.findByRole('heading', { name: 'Resistor Bridge' });

    expect(screen.queryByText('3.000 V')).not.toBeInTheDocument();
    expect(screen.getByTitle('Input (VIN)')).not.toHaveClass('selected');
    expect(screen.getByTitle('Output (VOUT)')).not.toHaveClass('selected');
  });
});
