import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DraggingLead, Multimeter } from './Multimeter';

describe('Multimeter', () => {
  it('shows the current display value and mode', () => {
    render(
      <Multimeter
        mode="voltage"
        onModeChange={vi.fn()}
        display="3.000 V"
        redPlaced={false}
        blackPlaced={false}
        onLeadPointerDown={vi.fn()}
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
        onLeadPointerDown={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ω' }));
    expect(onModeChange).toHaveBeenCalledWith('ohms');
  });

  it('calls onLeadPointerDown with the lead color that was grabbed', () => {
    const onLeadPointerDown = vi.fn();
    render(
      <Multimeter
        mode="voltage"
        onModeChange={vi.fn()}
        display=""
        redPlaced={false}
        blackPlaced={false}
        onLeadPointerDown={onLeadPointerDown}
      />,
    );
    fireEvent.pointerDown(screen.getByTestId('lead-drag-red'));
    fireEvent.pointerDown(screen.getByTestId('lead-drag-black'));

    expect(onLeadPointerDown).toHaveBeenNthCalledWith(1, 'red', expect.anything());
    expect(onLeadPointerDown).toHaveBeenNthCalledWith(2, 'black', expect.anything());
  });

  it('marks a lead jack as placed once its lead has landed on a target', () => {
    render(
      <Multimeter
        mode="voltage"
        onModeChange={vi.fn()}
        display=""
        redPlaced={true}
        blackPlaced={false}
        onLeadPointerDown={vi.fn()}
      />,
    );
    expect(screen.getByTestId('lead-drag-red')).toHaveClass('placed');
    expect(screen.getByTestId('lead-drag-black')).not.toHaveClass('placed');
  });
});

describe('DraggingLead', () => {
  it('renders at the given pointer position', () => {
    render(<DraggingLead color="red" clientX={12} clientY={34} />);
    const el = screen.getByTestId('dragging-lead-red');
    expect(el).toHaveStyle({ left: '12px', top: '34px' });
  });
});
