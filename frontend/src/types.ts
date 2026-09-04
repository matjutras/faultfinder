export interface TestPoint {
  tp_id: string;
  label: string;
  node: string;
  x_mm: number;
  y_mm: number;
  pcb_x_mm?: number;
  pcb_y_mm?: number;
}

export interface Fault {
  id: string;
  name: string;
  difficulty: string;
  kind?: string;
  intermittent?: boolean;
  patch: Record<string, unknown>[];
}

export interface Device {
  id: string;
  name: string;
  schematic_sch: string;
  testpoints: TestPoint[];
  faults: Fault[];
  board_size_mm?: { width: number; height: number };
  board_thickness_mm?: number;
  pcb_glb?: string;
}

export interface MeasureResult {
  fault_id: string;
  probes: Record<string, number>;
  differential_volts: number;
}
