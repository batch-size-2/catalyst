// The timing engine: narration + per-word audio timings + script beats -> one global timeline.
// Pure functions with no imports, so Node scripts (captions.srt) and the Remotion bundle share it.

export type AudioJson = { id: string; text: string; duration: number; words: { text: string; start: number; end: number }[] };
export type Narration = { voice: { gap_seconds: number }; scenes: { id: string; text: string }[] };

export type CatBeat = {
  anchor?: string;
  expression?: string;
  pose?: string;
  item?: string;
  goggles?: string;
  lookAt?: string | null;
};

export type BeatSpec = {
  at?: string;
  offset?: number;
  shot?: string;
  state?: string;
  url?: string;
  scrollTo?: number;
  highlight?: string | null;
  zoom?: number;
  push?: number;
  cursor?: string;
  cat?: CatBeat;
  callout?: string | null;
  calloutFor?: number;
  bg?: string;
  sfx?: string;
  fx?: string;
  dur?: number;
  window?: "in" | "out";
};

export type SceneSpec = { lead?: number; hold?: number; beats: BeatSpec[]; [k: string]: unknown };
export type Script = {
  music?: { file: string; volume: number; fadeIn?: number; fadeOut?: number };
  sfxMix: Record<string, number>;
  scenes: Record<string, SceneSpec>;
};

export type Word = { text: string; start: number; end: number; scene: string };
export type Beat = BeatSpec & { t: number; scene: string };
export type SceneT = {
  id: string;
  start: number;
  end: number;
  voiceStart: number;
  audio: string | null;
  estimated: boolean;
  words: Word[];
  beats: Beat[];
  spec: SceneSpec;
};
export type Timeline = { scenes: SceneT[]; beats: Beat[]; words: Word[]; total: number; warnings: string[] };

const TAG = /\[[^\]]*\]/g;
export const norm = (s: string) => s.replace(TAG, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
export const display = (s: string) => s.replace(TAG, "").trim();

export function buildTimeline(
  narration: Narration,
  script: Script,
  audio: Record<string, AudioJson | null>,
  hasMp3: Record<string, boolean>,
): Timeline {
  const warnings: string[] = [];
  const gap = narration.voice.gap_seconds;
  const scenes: SceneT[] = [];
  let t0 = 0;
  for (const { id, text } of narration.scenes) {
    const spec = script.scenes[id] ?? { beats: [] };
    const a = audio[id];
    let raw: { text: string; start: number; end: number }[];
    let duration: number;
    let estimated = false;
    if (a && a.text === text && a.words?.length) {
      raw = a.words;
      duration = a.duration;
    } else {
      estimated = true;
      warnings.push(a ? `${id}: audio text differs from narration.json, estimating timings` : `${id}: no audio JSON, estimating timings`);
      raw = text.split(/\s+/).filter((w) => display(w) !== "").map((w, i) => ({ text: w, start: i * 0.4, end: i * 0.4 + 0.36 }));
      duration = raw.length * 0.4;
    }
    const lead = spec.lead ?? 0;
    const voiceStart = t0 + lead;
    const words = raw
      .filter((w) => display(w.text) !== "")
      .map((w) => ({ text: display(w.text), start: voiceStart + w.start, end: voiceStart + w.end, scene: id }));
    const end = voiceStart + duration + gap + (spec.hold ?? 0);
    const audioSrc = !estimated && hasMp3[id] ? `audio/${id}.mp3` : null;
    if (!estimated && !hasMp3[id]) warnings.push(`${id}: no mp3, rendering captions only`);

    const beats: Beat[] = [];
    let cursor = 0;
    let lastT = t0;
    for (const b of spec.beats) {
      let t = lastT;
      if (b.at) {
        const want = b.at.split(/\s+/).map(norm).filter(Boolean);
        let found = -1;
        for (let i = cursor; i <= words.length - want.length && found < 0; i++) {
          if (want.every((w, k) => norm(words[i + k].text) === w)) found = i;
        }
        if (found < 0) warnings.push(`${id}: beat word "${b.at}" not found after word ${cursor}`);
        else {
          cursor = found;
          t = words[found].start;
        }
      }
      t = Math.max(t0, t + (b.offset ?? 0));
      lastT = t;
      beats.push({ ...b, t, scene: id });
    }
    scenes.push({ id, start: t0, end, voiceStart, audio: audioSrc, estimated, words, beats, spec });
    t0 = end;
  }
  return { scenes, beats: scenes.flatMap((s) => s.beats), words: scenes.flatMap((s) => s.words), total: t0, warnings };
}

const WEAK = new Set(["the", "a", "an", "to", "of", "in", "and", "or", "for", "with", "it", "its", "so", "if", "i", "is", "my", "at", "by"]);

// Caption pages: up to 8 words, broken after punctuation where possible, never across scenes.
export type Page = { words: Word[]; start: number; end: number };
export function captionPages(tl: Timeline, max = 8): Page[] {
  const pages: Page[] = [];
  const push = (ws: Word[]) => ws.length && pages.push({ words: ws, start: ws[0].start, end: ws[ws.length - 1].end });
  for (const s of tl.scenes) {
    // sentences first, then long sentences into balanced chunks, preferring to break after a comma
    const sentences: Word[][] = [[]];
    s.words.forEach((w, i) => {
      sentences[sentences.length - 1].push(w);
      if (/[.!?:]$/.test(w.text) && i < s.words.length - 1) sentences.push([]);
    });
    for (const sen of sentences) {
      let rest = sen;
      while (rest.length > max) {
        const k = Math.ceil(rest.length / max);
        const len = (ws: Word[]) => ws.reduce((n, w) => n + w.text.length + 1, 0);
        const ideal = len(rest) / k;
        let cut = Math.round(rest.length / k);
        let best = Infinity;
        for (let c = 3; c <= Math.min(max, rest.length - 3); c++) {
          const a = rest[c - 1].text, b = rest[c].text;
          const cost =
            Math.abs(len(rest.slice(0, c)) - ideal) / 6 +
            (/[,;]$/.test(a) ? -5 : 0) +
            (/^[A-Z]/.test(a) && /^[A-Z]/.test(b) ? 4 : 0) + // keep names together ("Chevy Bolt")
            (WEAK.has(norm(a)) ? 3 : 0); // don't end a line on "the", "a", "to"...
          if (cost < best) [best, cut] = [cost, c];
        }
        push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      push(rest);
    }
  }
  pages.forEach((p, i) => {
    const next = pages[i + 1];
    const hold = p.end + 0.7;
    p.end = next && next.start - 0.1 < hold ? Math.max(p.end, next.start - 0.1) : hold;
  });
  return pages;
}

export function toSrt(pages: Page[]): string {
  const ts = (s: number) => {
    const ms = Math.round(s * 1000);
    const p = (n: number, d = 2) => String(n).padStart(d, "0");
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
  };
  return pages.map((p, i) => `${i + 1}\n${ts(p.start)} --> ${ts(p.end)}\n${p.words.map((w) => w.text).join(" ")}\n`).join("\n");
}
