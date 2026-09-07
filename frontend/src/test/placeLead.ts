import { fireEvent, screen } from '@testing-library/react';

// Simulates the click-to-arm-then-tap-to-place gesture that replaced
// dragging: click the lead's jack on the multimeter (arms it), then tap the
// workspace stage at (clientX, clientY). A plain fireEvent.click on the
// stage won't do -- useTapGesture distinguishes a tap from a drag via its
// own pointerdown/pointerup, not a click event.
export function placeLead(color: 'red' | 'black', clientX: number, clientY: number) {
  fireEvent.click(screen.getByTestId(`lead-jack-${color}`));
  const stage = screen.getByTestId('probe-stage');
  fireEvent.pointerDown(stage, { clientX, clientY });
  fireEvent.pointerUp(stage, { clientX, clientY });
}
