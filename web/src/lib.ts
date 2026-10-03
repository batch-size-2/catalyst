import { useEffect, useState } from "react";
import type { Difference, Evidence, KpiDictionary, KpiEntry, Odd, Status, Tile, Verdict } from "./types";

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

/** "Batch_2" -> "Batch 2"; upload folders (drop_*) keep the name they were written with. */
export const batchLabel = (name: string) => (name.startsWith("drop") ? name : name.replaceAll("_", " "));

/** A baseline needs a spread (SD) and an odd-tile range: decide.py's odd check wants at least 3 values. */
export const MIN_BASELINE_TILES = 3;

/** "1 tile", "7 tiles" */
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

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

/** The dictionary name, capitalised; type shares read "Share of T2 particles". Code names are secondary. */
export function quantityLabel(name: string, dict: KpiDictionary | null): string {
  const entry = dictEntry(name, dict);
  const text = entry.name ?? (name.startsWith("type_share:") ? `share of ${name.slice(11)} particles` : humanize(name));
  return text[0].toUpperCase() + text.slice(1);
}

/** For a particle type, its description ("mid, grey: 1.7× graphite brightness, D50 2.2 µm"). */
export function quantityNote(name: string, dict: KpiDictionary | null): string | null {
  return name.startsWith("type_share:") ? prettyText(dictEntry(name, dict).meaning ?? "") || null : null;
}

