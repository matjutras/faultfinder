import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import App from './App';
import * as api from './api';
import { API_BASE } from './api';
import { placeLead } from './test/placeLead';

const DEVICE = {
  id: 'voltage_divider_01',
  name: 'Simple Voltage Divider',
  schematic_sch: 'voltage_divider_01.kicad_sch',
  page_width_mm: 100,
  page_height_mm: 110,
  pcb_glb: 'pcb.glb',
  board_size_mm: { width: 36, height: 24 },
  board_thickness_mm: 1.51,
  pins: [
    { ref: 'TP1', pin: '1', node: 'VIN', x_mm: 101.6, y_mm: 81.28 },
    { ref: 'TP2', pin: '1', node: 'VOUT', x_mm: 101.6, y_mm: 111.76 },
  ],
  wires: [],
  pcb_pads: [],
  pcb_tracks: [],
  faults: [
    { id: 'healthy', name: 'No fault', difficulty: 'n/a', patch: [] },
    { id: 'r1_open', name: 'R1 open circuit', difficulty: 'easy', patch: [] },
  ],
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

  it('shows the configured API base in the error banner when the API is unreachable', async () => {
    // Regression test for the 2026-09-06 production incident: a frontend
    // rebuild without VITE_API_BASE set silently fell back to the localhost
    // dev default, so every real visitor's browser called their own machine
    // and failed. Printing API_BASE right in the visible error is the
    // safeguard -- it turns that into an obviously-wrong deploy config at a
    // glance, with no devtools/console required.
    vi.spyOn(api, 'listDevices').mockRejectedValue(new TypeError('Failed to fetch'));

    render(<App />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(API_BASE);
    expect(alert).toHaveTextContent('Failed to fetch');
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
      mode: 'voltage',
      probes: [
        { node: 'VIN', volts: 9 },
        { node: 'VOUT', volts: 6 },
      ],
      differential_volts: 3,
    });
    const user = userEvent.setup();

    render(<App />);
    await screen.findByRole('heading', { name: 'Simple Voltage Divider' });

    // TP1 (101.6, 81.28mm) and TP2 (101.6, 111.76mm) against the 800x880px
    // stage (8px/mm, jsdom's zero-offset default rect).
    placeLead('red', 101.6 * 8, 81.28 * 8);
    placeLead('black', 101.6 * 8, 111.76 * 8);
    expect(await screen.findByTestId('multimeter-display')).toHaveTextContent('3.000 V');

    await user.selectOptions(screen.getByLabelText('Device:'), OTHER_DEVICE.id);
    await screen.findByRole('heading', { name: 'Resistor Bridge' });

    expect(screen.queryByTestId('multimeter-display')).toHaveTextContent('— —');
    expect(screen.queryByTestId('lead-red')).not.toBeInTheDocument();
    expect(screen.queryByTestId('lead-black')).not.toBeInTheDocument();
  });

  it('keeps the session score across a device switch, unlike the per-device probe state', async () => {
    // The score is deliberately owned by App, not by SchematicProbeView/
    // PcbProbeView -- those get remounted on device switch (key={deviceId})
    // so per-device state resets, but a session score spanning every device
    // must survive that same remount.
    vi.spyOn(api, 'listDevices').mockResolvedValue(DEVICE_LIST);
    vi.spyOn(api, 'getDevice').mockImplementation((id) =>
      Promise.resolve(id === OTHER_DEVICE.id ? OTHER_DEVICE : DEVICE),
    );
    const user = userEvent.setup();

    render(<App />);
    await screen.findByRole('heading', { name: 'Simple Voltage Divider' });
    expect(screen.getByText(/Solved: 0\/0/)).toBeInTheDocument();

    // only one non-"healthy" fault exists in the fixture pool, so it's
    // deterministically the one drawn regardless of Math.random
    await user.selectOptions(screen.getByRole('combobox', { name: /which fault/i }), 'r1_open');
    await user.click(screen.getByRole('button', { name: 'Submit guess' }));
    expect(await screen.findByText(/Solved: 1\/1/)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Device:'), OTHER_DEVICE.id);
    await screen.findByRole('heading', { name: 'Resistor Bridge' });

    expect(screen.getByText(/Solved: 1\/1/)).toBeInTheDocument();
  });
});
