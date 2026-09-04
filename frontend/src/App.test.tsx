import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App from './App';
import * as api from './api';

describe('App', () => {
  it('renders the device name once loaded', async () => {
    vi.spyOn(api, 'getDevice').mockResolvedValue({
      id: 'voltage_divider_01',
      name: 'Simple Voltage Divider',
      schematic_sch: 'voltage_divider_01.kicad_sch',
      testpoints: [],
      faults: [],
    });

    render(<App />);

    expect(await screen.findByText('Simple Voltage Divider')).toBeInTheDocument();
  });
});
