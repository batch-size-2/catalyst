import { useEffect, useState } from "react";
import type { KpiDictionary, KpiEntry, Status, Tile, Verdict } from "./types";

/** Batch colours are design tokens; use the CSS var so styles stay in sync with tokens.css. */
export const BATCH_COLORS: Record<string, string> = {
  Batch_1: "var(--cx-batch-1)",
  Batch_2: "var(--cx-batch-2)",
  Batch_3: "var(--cx-batch-3)",
};

export function batchColor(name: string): string {
  if (BATCH_COLORS[name]) return BATCH_COLORS[name];
  return name.startsWith("drop") || name.startsWith("new") ? "var(--cx-new)" : "var(--cx-faint)";
}

/** "Batch_2" -> "Batch 2"; anything else stays as written. */
export const batchLabel = (name: string) => name.replaceAll("_", " ");

/** Folders created by UI uploads are named drop_*. */
export const isUploadBatch = (name: string) => name.startsWith("drop");

export const VERDICT_CLASS: Record<Verdict, string> = {
  ACCEPT: "accept",
  INVESTIGATE: "investigate",
  REJECT: "reject",
};

export const STATUS_CHIP: Record<Status, { label: string; className: string }> = {
  SIMILAR: {
    label: "Similar",
    className: "text-cx-accept-text border border-cx-accept/30 bg-cx-accept/10",
  },
  UNCLEAR: {
    label: "Unclear",
    className: "text-cx-investigate-text border border-cx-investigate/30 bg-cx-investigate/10",
  },
  DIFFERENT: {
    label: "Different",
    className: "text-cx-reject-text border border-cx-reject/30 bg-cx-reject/10",
  },
};

const PAUSED_CHIP = "text-cx-muted border border-cx-line bg-white/5";

export function statusChip(status: Status, paused: boolean): { label: string; className: string } {
  return paused ? { label: "Paused", className: PAUSED_CHIP } : STATUS_CHIP[status];
}

/** The dictionary entry for a quantity, including type_share:<id> lookups (qc.explain.entry). */
export function dictEntry(name: string, dict: KpiDictionary | null): KpiEntry {
  if (!dict) return {};
  if (name.startsWith("type_share:")) {
    const types = dict.particle_types as Record<string, KpiEntry> | undefined;
    return types?.[name.slice("type_share:".length)] ?? {};
  }
  return (dict[name] as KpiEntry | undefined) ?? {};
}

export function quantityLabel(name: string, dict: KpiDictionary | null): string {
  const entry = dictEntry(name, dict);
  if (entry.name) return entry.name[0].toUpperCase() + entry.name.slice(1);
  if (name.startsWith("type_share:")) return `share of particle type ${name.slice(11)}`;
  return humanize(name);
}

/** qc.explain.fmt: fractions as %, µm with its unit, everything else bare. */
export function fmt(value: number | null | undefined, unit: string | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (unit === "fraction") return `${Number((value * 100).toPrecision(3))}%`;
  const v = Number(value.toPrecision(3));
  if (unit === "um") return `${v} µm`;
  return `${v}`;
}

const ACRONYMS = new Set([
  "bse", "etd", "se", "inlens", "si", "lbp", "glcm", "cv", "sd", "um", "pc",
]);

export function humanize(code: string): string {
  return code
    .split(/[_:\s]+/)
    .filter(Boolean)
    .map((tok) =>
      ACRONYMS.has(tok.toLowerCase()) || /^[ptd]\d/i.test(tok)
        ? tok.toUpperCase()
        : tok[0].toUpperCase() + tok.slice(1),
    )
    .join(" ");
}

/** Friendly name for an attribution feature code: kpi_ -> dictionary, others humanized per family. */
export function featureLabel(code: string, dict: KpiDictionary | null): string {
  if (code.startsWith("kpi_")) return quantityLabel(code.slice(4), dict);
  return humanize(code.replace(/^(reg|edge|tex|par|img|deep)_/, ""));
}

/** Baseline mean ± SD of one KPI across the baseline batch's tiles (presentation only). */
export function baselineBand(tiles: Tile[], baseline: string, kpi: string) {
  const values = tiles
    .filter((t) => t.batch === baseline)
    .map((t) => t.kpis?.[kpi])
    .filter((v): v is number => v != null && Number.isFinite(v));
  if (!values.length) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, values.length - 1));
  return { mean, sd, values };
}

/** Position of a z-like value in [-span, span] as a 0..100 percentage. */
export const sigmaPos = (z: number, span = 3) =>
  (Math.max(-span, Math.min(span, z)) + span) / (2 * span) * 100;

export function shortHash(hash: string | null | undefined, n = 8): string {
  return hash ? hash.slice(0, n) : "—";
}

/** GET helper: data starts null and errors surface as a string. */
export function useApi<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setError(null);
    fn().then(
      (value) => live && setData(value),
      (err) => live && setError(err instanceof Error ? err.message : String(err)),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error };
}
