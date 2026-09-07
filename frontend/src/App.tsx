import { useEffect, useState } from 'react';
import { API_BASE, listDevices } from './api';
import { PcbProbeView } from './PcbProbeView';
import { INITIAL_SCORE, recordGuess } from './scoring';
import { SchematicProbeView } from './SchematicProbeView';
import type { DeviceSummary } from './types';

type ViewMode = 'schematic' | 'pcb';

function App() {
  const [view, setView] = useState<ViewMode>('schematic');
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Owned here, not inside SchematicProbeView/PcbProbeView: switching devices
  // remounts those (key={deviceId}, so probe selections don't leak between
  // devices), but the score is a session total across every device, so it
  // must live above that remount boundary.
  const [score, setScore] = useState(INITIAL_SCORE);
  const onGuess = (correct: boolean, firstTryThisRound: boolean) =>
    setScore((s) => recordGuess(s, correct, firstTryThisRound));

  useEffect(() => {
    listDevices()
      .then((list) => {
        setDevices(list);
        setDeviceId((current) => current ?? list[0]?.id ?? null);
      })
      .catch((e) => setError(e.message));
  }, []);

  if (error) {
    // Prints the actual configured API_BASE, not just the fetch failure --
    // this is the whole safeguard. The 2026-09-06 incident (a frontend
    // rebuild without VITE_API_BASE set silently fell back to the localhost
    // dev default) looked identical to a real visitor's own network being
    // broken from inside a browser console; showing the configured value
    // right on the page turns "failed to fetch" into an obviously-wrong
    // deploy config at a glance, with no devtools required.
    return (
      <main>
        <h1>FaultFinder</h1>
        <p className="error" role="alert">
          Can't reach the FaultFinder API at <code>{API_BASE}</code>: {error}
        </p>
      </main>
    );
  }
  if (!deviceId) return <p>Loading devices…</p>;

  return (
    <main>
      <h1>FaultFinder</h1>
      <p className="score-bar">
        Solved: {score.solved}/{score.attempts} &middot; Streak: {score.currentStreak} (best {score.bestStreak})
      </p>
      <label>
        Device:{' '}
        <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>{' '}
      <div className="view-toggle">
        <button type="button" disabled={view === 'schematic'} onClick={() => setView('schematic')}>
          Schematic view
        </button>{' '}
        <button type="button" disabled={view === 'pcb'} onClick={() => setView('pcb')}>
          PCB view
        </button>
      </div>
      {view === 'schematic' ? (
        <SchematicProbeView key={deviceId} deviceId={deviceId} onGuess={onGuess} />
      ) : (
        <PcbProbeView key={deviceId} deviceId={deviceId} onGuess={onGuess} />
      )}
    </main>
  );
}

export default App;
