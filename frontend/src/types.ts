export interface Pin {
  ref: string;
  pin: string;
  node: string;
  x_mm: number;
  y_mm: number;
}

export interface Wire {
  node: string;
  x1_mm: number;
  y1_mm: number;
  x2_mm: number;
  y2_mm: number;
}

export interface PcbPad {
  ref: string;
  pin: string;
  node: string;
  x_mm: number;
  y_mm: number;
}

export interface PcbTrack {
  node: string;
  layer: string;
  x1_mm: number;
  y1_mm: number;
  x2_mm: number;
  y2_mm: number;
}

export interface Fault {
  id: string;
  name: string;
  difficulty: string;
  kind?: string;
  intermittent?: boolean;
  patch: Record<string, unknown>[];
}

export interface DeviceSummary {
  id: string;
  name: string;
}

export interface Device {
  id: string;
  name: string;
  schematic_sch: string;
  pins: Pin[];
  wires: Wire[];
  pcb_pads: PcbPad[];
  pcb_tracks: PcbTrack[];
  faults: Fault[];
  board_size_mm?: { width: number; height: number };
  board_thickness_mm?: number;
  pcb_glb?: string;
}

export interface MeasureResult {
  fault_id: string;
  probes: { node: string; volts: number }[];
  differential_volts: number;
}
