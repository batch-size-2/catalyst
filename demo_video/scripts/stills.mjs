// Render review stills from one bundle: node scripts/stills.mjs 3.2 news@0.5 compare@0 ...
// A bare number is seconds; <scene>@<fraction> is a point inside that scene. Output: .cache/stills/
import path from "node:path";
import fs from "node:fs";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, ".cache/stills");
fs.mkdirSync(out, { recursive: true });
const serveUrl = await bundle({
  entryPoint: path.join(root, "src/index.ts"),
  webpackOverride: (c) => ({ ...c, resolve: { ...c.resolve, modules: [path.join(root, "node_modules"), "node_modules"] } }),
});
const composition = await selectComposition({ serveUrl, id: "Catalyst", inputProps: {} });
const { tl } = composition.props;
const fps = composition.fps;
for (const arg of process.argv.slice(2)) {
  let t = Number(arg);
  if (Number.isNaN(t)) {
    const [id, f] = arg.split("@");
    const s = tl.scenes.find((x) => x.id === id);
    if (!s) { console.warn(`no scene ${id}`); continue; }
    t = s.start + (s.end - s.start) * Number(f ?? 0);
  }
  const frame = Math.min(composition.durationInFrames - 1, Math.round(t * fps));
  const file = path.join(out, `${arg.replace(/[^\w.@-]/g, "_")}.png`);
  await renderStill({ serveUrl, composition, frame, output: file, inputProps: composition.props });
  console.log(`${arg} -> t=${(frame / fps).toFixed(2)}s ${path.relative(root, file)}`);
}
if (process.argv.includes("--timeline") || process.argv.length <= 2) {
  for (const s of tl.scenes) console.log(`${s.id.padEnd(9)} ${s.start.toFixed(2)}–${s.end.toFixed(2)}  (${(s.end - s.start).toFixed(2)} s)`);
  console.log(`total ${tl.total.toFixed(2)} s`, tl.warnings);
}
