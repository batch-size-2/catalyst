// out/captions.srt from the same timing engine the video uses. Run: node scripts/captions.ts
import fs from "node:fs";
import path from "node:path";
import { buildTimeline, captionPages, toSrt, type AudioJson, type Narration, type Script } from "../src/core.ts";

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
for (const w of tl.warnings) console.warn(`warning: ${w}`);
fs.mkdirSync(path.join(root, "out"), { recursive: true });
fs.writeFileSync(path.join(root, "out/captions.srt"), toSrt(captionPages(tl)));
console.log(`out/captions.srt · ${tl.total.toFixed(2)} s`);
for (const s of tl.scenes) console.log(`  ${s.id.padEnd(9)} ${s.start.toFixed(2)}–${s.end.toFixed(2)} s`);
