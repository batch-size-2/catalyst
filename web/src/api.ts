import type {
  Attribution, AttributionEvaluation, AttributionEvent, BatchSummary, Config, Decision, Evidence, Guide, Health,
  KpiDictionary, MeasureEvent, ModelStatus, RunEvent, Settings, Tile, TileParticles, VerifyResult,
} from "./types";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new ApiError(res.status, await responseError(res));
  return res.json();
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const enc = encodeURIComponent;
const withBaseline = (baseline?: string | null) => (baseline ? `?baseline=${enc(baseline)}` : "");

export const getHealth = () => getJson<Health>("/api/health");
export const getConfig = () => getJson<Config>("/api/config");
export const getSettings = () => getJson<Settings>("/api/settings");
export const listBatches = () => getJson<BatchSummary[]>("/api/batches");
export const listDecisions = () => getJson<Decision[]>("/api/evidence");
/** One comparison; `baseline` omitted = the default baseline. */
export const getEvidence = (batch: string, baseline?: string | null) =>
  getJson<Evidence>(`/api/evidence/${enc(batch)}${withBaseline(baseline)}`);
/** Free: the fixed template, or with source=claude Claude's cached version (else the template + fallback_reason). */
export const getGuide = (batch: string, baseline: string | null, source: "claude" | "template") =>
  getJson<Guide>(`/api/guide/${enc(batch)}${withBaseline(baseline)}${baseline ? "&" : "?"}source=${source}`);

/** Ask Claude to write the summary and walkthrough: a paid call, cached per evidence. */
export async function askClaude(batch: string, baseline: string | null): Promise<Guide> {
  const res = await fetch(`/api/guide/${enc(batch)}${withBaseline(baseline)}`, { method: "POST" });
  if (!res.ok) throw new ApiError(res.status, await responseError(res));
  return res.json();
}

export const getParticles = (batch: string, imageId: string, top = 8) =>
  getJson<TileParticles>(`/api/particles/${enc(batch)}/${enc(imageId)}?top=${top}`);
export const listAttributions = () => getJson<string[]>("/api/attribution");
export const getAttribution = (name: string) => getJson<Attribution>(`/api/attribution/${enc(name)}`);
export const getAttributionEvaluation = () =>
  getJson<AttributionEvaluation>("/api/attribution-evaluation");
export const getModelStatus = () => getJson<ModelStatus>("/api/attribution-model");
export const getTiles = () => getJson<Tile[]>("/api/tiles");
export const getKpiDictionary = () => getJson<KpiDictionary>("/api/kpis");

export const maskUrl = (batch: string, imageId: string) =>
  `/api/masks/${enc(batch)}/${enc(imageId)}.png`;
export const layerUrl = (batch: string, imageId: string, layer: "silicon" | "pore" | "binder") =>
  `/api/layers/${enc(batch)}/${enc(imageId)}/${layer}`;
export const imageUrl = (batch: string, imageId: string, detector: string, size = 512) =>
  `/api/images/${enc(batch)}/${enc(imageId)}/${enc(detector)}?size=${size}`;

export async function uploadBatch(batch: string, files: File[]) {
  const body = new FormData();
  files.forEach((file) => body.append("files", file));
  const res = await fetch(`/api/batches/${enc(batch)}/files`, { method: "POST", body });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
}

export async function verifyBatch(batch: string, baseline: string): Promise<VerifyResult> {
  const res = await fetch(`/api/verify/${enc(batch)}${withBaseline(baseline)}`, { method: "POST" });
  if (!res.ok) throw new Error(await responseError(res));
  return res.json();
}

/** Writes the default baseline to config/decision.yaml; fails with 409 once rules are frozen. */
export async function setDefaultBaseline(baseline: string): Promise<{ baseline: string }> {
  const res = await fetch("/api/settings/baseline", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ baseline }),
  });
  if (!res.ok) throw new ApiError(res.status, await responseError(res));
  return res.json();
}

async function responseError(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const body = JSON.parse(text);
    if (body && "detail" in body) return typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
  } catch {
    return text;
  }
  return text;
}

async function streamNdjson<T extends { type: string }>(url: string, onEvent: (event: T) => void) {
  const res = await fetch(url, { method: "POST" });
  if (!res.ok) throw new Error(await responseError(res));
  if (!res.body) throw new Error("empty NDJSON response");
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) {
      if (buffer.trim()) onEvent(JSON.parse(buffer) as T);
      return;
    }
    const lines = (buffer + value).split("\n");
    buffer = lines.pop() ?? "";
    lines.filter(Boolean).forEach((line) => onEvent(JSON.parse(line) as T));
  }
}

/** Measure a batch and compare it; `baseline` runs a one-off comparison without changing the default. */
export const runBatch = (batch: string, baseline: string | null, onEvent: (event: RunEvent) => void) =>
  streamNdjson(`/api/runs/${enc(batch)}${withBaseline(baseline)}`, onEvent);

export const measureFolder = (batch: string, onEvent: (event: MeasureEvent) => void) =>
  streamNdjson(`/api/measure/${enc(batch)}`, onEvent);

export const runAttribution = (name: string, balanced: number | null, onEvent: (event: AttributionEvent) => void) => {
  const query = balanced == null ? "" : `?balanced=${enc(balanced)}`;
  return streamNdjson(`/api/attribution/${enc(name)}${query}`, onEvent);
};
