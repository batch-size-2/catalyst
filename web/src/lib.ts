import { useEffect, useState } from "react";
import type { Config, Difference, Evidence, KpiDictionary, KpiEntry, Odd, Status, Tile, Verdict } from "./types";

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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Batch_2" -> "Batch 2", "drop_demo" -> "Drop demo"; an upload folder drop_20261004-073048 -> "Upload 4 Oct 07:30". */
export function batchLabel(name: string): string {
  const m = /^drop_(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})\d{2}$/.exec(name);
  if (m) return `Upload ${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[4]}:${m[5]}`;
  const words = name.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** An upload folder's name for a new drop, in local time: drop_<YYYYMMDD>-<HHMMSS>. */
export function uploadName(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `drop_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** A baseline needs a spread (SD) and an odd-tile range: decide.py's odd check wants at least 3 values. */
export const MIN_BASELINE_TILES = 3;

/** "1 tile", "7 tiles" */
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Test data that ships with the repo (data/example, the example_drop fixture): kept out of the product. */
export const isFixture = (name: string) => name.startsWith("example");

/** drop_<YYYYMMDD>-<HHMMSS>, the stamp of an upload, or "" for other folder names. */
const uploadStamp = (batch: string) => /^drop_(\d{8}-\d{6})$/.exec(batch)?.[1] ?? "";

/** The tiles the Library shows: no test data, and a tile uploaded more than once only from its newest upload. */
export function libraryTiles(tiles: Tile[]): Tile[] {
  const real = tiles.filter((t) => !isFixture(t.batch));
  const newest = new Map<string, Tile>();
  for (const t of real)
    if (isUploadBatch(t.batch) && (!newest.has(t.image_id) || uploadStamp(t.batch) > uploadStamp(newest.get(t.image_id)!.batch)))
      newest.set(t.image_id, t);
  return real.filter((t) => !isUploadBatch(t.batch) || newest.get(t.image_id) === t);
}

/** "2026-10-03 21:27" for timestamps written without a time zone (the model's fitted_at). */
export const localTime = (iso: string | null | undefined) => (iso ? iso.slice(0, 16).replace("T", " ") : "—");

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
    label: "Not settled",
    className: "text-cx-investigate-text border border-cx-investigate/30 bg-cx-investigate/10",
  },
  DIFFERENT: {
    label: "Differs",
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

/** "+2.1σ": rounded half away from zero (qc.explain.fmt_sigma), a real minus, never "−0.0σ". */
export function fmtSigma(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s)) return "—";
  const r = Math.floor(Math.abs(s) * 10 + 0.5 + 1e-9) / 10;
  return r ? `${s > 0 ? "+" : "−"}${r.toFixed(1)}σ` : "0.0σ";
}

/** "reference → batch" with the same number of decimals on both sides (3 significant figures of the larger). */
export function fmtPair(a: number | null | undefined, b: number | null | undefined, unit: string | undefined, sep = " → "): string {
  const f = unit === "fraction" ? 100 : 1;
  const vals = [a, b].filter((v): v is number => v != null && Number.isFinite(v)).map((v) => Math.abs(v * f));
  if (!vals.length) return `${fmt(a, unit)}${sep}${fmt(b, unit)}`;
  const top = Math.max(...vals);
  const dec = top ? Math.min(6, Math.max(0, 2 - Math.floor(Math.log10(top)))) : 0;
  const one = (v: number | null | undefined) =>
    v == null || !Number.isFinite(v) ? "—" : `${v === 0 ? "0" : (v * f).toFixed(dec)}${unit === "fraction" ? "%" : unit === "um" ? " µm" : ""}`;
  return `${one(a)}${sep}${one(b)}`;
}

/** A baseline range, clipped at 0 (every measured quantity is non-negative), same decimals on both ends. */
export const fmtRange = (lo: number, hi: number, unit: string | undefined) => fmtPair(Math.max(0, lo), hi, unit, " – ");

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

/** A difference in baseline SDs: the margin is similar_margin SDs (the ±1.5σ tolerance), unless the config
 *  sets that quantity's margin by hand; then there's no SD and no σ (qc.guide.sigma). */
export const sigmaOf = (d: Difference, value: number | null | undefined, config: Config) =>
  value == null || !d.margin || (config.margins as Record<string, number> | undefined)?.[d.name] != null
    ? null
    : (value / d.margin) * config.similar_margin;

/** Odd entries (one per tile and quantity) grouped by tile, or by strip at the strip unit. */
export function oddByTile(evidence: Evidence): Map<string, Odd[]> {
  const units = new Map<string, Odd[]>();
  for (const odd of evidence.unit === "image" ? evidence.odd_images : evidence.odd_strips) {
    const key = evidence.unit === "image" ? odd.image_ids[0] : odd.strip_id;
    units.set(key, [...(units.get(key) ?? []), odd]);
  }
  return units;
}

/** Drop the mirrored particle-type share the backend marked (explanations.twin), so the shift shows once. */
export function dropTwinShare<T extends { name: string }>(items: T[], evidence: Evidence): T[] {
  return items.filter((d) => d.name !== evidence.explanations.twin);
}

/** The backend's "look here first" ranking (explanations.ranked), as differences. */
export function rankedFindings(evidence: Evidence): Difference[] {
  const byName = new Map(evidence.differences.map((d) => [d.name, d]));
  return evidence.explanations.ranked.map((q) => byName.get(q)).filter((d): d is Difference => !!d);
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

/** GET helper: data starts null and errors surface as a string. Data and errors belong to the inputs that
 *  produced them: after `deps` change, both read null until the new request settles (no stale answers). */
export function useApi<T>(fn: () => Promise<T>, deps: unknown[] = [], { keep = false } = {}) {
  const key = JSON.stringify(deps);
  const [state, setState] = useState<{ key: string; data: T | null; error: string | null; status: number | null }>({
    key: "", data: null, error: null, status: null,
  });
  useEffect(() => {
    let live = true;
    fn().then(
      (value) => live && setState({ key, data: value, error: null, status: null }),
      (err) =>
        live &&
        setState({
          key,
          data: null,
          error: err instanceof Error ? err.message : String(err),
          status: typeof err === "object" && err && "status" in err ? Number((err as { status: unknown }).status) : null,
        }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const current = state.key === key;
  // keep: show the previous answer while a refresh of the same thing loads (no flicker), e.g. after a reload counter
  return {
    data: current || keep ? state.data : null,
    error: current ? state.error : null,
    status: current ? state.status : null,
    loading: !current,
  };
}
