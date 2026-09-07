import { useEffect, useRef } from 'react';

// Whether a beep should fire on this transition -- pure and independently
// testable, separate from the actual Web Audio playback below (jsdom has no
// AudioContext, and this is the part with real logic worth covering: beep
// exactly on the rising edge into "continuous", never on every re-render of
// an already-continuous reading, since a measurement here is a discrete
// per-placement reading, not a live held-contact tone like a real meter's).
export function shouldBeep(wasActive: boolean, isActive: boolean): boolean {
  return isActive && !wasActive;
}

let sharedAudioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  sharedAudioContext ??= new Ctor();
  return sharedAudioContext;
}

function playBeep() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = 'square';
  oscillator.frequency.value = 1000;
  gain.gain.value = 0.05;
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start();
  oscillator.stop(ctx.currentTime + 0.15);
}

// Plays a short beep exactly when continuity mode's reading crosses into
// "continuous" -- see continuity.ts's isContinuous. Safe to call every
// render; only acts on the rising edge, and silently no-ops wherever
// AudioContext isn't available (jsdom in tests; a browser that hasn't
// granted an audio-capable user gesture yet -- lead placement is itself a
// tap, which real browsers do count as that gesture).
export function useContinuityBeep(active: boolean) {
  const wasActive = useRef(false);
  useEffect(() => {
    if (shouldBeep(wasActive.current, active)) playBeep();
    wasActive.current = active;
  }, [active]);
}
