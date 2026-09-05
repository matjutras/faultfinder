import { useEffect, useState } from 'react';
import { listDevices } from './api';
import { PcbProbeView } from './PcbProbeView';
import { SchematicProbeView } from './SchematicProbeView';
import type { DeviceSummary } from './types';

type ViewMode = 'schematic' | 'pcb';

function App() {
  const [view, setView] = useState<ViewMode>('schematic');
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listDevices()
      .then((list) => {
        setDevices(list);
        setDeviceId((current) => current ?? list[0]?.id ?? null);
      })
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="error">Error: {error}</p>;
  if (!deviceId) return <p>Loading devices…</p>;

  return (
    <main>
      <h1>FaultFinder</h1>
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
        <SchematicProbeView key={deviceId} deviceId={deviceId} />
      ) : (
        <PcbProbeView key={deviceId} deviceId={deviceId} />
      )}
    </main>
  );
}

export default App;