/** Pat's sentences as people read them: Batch_3 -> Batch 3, um -> µm, 1.7x -> 1.7×, -0.85 -> −0.85. */
export function prettyText(text: string): string {
  return text
    .replace(/Batch_(\w+)/g, "Batch $1")
    .replace(/(\d)\s?um\b/g, "$1 µm")
    .replace(/\bum\b/g, "µm")
    .replace(/(\d)x\b/g, "$1×")
    .replace(/(\d) SD\b/g, "$1σ")
    .replace(/(^|[\s(=])-(\d)/g, "$1−$2");
}

/** qc.explain.fmt: fractions as %, µm with its unit, everything else bare. */
export function fmt(value: number | null | undefined, unit: string | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (unit === "fraction") return `${Number((value * 100).toPrecision(3))}%`;
  const v = Number(value.toPrecision(3));
  if (unit === "um") return `${v} µm`;
  return `${v}`;
}

/** "+2.1σ" */
export const fmtSigma = (s: number | null | undefined) =>
  s == null || !Number.isFinite(s) ? "—" : `${s > 0 ? "+" : s < 0 ? "−" : ""}${Math.abs(s).toFixed(1)}σ`;

const ACRONYMS: Record<string, string> = {
  bse: "BSE", etd: "ETD", se: "SE", inlens: "InLens", si: "Si", lbp: "LBP", glcm: "GLCM", cv: "CV",
  sd: "SD", um: "µm", pc: "PC",
};

/** A code name in sentence case: "unassigned_share" -> "Unassigned share", "tex_bse_lbp8" -> "Tex BSE LBP8". */
export function humanize(code: string): string {
  return code
    .split(/[_:\s]+/)
    .filter(Boolean)
    .map((tok, i) =>
      ACRONYMS[tok.toLowerCase()] ??
      (/^[ptd]\d/i.test(tok) || /^[a-z]+\d+$/i.test(tok) && ACRONYMS[tok.replace(/\d+$/, "").toLowerCase()]
        ? tok.toUpperCase()
        : i === 0 ? tok[0].toUpperCase() + tok.slice(1) : tok.toLowerCase()),
    )
    .join(" ");
}

/** A difference in baseline SDs: the margin is `similarMargin` SDs (the ±1.5σ tolerance). */
export const sigmaOf = (d: Difference, value: number | null | undefined, similarMargin: number) =>
  value == null || !d.margin ? null : (value / d.margin) * similarMargin;

/** Odd entries (one per tile and quantity) grouped by tile, or by strip at the strip unit. */
export function oddByTile(evidence: Evidence): Map<string, Odd[]> {
  const units = new Map<string, Odd[]>();
  for (const odd of evidence.unit === "image" ? evidence.odd_images : evidence.odd_strips) {
    const key = evidence.unit === "image" ? odd.image_ids[0] : odd.strip_id;
    units.set(key, [...(units.get(key) ?? []), odd]);
  }
  return units;
}

/** Of exactly two particle-type shares, the lower-ranked in evidence.drivers: it mirrors the other (qc.explain.twin_share). */
export function twinShare(evidence: Evidence): string | null {
  const shares = evidence.differences.filter((d) => d.name.startsWith("type_share:")).map((d) => d.name);
  if (shares.length !== 2) return null;
  const rank = (q: string) => {
    const i = evidence.drivers.indexOf(q);
    return i < 0 ? evidence.drivers.length + shares.indexOf(q) : i;
  };
  return rank(shares[0]) > rank(shares[1]) ? shares[0] : shares[1];
}

/** Drop the mirrored particle-type share, so the shift is shown once and everywhere the same one. */
export function dropTwinShare<T extends { name: string }>(items: T[], evidence: Evidence): T[] {
  const twin = twinShare(evidence);
  return items.filter((d) => d.name !== twin);
}

/** The backend's ranking (evidence.drivers) of used key properties that aren't settled as similar. */
export function rankedFindings(evidence: Evidence): Difference[] {
  const byName = new Map(evidence.differences.map((d) => [d.name, d]));
  const ranked = evidence.drivers
    .map((q) => byName.get(q))
    .filter((d): d is Difference => !!d && d.used && d.status !== "SIMILAR");
  return dropTwinShare(ranked, evidence);
}

const METRIC_WORDS: Record<string, string> = {
  noise: "noise", sharpness: "sharpness", p1: "brightness", p50: "brightness", p99: "brightness",
  black_level: "black level", saturated_frac: "saturation", curtaining_index: "curtaining",
};

/** "Noise and brightness differ on all three detectors, sharpness on BSE and ETD" (qc.explain.imaging_words). */
export function imagingWords(metrics: string[]): string {
  const where = new Map<string, string[]>();
  for (const m of metrics) {
    const dot = m.lastIndexOf(".");
    const kind = METRIC_WORDS[m.slice(dot + 1)] ?? m.slice(dot + 1);
    const channels = where.get(kind) ?? [];
    if (dot > 0 && !channels.includes(m.slice(0, dot))) channels.push(m.slice(0, dot));
    where.set(kind, channels);
  }
  const groups = new Map<string, { channels: string[]; kinds: string[] }>();
  const order = ["BSE", "ETD", "InLens"];
  for (const [kind, unsorted] of where) {
    const channels = [...unsorted].sort((a, b) => (order.indexOf(a) + 1 || 9) - (order.indexOf(b) + 1 || 9) || a.localeCompare(b));
    const key = channels.join("|");
    groups.set(key, { channels, kinds: [...(groups.get(key)?.kinds ?? []), kind] });
  }
  const on = (c: string[]) => (!c.length ? "" : c.length === 3 ? " on all three detectors" : ` on ${joinAnd(c)}`);
  const parts = [...groups.values()].sort((a, b) => b.channels.length - a.channels.length);
  if (!parts.length) return "";
  const [head, ...rest] = parts;
  const text = [
    `${joinAnd(head.kinds)} ${head.kinds.length === 1 ? "differs" : "differ"}${on(head.channels)}`,
    ...rest.map((g) => `${joinAnd(g.kinds)}${on(g.channels)}`),
  ].join(", ");
  return text[0].toUpperCase() + text.slice(1);
}

export function joinAnd(items: string[]): string {
  const xs = [...new Set(items)];
  return xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
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

/** "9 of 9" for a held-out record. */
export const record = (r: { right: number; n: number } | null | undefined) => (r ? `${r.right} of ${r.n}` : "—");

/** "Staged: named measurements, then DINOv2" from the model's kind and families. */
export function modelName(m: { kind?: string; families?: string[] | null; staged?: string[][] | null }): string {
  const side = (fams: string[]) => (fams.length === 1 && fams[0] === "deep" ? "DINOv2 image features" : "named measurements");
  if (m.kind === "staged" && m.staged?.length === 2) return `Staged: ${side(m.staged[0])}, then ${side(m.staged[1])}`;
  return m.families ? `Single model: ${side(m.families)}` : "Single model";
}

/** A timestamp as UTC, so times from git (local offset) and from runs (UTC) line up: "2026-10-03 21:10 UTC". */
export function utc(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
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
