import { useState } from 'react';
import type { Fault } from './types';

interface Props {
  faults: Fault[]; // full device fault pool, including "healthy" (filtered out below)
  actualFaultId: string;
  onGuess: (correct: boolean, firstTryThisRound: boolean) => void;
}

// Mount with `key={faultId}` from the caller so a new round (a new fault
// drawn) resets this component's own guess/solved state for free, the same
// remount-to-reset pattern used for `key={deviceId}` elsewhere.
export function FaultGuess({ faults, actualFaultId, onGuess }: Props) {
  const guessable = faults.filter((f) => f.id !== 'healthy');
  const [selected, setSelected] = useState('');
  const [tries, setTries] = useState(0);
  const [solved, setSolved] = useState(false);

  function submit() {
    if (!selected || solved) return;
    const correct = selected === actualFaultId;
    onGuess(correct, tries === 0);
    setTries((n) => n + 1);
    if (correct) setSolved(true);
  }

  if (solved) {
    return (
      <p className="guess-result correct">
        Correct! Solved in {tries} {tries === 1 ? 'try' : 'tries'}.
      </p>
    );
  }

  return (
    <div className="fault-guess">
      <label>
        Which fault is it?{' '}
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="" disabled>
            Choose a fault…
          </option>
          {guessable.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>{' '}
      <button type="button" onClick={submit} disabled={!selected}>
        Submit guess
      </button>
      {tries > 0 && <p className="guess-result incorrect">Not quite — try again.</p>}
    </div>
  );
}
