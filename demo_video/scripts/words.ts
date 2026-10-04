// Print the global timeline: scenes, every word with its time and frame, and every beat.
// Run: node scripts/words.ts [scene ...]   (handy when keying beats in script.json)
import fs from "node:fs";
import path from "node:path";
import { buildTimeline, type AudioJson, type Narration, type Script } from "../src/core.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (p: string) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const narration = read("narration.json") as Narration;
const script = read("script.json") as Script;
const audio: Record<string, AudioJson | null> = {};
const mp3: Record<string, boolean> = {};
for (const { id } of narration.scenes) {
  const j = `public/audio/${id}.json`;
  audio[id] = fs.existsSync(path.join(root, j)) ? (read(j) as AudioJson) : null;
  mp3[id] = fs.existsSync(path.join(root, `public/audio/${id}.mp3`));
}
const tl = buildTimeline(narration, script, audio, mp3);
const only = process.argv.slice(2);
const f = (s: number) => `${s.toFixed(2).padStart(6)}s f${String(Math.round(s * 30)).padStart(4)}`;
for (const s of tl.scenes) {
  if (only.length && !only.includes(s.id)) continue;
  console.log(`\n## ${s.id}  ${s.start.toFixed(2)}–${s.end.toFixed(2)} (${(s.end - s.start).toFixed(2)} s), voice at ${s.voiceStart.toFixed(2)}`);
  console.log(s.words.map((w) => `${w.text}@${(w.start - s.start).toFixed(2)}`).join(" "));
  for (const b of s.beats) {
    const { t, scene, ...rest } = b;
    console.log(`  beat ${f(t)} (+${(t - s.start).toFixed(2)})  ${JSON.stringify(rest)}`);
  }
}
console.log(`\ntotal ${tl.total.toFixed(2)} s`, tl.warnings.length ? tl.warnings : "");
