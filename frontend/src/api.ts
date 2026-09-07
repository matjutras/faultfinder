import type { Device, DeviceSummary, DmmMode, MeasureResult } from './types';

// Exported (not just used internally) so App.tsx's on-load API-reachability
// check can print the actual configured value into the visible error state --
// this is what would have caught the 2026-09-06 production incident (a
// rebuild without VITE_API_BASE set fell back to this same localhost default,
// so every real visitor's browser silently called their own machine) at a
// glance, instead of only in each visitor's own browser console.
export const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000';

export async function listDevices(): Promise<DeviceSummary[]> {
  const resp = await fetch(`${API_BASE}/api/devices`);
  if (!resp.ok) throw new Error(`failed to list devices: ${resp.status}`);
  return resp.json();
}

export async function getDevice(deviceId: string): Promise<Device> {
  const resp = await fetch(`${API_BASE}/api/devices/${deviceId}`);
  if (!resp.ok) throw new Error(`failed to load device ${deviceId}: ${resp.status}`);
  return resp.json();
}

export async function measure(
  deviceId: string,
  nodes: [string, string],
  faultId: string,
  mode: DmmMode = 'voltage',
): Promise<MeasureResult> {
  const resp = await fetch(`${API_BASE}/api/devices/${deviceId}/measure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodes, fault_id: faultId, mode }),
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.detail ?? `measure failed: ${resp.status}`);
  }
  return resp.json();
}

export function deviceAssetUrl(deviceId: string, filename: string): string {
  return `${API_BASE}/static/devices/${deviceId}/${filename}`;
}
