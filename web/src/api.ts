import type {
  Attribution, AttributionEvaluation, AttributionEvent, BatchSummary, Config, Evidence,
  KpiDictionary, RunEvent, Tile, VerifyResult,
} from "./types";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

const enc = encodeURIComponent;

export const getConfig = () => getJson<Config>("/api/config");
export const listBatches = () => getJson<BatchSummary[]>("/api/batches");
export const getEvidence = (batch: string) => getJson<Evidence>(`/api/evidence/${enc(batch)}`);
export const listAttributions = () => getJson<string[]>("/api/attribution");
export const getAttribution = (name: string) => getJson<Attribution>(`/api/attribution/${enc(name)}`);
export const getAttributionEvaluation = () =>
  getJson<AttributionEvaluation>("/api/attribution-evaluation");
export const getTiles = () => getJson<Tile[]>("/api/tiles");
export const getKpiDictionary = () => getJson<KpiDictionary>("/api/kpis");

export const maskUrl = (batch: string, imageId: string) =>
  `/api/masks/${enc(batch)}/${enc(imageId)}.png`;
export const imageUrl = (batch: string, imageId: string, detector: string, size = 512) =>
  `/api/images/${enc(batch)}/${enc(imageId)}/${enc(detector)}?size=${size}`;

export async function uploadBatch(batch: string, files: File[]) {
  const body = new FormData();
  files.forEach((file) => body.append("files", file));
  const res = await fetch(`/api/batches/${enc(batch)}/files`, { method: "POST", body });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
}

export async function verifyBatch(batch: string): Promise<VerifyResult> {
  const res = await fetch(`/api/verify/${enc(batch)}`, { method: "POST" });
  if (!res.ok) throw new Error(await responseError(res));
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

async function streamNdjson<T>(url: string, onEvent: (event: T) => void) {
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

export const runBatch = (batch: string, onEvent: (event: RunEvent) => void) =>
  streamNdjson(`/api/runs/${enc(batch)}`, onEvent);

export const runAttribution = (name: string, balanced: number | null, onEvent: (event: AttributionEvent) => void) => {
  const query = balanced == null ? "" : `?balanced=${enc(balanced)}`;
  return streamNdjson(`/api/attribution/${enc(name)}${query}`, onEvent);
};
