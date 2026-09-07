// Ad-hoc live-browser verification script, run manually against a live
// backend+frontend dev pair -- not part of the automated test suite (see
// backend/tests and frontend/*.test.tsx for that). Exercises the exact
// click-to-arm/tap-to-place probe flow a real user would, computing tap
// pixel coordinates from the device's own API-reported pin positions and
// page size (mirrors src/kicadCoords.ts's schematicMmToPixels -- kept in
// sync by hand since this script isn't bundled through the app's own TS
// build).
//
// Usage: node scripts/verify-device.mjs <deviceId> <frontendUrl> [outDir]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const [, , deviceId, frontendUrl = 'http://localhost:5180', outDir = '/tmp/ff-verify'] = process.argv;
if (!deviceId) {
  console.error('usage: node scripts/verify-device.mjs <deviceId> [frontendUrl] [outDir]');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

function schematicMmToPixels(xMm, yMm, containerWidth, containerHeight, pageWidthMm, pageHeightMm) {
  const scale = Math.min(containerWidth / pageWidthMm, containerHeight / pageHeightMm);
  const offsetX = (containerWidth - pageWidthMm * scale) / 2;
  const offsetY = (containerHeight - pageHeightMm * scale) / 2;
  return { x: offsetX + xMm * scale, y: offsetY + yMm * scale };
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
page.on('console', (msg) => {
  if (msg.type() === 'error') console.log('  [browser console error]', msg.text());
});
page.on('pageerror', (err) => console.log('  [browser page error]', err.message));

try {
  console.log(`Loading ${frontendUrl} ...`);
  await page.goto(frontendUrl, { waitUntil: 'networkidle' });

  await page.selectOption('select', deviceId);
  await page.waitForSelector('kicanvas-embed');
  await page.waitForTimeout(1500); // KiCanvas's own async schematic parse/render
  await page.screenshot({ path: `${outDir}/${deviceId}-schematic.png` });
  console.log(`Schematic screenshot: ${outDir}/${deviceId}-schematic.png`);

  const heading = await page.textContent('h2');
  console.log('Device heading:', heading);

  const apiBase = await page.evaluate(() => window.location.origin.replace(/:\d+$/, ':8010'));
  const device = await page.evaluate(async (base) => {
    const resp = await fetch(`${base}/api/devices/${new URLSearchParams(location.search).get('d') || ''}`);
    return resp.ok ? resp.json() : null;
  }, apiBase);
  // fallback: re-fetch by known id since query-string trick above is unused by this app
  const deviceResp = await page.evaluate(
    async ([base, id]) => (await fetch(`${base}/api/devices/${id}`)).json(),
    [apiBase, deviceId],
  );

  const pinsByNode = new Map();
  for (const p of deviceResp.pins) {
    if (!pinsByNode.has(p.node)) pinsByNode.set(p.node, p);
  }
  const nodeNames = [...pinsByNode.keys()];
  if (nodeNames.length < 2) throw new Error(`device ${deviceId} has fewer than 2 distinct nets to probe`);
  const redNode = nodeNames.find((n) => n !== '0') ?? nodeNames[0];
  const blackNode = nodeNames.find((n) => n === '0') ?? nodeNames.find((n) => n !== redNode);
  const redPin = pinsByNode.get(redNode);
  const blackPin = pinsByNode.get(blackNode);
  console.log(`Probing red=${redNode} (${redPin.ref}:${redPin.pin}), black=${blackNode} (${blackPin.ref}:${blackPin.pin})`);

  const stageBox = await page.locator('.schematic-stage').boundingBox();
  const SCHEMATIC_WIDTH = 800;
  const SCHEMATIC_HEIGHT = 880;
  const pageW = deviceResp.page_width_mm;
  const pageH = deviceResp.page_height_mm;

  async function placeLead(color, pinMm) {
    const local = schematicMmToPixels(pinMm.x_mm, pinMm.y_mm, SCHEMATIC_WIDTH, SCHEMATIC_HEIGHT, pageW, pageH);
    const targetX = stageBox.x + local.x;
    const targetY = stageBox.y + local.y;
    await page.click(`[data-testid="lead-jack-${color}"]`);
    await page.mouse.move(targetX, targetY);
    await page.mouse.down();
    await page.mouse.up();
  }

  await placeLead('red', redPin);
  await placeLead('black', blackPin);
  await page.waitForTimeout(400);

  const leadRedVisible = await page.locator('[data-testid="lead-red"]').isVisible().catch(() => false);
  const leadBlackVisible = await page.locator('[data-testid="lead-black"]').isVisible().catch(() => false);
  console.log('lead-red placed:', leadRedVisible, ' lead-black placed:', leadBlackVisible);

  await page.screenshot({ path: `${outDir}/${deviceId}-probes-placed.png` });

  const readoutText = await page.locator('.readout').textContent().catch(() => null);
  console.log('Readout:', readoutText);

  await page.click('button:has-text("Reveal fault")');
  const faultText = await page.locator('.revealed-fault').textContent().catch(() => null);
  console.log('Revealed fault:', faultText);

  await page.screenshot({ path: `${outDir}/${deviceId}-revealed.png` });

  // PCB view
  await page.click('button:has-text("PCB view")');
  await page.waitForTimeout(1500); // three.js scene mount + glb load
  await page.screenshot({ path: `${outDir}/${deviceId}-pcb.png` });
  console.log(`PCB screenshot: ${outDir}/${deviceId}-pcb.png`);

  const canvasSample = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return null;
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    return { width: canvas.width, height: canvas.height, hasGl: !!gl };
  });
  console.log('PCB canvas:', canvasSample);

  // Bottom-of-board check: OrbitControls' polar angle is unrestricted enough
  // (minPolarAngle=0.05, maxPolarAngle=Math.PI-0.05, see PcbProbeView.tsx) to
  // flip past horizontal and view the board's underside -- verify that's
  // actually reachable by dragging, not just that the prop is set. A
  // container-height drag maps to a full 2*pi polar rotation (three.js
  // OrbitControls default rotateSpeed=1), so step in increments rather than
  // one big drag, which would overshoot back to the starting view.
  const pcbBox = await page.locator('.pcb-stage canvas').boundingBox();
  const pcx = pcbBox.x + pcbBox.width / 2;
  await page.mouse.move(pcx, pcbBox.y + pcbBox.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(pcx, pcbBox.y + pcbBox.height / 2 - i * (pcbBox.height / 16), { steps: 5 });
  }
  await page.mouse.up();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${outDir}/${deviceId}-pcb-bottom.png` });
  console.log(`PCB bottom-view screenshot: ${outDir}/${deviceId}-pcb-bottom.png`);

  console.log('\nDONE. Screenshots in', outDir);
} finally {
  await browser.close();
}
