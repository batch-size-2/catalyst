/** Mirrors qc/schema.py (Evidence) and qc/api.py (BatchSummary, run events). Update together. */

export type Verdict = "ACCEPT" | "INVESTIGATE" | "REJECT";
export type TileStatus = "CONFORMING" | "SUSPECT" | "NON_CONFORMING";

export interface TileResult {
  image_id: string;
  strip_id: string | null;
  status: TileStatus;
  kpis: Record<string, number | null>;
  reasons: string[];
}

export interface KpiResult {
  name: string;
  unit: string;
  band: [number, number];
  baseline_mean: number;
  batch_mean: number | null;
  n_outside: number;
}

export interface Evidence {
  batch: string;
  baseline: string;
  verdict: Verdict;
  next_action: string;
  nonconforming: { x: number; n: number; ci: [number, number]; unit: "tile" | "strip" };
  kpis: KpiResult[];
  tiles: TileResult[];
  n_images: Record<string, number>;
  config_version: string;
}

export interface BatchSummary {
  name: string;
  has_images: boolean;
  verdict: Verdict | null;
}

export interface Config {
  version: string;
  baseline: string;
  ci_level: number;
}

export type RunEvent =
  | { type: "progress"; done: number; total: number; tile: string }
  | { type: "done"; evidence: Evidence }
  | { type: "error"; message: string };
