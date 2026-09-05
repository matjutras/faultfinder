import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FaultGuess } from './FaultGuess';
import type { Fault } from './types';

const FAULTS: Fault[] = [
  { id: 'healthy', name: 'No fault', difficulty: 'n/a', patch: [] },
  { id: 'r1_open', name: 'R1 open circuit', difficulty: 'easy', patch: [] },
  { id: 'r2_open', name: 'R2 open circuit', difficulty: 'easy', patch: [] },
];

describe('FaultGuess', () => {
  it('does not offer "healthy" as a guessable option', async () => {
    render(<FaultGuess faults={FAULTS} actualFaultId="r1_open" onGuess={vi.fn()} />);
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).not.toContain('No fault');
    expect(options).toEqual(expect.arrayContaining(['R1 open circuit', 'R2 open circuit']));
  });

  it('disables submit until a fault is selected', () => {
    render(<FaultGuess faults={FAULTS} actualFaultId="r1_open" onGuess={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Submit guess' })).toBeDisabled();
  });

  it('calls onGuess(true, true) and shows the solved message on a correct first try', async () => {
    const onGuess = vi.fn();
    const user = userEvent.setup();
    render(<FaultGuess faults={FAULTS} actualFaultId="r1_open" onGuess={onGuess} />);

    await user.selectOptions(screen.getByRole('combobox'), 'r1_open');
    await user.click(screen.getByRole('button', { name: 'Submit guess' }));

    expect(onGuess).toHaveBeenCalledWith(true, true);
    expect(await screen.findByText('Correct! Solved in 1 try.')).toBeInTheDocument();
  });

  it('calls onGuess(false, true) and offers a retry on a wrong first guess, without revealing the answer', async () => {
    const onGuess = vi.fn();
    const user = userEvent.setup();
    render(<FaultGuess faults={FAULTS} actualFaultId="r1_open" onGuess={onGuess} />);

    await user.selectOptions(screen.getByRole('combobox'), 'r2_open');
    await user.click(screen.getByRole('button', { name: 'Submit guess' }));

    expect(onGuess).toHaveBeenCalledWith(false, true);
    expect(await screen.findByText('Not quite — try again.')).toBeInTheDocument();
    expect(screen.queryByText(/Correct/)).not.toBeInTheDocument();
    // still open for another guess
    expect(screen.getByRole('button', { name: 'Submit guess' })).toBeInTheDocument();
  });

  it('marks a second-try correct guess as not-first-try, and stops accepting further guesses once solved', async () => {
    const onGuess = vi.fn();
    const user = userEvent.setup();
    render(<FaultGuess faults={FAULTS} actualFaultId="r1_open" onGuess={onGuess} />);

    await user.selectOptions(screen.getByRole('combobox'), 'r2_open');
    await user.click(screen.getByRole('button', { name: 'Submit guess' }));
    await user.selectOptions(screen.getByRole('combobox'), 'r1_open');
    await user.click(screen.getByRole('button', { name: 'Submit guess' }));

    expect(onGuess).toHaveBeenNthCalledWith(2, true, false);
    expect(await screen.findByText('Correct! Solved in 2 tries.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit guess' })).not.toBeInTheDocument();
  });
});
