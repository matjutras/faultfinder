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
  testpoints: [],
  faults: [],
};

describe('App', () => {
  it('renders the device name once loaded, in the schematic view by default', async () => {
    vi.spyOn(api, 'getDevice').mockResolvedValue(DEVICE);

    render(<App />);

    expect(await screen.findByText('Simple Voltage Divider')).toBeInTheDocument();
  });

  it('switches to the PCB view and back, sharing the same device', async () => {
    vi.spyOn(api, 'getDevice').mockResolvedValue(DEVICE);
    const user = userEvent.setup();

    render(<App />);
    await screen.findByText('Simple Voltage Divider');

    await user.click(screen.getByRole('button', { name: 'PCB view' }));
    expect(await screen.findByText('Simple Voltage Divider — PCB view')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Schematic view' }));
    expect(await screen.findByText('Simple Voltage Divider')).toBeInTheDocument();
  });
});
