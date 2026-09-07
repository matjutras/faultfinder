import { useEffect, useState } from 'react';

export interface Size {
  width: number;
  height: number;
}

// Tracks a DOM element's real rendered size via ResizeObserver, so the
// schematic view can fill whatever space the layout actually gives it
// (milestone 11's full-viewport canvas) instead of a fixed pixel box.
// `resolveSchematicDropTarget`/`schematicMmToPixels` already take
// containerWidth/containerHeight as plain parameters (not a hardcoded
// constant), specifically so a real element size can be threaded through
// them the same way a fixed one always was -- see kicadCoords.ts.
//
// Takes the element itself, not a RefObject -- callers track it with a
// plain `useState<Element | null>` and a callback ref (`ref={setEl}`), the
// same pattern App.tsx already uses for its portal targets, and for the
// same reason: a plain `useRef`'s `.current` mutates during commit, *after*
// render runs, so an effect keyed on `[ref.current]` reads the ref's value
// from *before* this commit while computing that render's own dependency
// array. That's a real, confirmed bug, not a lint nitpick: this component's
// first render (while its device is still loading) has no element to
// attach at all, so the effect no-ops with a `null` dependency; the very
// next render finally has the element, but the dependency array is still
// computed as `[null]` (the ref hasn't been committed yet), compares equal
// to the previous `[null]`, and React skips the effect -- the observer
// never attaches, permanently, and the stage stays locked at `fallback`.
// Plain reactive state doesn't have this problem: it's set via a real
// `setState` call exactly when the node attaches, so an effect depending on
// it re-runs then, every time, not just on whichever render happens to race
// ahead of the ref commit.
//
// Returns `fallback` until a real observation arrives. jsdom (the frontend
// test environment) has no layout engine and its ResizeObserver stub (see
// test/setup.ts) never actually calls back, so every existing test's
// assumption of a fixed pixel size continues to hold unchanged; only a real
// browser, whose ResizeObserver genuinely reports the container's laid-out
// size, ever updates past `fallback`.
export function useElementSize(el: Element | null, fallback: Size): Size {
  const [size, setSize] = useState<Size>(fallback);

  useEffect(() => {
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);

  return size;
}
