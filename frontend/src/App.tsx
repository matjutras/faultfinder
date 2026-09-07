import { useEffect, useState } from 'react';
import './App.css';
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
  const [menuOpen, setMenuOpen] = useState(false);
  // Owned here, not inside SchematicProbeView/PcbProbeView: switching devices
  // remounts those (key={deviceId}, so probe selections don't leak between
  // devices), but the score is a session total across every device, so it
  // must live above that remount boundary.
  const [score, setScore] = useState(INITIAL_SCORE);
  const onGuess = (correct: boolean, firstTryThisRound: boolean) =>
    setScore((s) => recordGuess(s, correct, firstTryThisRound));

  // Portal targets for whichever ProbeView is currently mounted -- it still
  // owns the title/round-controls/difficulty state, but renders that content
  // here, in the shell's always-visible top bar and collapsible menu
  // (milestone 11), instead of inline next to its own canvas. Plain refs
  // won't do: a portal target has to actually exist in state (so the
  // subsequent render that has it can pass it down) before a child can
  // portal into it, and these divs are always mounted (see App.css --
  // .menu-drawer is hidden with a CSS class, not by unmounting) specifically
  // so a target is never transiently null while the menu is merely closed --
  // see SchematicProbeView.tsx's identical props for why that matters (a
  // null target falls back to inline rendering, which would otherwise make
  // the difficulty picker flash into the canvas every time the menu closes).
  const [titleEl, setTitleEl] = useState<HTMLDivElement | null>(null);
  const [actionsEl, setActionsEl] = useState<HTMLDivElement | null>(null);
  const [menuEl, setMenuEl] = useState<HTMLDivElement | null>(null);

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
      <main className="app-error">
        <h1>FaultFinder</h1>
        <p className="error" role="alert">
          Can't reach the FaultFinder API at <code>{API_BASE}</code>: {error}
        </p>
      </main>
    );
  }
  if (!deviceId) return <p>Loading devices…</p>;

  const viewProps = {
    deviceId,
    onGuess,
    titlePortalTarget: titleEl,
    actionsPortalTarget: actionsEl,
    menuPortalTarget: menuEl,
  };

  return (
    <div className="app-shell">
      <div className="topbar">
        <button
          type="button"
          className="hamburger-button"
          data-testid="hamburger-button"
          aria-label="Menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >
          ☰
        </button>
        <div className="topbar-title" ref={setTitleEl} />
        <div className="topbar-actions" ref={setActionsEl} />
        <p className="score-bar">
          Solved: {score.solved}/{score.attempts} &middot; Streak: {score.currentStreak} (best {score.bestStreak})
        </p>
      </div>

      {menuOpen && <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />}
      <div className={`menu-drawer ${menuOpen ? 'open' : ''}`}>
        <label>
          Device:{' '}
          <select
            value={deviceId}
            onChange={(e) => {
              setDeviceId(e.target.value);
              setMenuOpen(false);
            }}
          >
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <div className="view-toggle">
          <button type="button" disabled={view === 'schematic'} onClick={() => setView('schematic')}>
            Schematic view
          </button>{' '}
          <button type="button" disabled={view === 'pcb'} onClick={() => setView('pcb')}>
            PCB view
          </button>
        </div>
        <div className="menu-extra" ref={setMenuEl} />
      </div>

      <div className="canvas-area">
        {view === 'schematic' ? <SchematicProbeView {...viewProps} key={deviceId} /> : <PcbProbeView {...viewProps} key={deviceId} />}
      </div>
    </div>
  );
}

export default App;
