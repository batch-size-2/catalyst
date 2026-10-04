// Review tools: render real frames from one bundle and tile them, labelled, into review/check/.
//   node scripts/review.mjs sheet [scene,scene] [--scale=0.4]     first/middle/last of every shot (scene sub-shots split at shot/clip/frame beats)
//   node scripts/review.mjs strip <t0> <t1> [--step=1] [--cols=6] [--scale=0.4]   every frame of a moment
//   node scripts/review.mjs crop <t> <x,y,w,h>                      a full-resolution region
//   node scripts/review.mjs stills <t|scene@frac> ...               full frames
// Times are seconds (or scene@fraction). Output: review/check/*.jpg|png (the .cache is gitignored; review/ isn't).
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { bundle } from "@remotion/bundler";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";

const root = path.resolve(import.meta.dirname, "..");
const outDir = path.join(root, "review/check");
const tmp = path.join(root, ".cache/review", String(process.pid));
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(tmp, { recursive: true });
const args = process.argv.slice(2);
const opt = (k, d) => {
  const a = args.find((x) => x.startsWith(`--${k}=`));
  return a ? a.split("=")[1] : d;
};
const pos = args.filter((a) => !a.startsWith("--"));
const mode = pos[0];
const py = path.resolve(root, "../.venv/bin/python");

const serveUrl = await bundle({
  entryPoint: path.join(root, "src/index.ts"),
  webpackOverride: (c) => ({ ...c, resolve: { ...c.resolve, modules: [path.join(root, "node_modules"), "node_modules"] } }),
});
const browser = await openBrowser("chrome");
const composition = await selectComposition({ serveUrl, id: "Catalyst", inputProps: {}, puppeteerInstance: browser });
const { tl } = composition.props;
const fps = composition.fps;
const toT = (a) => {
  const n = Number(a);
  if (!Number.isNaN(n)) return n;
  const [id, f] = a.split("@");
  const s = tl.scenes.find((x) => x.id === id);
  return s ? s.start + (s.end - s.start) * Number(f ?? 0) : 0;
};
const sceneAt = (t) => tl.scenes.find((s) => t >= s.start && t < s.end)?.id ?? "";
const fmt = (t) => `${t.toFixed(2)}s f${Math.round(t * fps)}`;

async function still(t, scale, file) {
  const frame = Math.max(0, Math.min(composition.durationInFrames - 1, Math.round(t * fps)));
  await renderStill({ serveUrl, composition, frame, output: file, inputProps: composition.props, scale, ...(file.endsWith(".png") ? { imageFormat: "png" } : { imageFormat: "jpeg", jpegQuality: 88 }), puppeteerInstance: browser });
  return file;
}
// labelled grid via PIL
function tile(items, cols, out, title) {
  const spec = path.join(tmp, "tile.json");
  fs.writeFileSync(spec, JSON.stringify({ items, cols, out, title }));
  execFileSync(py, ["-c", `
import json,sys
from PIL import Image, ImageDraw, ImageFont
s=json.load(open(sys.argv[1]))
ims=[Image.open(i["file"]).convert("RGB") for i in s["items"]]
w,h=ims[0].size; cols=s["cols"]; rows=(len(ims)+cols-1)//cols; lab=26; head=40
sheet=Image.new("RGB",(cols*(w+8)+8, head+rows*(h+lab+8)+8),(10,11,13))
d=ImageDraw.Draw(sheet)
try: f=ImageFont.truetype("/System/Library/Fonts/Menlo.ttc",15); F=ImageFont.truetype("/System/Library/Fonts/Menlo.ttc",20)
except Exception: f=F=ImageFont.load_default()
d.text((10,8),s["title"],fill=(237,236,232),font=F)
for k,(im,it) in enumerate(zip(ims,s["items"])):
  x=8+(k%cols)*(w+8); y=head+(k//cols)*(h+lab+8)
  sheet.paste(im,(x,y)); d.text((x+2,y+h+4),it["label"],fill=(196,197,201),font=f)
sheet.save(s["out"],quality=86)
`, spec]);
  console.log(path.relative(root, out));
}

if (mode === "sheet") {
  const only = pos[1] ? pos[1].split(",") : null;
  const scale = Number(opt("scale", 0.32));
  const items = [];
  for (const s of tl.scenes) {
    if (only && !only.includes(s.id)) continue;
    // sub-shots: split the scene at beats that change the shot/clip/frame or the hero
    const cuts = [s.start, ...s.beats.filter((b) => b.shot || b.clip || b.frame || b.hero || b.fx).map((b) => b.t), s.end].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b);
    const segs = [];
    for (let i = 0; i < cuts.length - 1; i++) if (cuts[i + 1] - cuts[i] > 0.6) segs.push([cuts[i], cuts[i + 1]]);
    const pts = [];
    for (const [a, b] of segs) pts.push(a + 0.1, (a + b) / 2, b - 0.1);
    const uniq = pts.filter((v, i) => i === 0 || v - pts[i - 1] > 0.25);
    for (const t of uniq) items.push({ file: await still(t, scale, path.join(tmp, `s_${t.toFixed(2)}.jpg`)), label: `${s.id} ${fmt(t)}` });
  }
  tile(items, Number(opt("cols", 6)), path.join(outDir, `sheet${only ? "_" + only.join("-") : ""}.jpg`), `sheet · ${tl.total.toFixed(2)} s`);
} else if (mode === "strip") {
  const t0 = toT(pos[1]), t1 = toT(pos[2] ?? String(t0 + 0.5));
  const step = Number(opt("step", 1));
  const scale = Number(opt("scale", 0.3));
  const items = [];
  for (let f = Math.round(t0 * fps); f <= Math.round(t1 * fps); f += step) {
    const t = f / fps;
    items.push({ file: await still(t, scale, path.join(tmp, `f_${f}.jpg`)), label: `${sceneAt(t)} ${fmt(t)}` });
  }
  tile(items, Number(opt("cols", 6)), path.join(outDir, `strip_${t0.toFixed(2)}-${t1.toFixed(2)}.jpg`), `strip ${fmt(t0)} → ${fmt(t1)} step ${step}`);
} else if (mode === "crop") {
  const t = toT(pos[1]);
  const [x, y, w, h] = (pos[2] ?? "0,0,1920,1080").split(",").map(Number);
  const full = await still(t, 1, path.join(tmp, `c_${t.toFixed(2)}.png`));
  const out = path.join(outDir, `crop_${t.toFixed(2)}_${x}_${y}.png`);
  execFileSync(py, ["-c", `from PIL import Image;import sys;Image.open(sys.argv[1]).crop((${x},${y},${x + w},${y + h})).save(sys.argv[2])`, full, out]);
  console.log(path.relative(root, out));
} else if (mode === "stills") {
  for (const a of pos.slice(1)) {
    const t = toT(a);
    const out = path.join(outDir, `still_${t.toFixed(2)}.jpg`);
    await still(t, Number(opt("scale", 0.5)), out);
    console.log(`${a} -> ${fmt(t)} ${path.relative(root, out)}`);
  }
} else {
  for (const s of tl.scenes) console.log(`${s.id.padEnd(9)} ${s.start.toFixed(2)}–${s.end.toFixed(2)}  (${(s.end - s.start).toFixed(2)} s)`);
  console.log(`total ${tl.total.toFixed(2)} s`, tl.warnings);
}
await browser.close({ silent: true });
fs.rmSync(tmp, { recursive: true, force: true });
