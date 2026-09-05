/// <reference types="node" />
// (This file only, not the whole app: tsconfig.app.json's `types` is scoped
// to `vite/client` for the browser build, so a project-wide "node" types
// addition isn't appropriate just for one Node-side test reading a file.)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Regression coverage for the mobile tap-target fix: reads the actual
// stylesheet text directly (vitest's jsdom environment doesn't load real CSS
// files, and Vite's `?raw` raw-import is intercepted by vitest's own CSS
// mocking even with the raw query -- confirmed empirically, not assumed) and
// asserts the tappable `.probe-marker` box stayed enlarged to 44x44 while the
// *visible* dot (`::before`) stayed at its original, smaller 22x22 -- the
// whole point being a bigger tap target without a bigger-looking marker.
// `.probe-marker` now marks every component pin (milestone 8), not just
// dedicated TP markers, but the same tap-target sizing rule still applies.
const CSS_PATH = join(dirname(fileURLToPath(import.meta.url)), 'SchematicProbeView.css');
const css = readFileSync(CSS_PATH, 'utf-8');

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.]/g, '\\.');
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!match) throw new Error(`no CSS rule found for ${selector}`);
  return match[1];
}

describe('probe-marker tap target size', () => {
  it('keeps the tappable box at 44x44px', () => {
    const body = ruleBody('.probe-marker');
    expect(body).toMatch(/width:\s*44px/);
    expect(body).toMatch(/height:\s*44px/);
  });

  it('keeps the visible dot smaller, at its original 22x22px', () => {
    const body = ruleBody('.probe-marker::before');
    expect(body).toMatch(/width:\s*22px/);
    expect(body).toMatch(/height:\s*22px/);
  });
});
