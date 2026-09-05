import { fireEvent, screen } from '@testing-library/react';

// Simulates a full drag-and-drop gesture for one of the multimeter's leads:
// grab the jack (pointerdown), then drop at (clientX, clientY) -- mirroring
// what useLeadDrag actually listens for (window-level pointerup), not a
// click, since click-to-place no longer exists in the UI.
export function dragLeadTo(color: 'red' | 'black', clientX: number, clientY: number) {
  const handle = screen.getByTestId(`lead-drag-${color}`);
  fireEvent.pointerDown(handle, { clientX: 0, clientY: 0 });
  fireEvent.pointerUp(window, { clientX, clientY });
}
