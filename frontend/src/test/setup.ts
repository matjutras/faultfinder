import '@testing-library/jest-dom/vitest';

// jsdom has no ResizeObserver; @react-three/fiber's <Canvas> needs one (via
// react-use-measure) just to mount, before any WebGL is involved.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).ResizeObserver ??= ResizeObserverStub;
