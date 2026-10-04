// Strips from the last full render (fast: no re-rendering). Every frame (or every --step-th) of [t0, t1],
// labelled with time and frame, tiled into review/check/vstrip_<t0>-<t1>.jpg.
//   node scripts/vstrip.mjs <t0> <t1> [--step=1] [--cols=6] [--w=480] [--src=out/catalyst.mp4] [--crop=x,y,w,h]
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=")[1];
const [t0, t1] = args.filter((a) => !a.startsWith("--")).map(Number);
const step = Number(opt("step", 1)), cols = Number(opt("cols", 6)), w = Number(opt("w", 480));
const src = path.join(root, opt("src", "out/catalyst.mp4"));
const crop = opt("crop", "");
const tmp = path.join(root, ".cache/vstrip", String(process.pid));
fs.mkdirSync(tmp, { recursive: true });
const vf = [crop ? `crop=${crop.split(",").join(":")}` : null, `select='not(mod(n-${Math.round(t0 * 30)}\\,${step}))'`, `scale=${w}:-1`].filter(Boolean).join(",");
execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-ss", String(t0), "-i", src, "-t", String(t1 - t0 + 0.001), "-vf", crop ? `crop=${crop.split(",").join(":")},scale=${w}:-1` : `scale=${w}:-1`, "-vsync", "0", path.join(tmp, "f_%04d.jpg")]);
void vf;
const files = fs.readdirSync(tmp).filter((f) => f.endsWith(".jpg")).sort().filter((_, i) => i % step === 0);
const items = files.map((f, i) => {
  const fr = Math.round(t0 * 30) + i * step;
  return { file: path.join(tmp, f), label: `${(fr / 30).toFixed(2)}s f${fr}` };
});
const out = path.join(root, "review/check", `vstrip_${t0.toFixed(2)}-${t1.toFixed(2)}${crop ? "_crop" : ""}.jpg`);
const spec = path.join(tmp, "spec.json");
fs.writeFileSync(spec, JSON.stringify({ items, cols, out, title: `${path.basename(src)} ${t0}→${t1} step ${step}` }));
execFileSync(path.resolve(root, "../.venv/bin/python"), ["-c", `
import json,sys
from PIL import Image, ImageDraw, ImageFont
s=json.load(open(sys.argv[1]))
ims=[Image.open(i["file"]).convert("RGB") for i in s["items"]]
w,h=ims[0].size; cols=s["cols"]; rows=(len(ims)+cols-1)//cols; lab=24; head=34
sheet=Image.new("RGB",(cols*(w+6)+6, head+rows*(h+lab+6)+6),(10,11,13))
d=ImageDraw.Draw(sheet)
try: f=ImageFont.truetype("/System/Library/Fonts/Menlo.ttc",14); F=ImageFont.truetype("/System/Library/Fonts/Menlo.ttc",18)
except Exception: f=F=ImageFont.load_default()
d.text((8,8),s["title"],fill=(237,236,232),font=F)
for k,(im,it) in enumerate(zip(ims,s["items"])):
  x=6+(k%cols)*(w+6); y=head+(k//cols)*(h+lab+6)
  sheet.paste(im,(x,y)); d.text((x+2,y+h+3),it["label"],fill=(196,197,201),font=f)
sheet.save(s["out"],quality=85)
`, spec]);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(path.relative(root, out));
