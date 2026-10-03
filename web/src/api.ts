import type { BatchSummary, Config, Evidence, RunEvent } from "./types";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

const enc = encodeURIComponent;

export const getConfig = () => getJson<Config>("/api/config");
export const listBatches = () => getJson<BatchSummary[]>("/api/batches");
export const getEvidence = (batch: string) => getJson<Evidence>(`/api/evidence/${enc(batch)}`);
export const previewUrl = (batch: string, imageId: string) => `/api/previews/${enc(batch)}/${enc(imageId)}.png`;

export async function uploadBatch(batch: string, files: File[]) {
  const body = new FormData();
  files.forEach((file) => body.append("files", file));
  const res = await fetch(`/api/batches/${enc(batch)}/files`, { method: "POST", body });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
}

export async function runBatch(batch: string, onEvent: (event: RunEvent) => void) {
  const res = await fetch(`/api/runs/${enc(batch)}`, { method: "POST" });
  if (!res.ok || !res.body) throw new Error(`${res.status}: ${await res.text()}`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    const lines = (buffer + value).split("\n");
    buffer = lines.pop() ?? "";
    lines.filter(Boolean).forEach((line) => onEvent(JSON.parse(line)));
  }
}
