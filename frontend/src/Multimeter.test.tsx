import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Multimeter } from './Multimeter';

describe('Multimeter', () => {
  it('shows the current display value and mode', () => {
    render(
      <Multimeter
        mode="voltage"
        onModeChange={vi.fn()}
        display="3.000 V"
        redPlaced={false}
        blackPlaced={false}
        armedLead={null}
        onLeadClick={vi.fn()}
      />,
    );
    expect(screen.getByTestId('multimeter-display')).toHaveTextContent('3.000 V');
    expect(screen.getByRole('button', { name: 'V' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Ω' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onModeChange with the clicked mode', () => {
    const onModeChange = vi.fn();
    render(
      <Multimeter
        mode="voltage"
        onModeChange={onModeChange}
        display=""
        redPlaced={false}
        blackPlaced={false}
        armedLead={null}
        onLeadClick={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ω' }));
    expect(onModeChange).toHaveBeenCalledWith('ohms');
  });

  it('calls onLeadClick with the lead color that was clicked', () => {
    const onLeadClick = vi.fn();
    render(
      <Multimeter
        mode="voltage"
        onModeChange={vi.fn()}
        display=""
        redPlaced={false}
        blackPlaced={false}
        armedLead={null}
        onLeadClick={onLeadClick}
      />,
    );
    fireEvent.click(screen.getByTestId('lead-jack-red'));
    fireEvent.click(screen.getByTestId('lead-jack-black'));

    expect(onLeadClick).toHaveBeenNthCalledWith(1, 'red');
    expect(onLeadClick).toHaveBeenNthCalledWith(2, 'black');
  });

  it('marks a lead jack as placed once its lead has landed on a target', () => {
    render(
      <Multimeter
        mode="voltage"
        onModeChange={vi.fn()}
        display=""
        redPlaced={true}
        blackPlaced={false}
        armedLead={null}
        onLeadClick={vi.fn()}
      />,
    );
    expect(screen.getByTestId('lead-jack-red')).toHaveClass('placed');
    expect(screen.getByTestId('lead-jack-black')).not.toHaveClass('placed');
  });

  it('marks the armed lead jack, and only that one', () => {
    render(
      <Multimeter
        mode="voltage"
        onModeChange={vi.fn()}
        display=""
        redPlaced={false}
        blackPlaced={false}
        armedLead="black"
        onLeadClick={vi.fn()}
      />,
    );
    expect(screen.getByTestId('lead-jack-black')).toHaveClass('armed');
    expect(screen.getByTestId('lead-jack-black')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('lead-jack-red')).not.toHaveClass('armed');
    expect(screen.getByTestId('lead-jack-red')).toHaveAttribute('aria-pressed', 'false');
  });
});
