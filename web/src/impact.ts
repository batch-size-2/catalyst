/** Types and fetch for GET /api/impact/{batch} (qc/impact.py Report). Experimental feature "impact" (web/src/flags.ts). */

export interface Interval {
  value: number | null;
  low: number | null;
  high: number | null;
}

export type Effect = "better" | "worse" | "similar" | "unsettled";

export interface ImpactInput {
  kpi: string;
  unit: string;
  batch: Interval;
  baseline: Interval;
}

export interface ImpactFact {
  label: string;
  unit: string;
  batch: Interval;
  baseline: Interval;
}

export interface CurveLine {
  name: string;
  points: [number, number][];
  batch: string | null;
}

export interface CurveMarker {
  batch: string;
  x: Interval;
  y: Interval;
}

export interface Threshold {
  axis: "x" | "y";
  value: number;
  label: string;
}

export interface Curve {
  title: string;
  x_label: string;
  x_unit: string;
  y_label: string;
  y_unit: string;
  x_log: boolean;
  y_log: boolean;
  lines: CurveLine[];
  markers: CurveMarker[];
  thresholds: Threshold[];
}

export type Severity = "performance" | "reliability" | "safety";

/** "If you ignore this, what's the worst that could happen?" (config/impact.yaml worst_case). */
export interface WorstCase {
  headline: string;
  severity: Severity;
  trigger: "likely" | "possible";
  adverse: number;
  chain: string[];
  likelihood: string;
  prevents: string[];
  refs: string[];
  detail: string | null;
}

export interface Impact {
  id: string;
  property: string;
  measure: string;
  unit: string;
  higher_is: "better" | "worse";
  effect: Effect;
  batch: Interval;
  baseline: Interval;
  change: Interval;
  consequence: string;
  mechanism: string;
  formula: string;
  inputs: ImpactInput[];
  facts: ImpactFact[];
  assumptions: string[];
  caveats: string[];
  refs: string[];
  curve: Curve | null;
  absolute: boolean;
  worst_case: WorstCase | null;
}

export interface Scenario {
  cycles: number[];
  baseline: number[];
  batch_low: number[];
  batch_mid: number[];
  batch_high: number[];
  fade_scale: Interval;
  baseline_cycles_to_80: number | null;
  cycles_to_80: Interval;
  assumptions: string[];
}

export interface ImpactReport {
  batch: string;
  baseline: string;
  label: string;
  interval: number;
  similar_within: number;
  n_resamples: number;
  n_images: Record<string, number>;
  n_strips: Record<string, number>;
  composition: Record<string, Record<"silicon" | "graphite" | "pores" | "other", number | null>>;
  impacts: Impact[];
  scenario: Scenario | null;
  summary: string[];
  caveats: string[];
  references: Record<string, string>;
  worst: string | null;
  worst_note: string;
}

export async function getImpact(batch: string, baseline?: string): Promise<ImpactReport> {
  const query = baseline ? `?baseline=${encodeURIComponent(baseline)}` : "";
  const res = await fetch(`/api/impact/${encodeURIComponent(batch)}${query}`);
  if (!res.ok) {
    const text = await res.text();
    let detail = text;
    try {
      detail = JSON.parse(text).detail ?? text;
    } catch {
      /* plain text */
    }
    throw new Error(`${res.status}: ${detail}`);
  }
  return res.json();
}

/** A value in its unit: fractions as %, µm, × for ratios. */
export function fmtUnit(value: number | null | undefined, unit: string): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sig = (v: number, n = 3) => `${Number(v.toPrecision(n))}`;
  if (unit === "fraction") return `${sig(value * 100, value < 0.01 ? 2 : 3)}%`;
  if (unit === "um") return `${sig(value)} µm`;
  if (unit === "ratio") return `${sig(value)}×`;
  if (unit === "mAh/g") return `${Math.round(value)} mAh/g`;
  return `${sig(value)} ${unit}`;
}

/** A relative change as a signed whole percentage. */
export function fmtChange(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const p = Math.round(value * 100);
  return p === 0 ? "≈0%" : `${p > 0 ? "+" : "−"}${Math.abs(p)}%`;
}
