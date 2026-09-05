import type { Device, DeviceSummary, MeasureResult } from './types';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000';

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
  tpIds: [string, string],
  faultId: string,
): Promise<MeasureResult> {
  const resp = await fetch(`${API_BASE}/api/devices/${deviceId}/measure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tp_ids: tpIds, fault_id: faultId }),
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
