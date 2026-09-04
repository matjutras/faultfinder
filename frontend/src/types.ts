export interface TestPoint {
  tp_id: string;
  label: string;
  node: string;
  x_mm: number;
  y_mm: number;
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
}

export interface MeasureResult {
  fault_id: string;
  probes: Record<string, number>;
  differential_volts: number;
}
