import { useState } from 'react';
import { PcbProbeView } from './PcbProbeView';
import { SchematicProbeView } from './SchematicProbeView';

type ViewMode = 'schematic' | 'pcb';

function App() {
  const [view, setView] = useState<ViewMode>('schematic');

  return (
    <main>
      <h1>FaultFinder</h1>
      <div className="view-toggle">
        <button type="button" disabled={view === 'schematic'} onClick={() => setView('schematic')}>
          Schematic view
        </button>{' '}
        <button type="button" disabled={view === 'pcb'} onClick={() => setView('pcb')}>
          PCB view
        </button>
      </div>
      {view === 'schematic' ? (
        <SchematicProbeView deviceId="voltage_divider_01" />
      ) : (
        <PcbProbeView deviceId="voltage_divider_01" />
      )}
    </main>
  );
}

export default App;
