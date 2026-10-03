// Regenerates the static cat SVGs and the live preview from assets/cat/Cat.tsx.
// Needs the web app's dependencies: `cd web && npm install`, then from the repo root:
//   node assets/build.mjs
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const webModules = resolve(here, "../web/node_modules");
const { rolldown } = await import(pathToFileURL(createRequire(join(webModules, "x.js")).resolve("rolldown")).href);
const tmp = join(here, ".build");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp);

const EXPRESSIONS = ["happy", "curious", "surprised", "proud", "shrug"];
const POSES = ["float", "hold", "point", "wave", "shrug", "stamp"];

async function bundle(name, source, format) {
  const entry = join(tmp, `${name}.tsx`);
  writeFileSync(entry, source);
  const build = await rolldown({
    input: entry,
    resolve: { modules: [webModules, "node_modules"] },
    transform: { define: { "process.env.NODE_ENV": '"production"' } },
    platform: format === "esm" ? "node" : "browser",
  });
  const file = join(tmp, `${name}.${format === "esm" ? "mjs" : "js"}`);
  await build.write({ file, format, minify: format !== "esm" });
  return file;
}

// 1. Static SVGs (idle off, so they are clean stills)
const server = await bundle("server", `
import { renderToStaticMarkup } from "react-dom/server";
import { Cat } from "../cat/Cat";
export const render = (props) => renderToStaticMarkup(<Cat idle={false} size={320} {...props} />);
`, "esm");
const { render } = await import(pathToFileURL(server).href);
const out = join(here, "cat", "svg");
mkdirSync(out, { recursive: true });
writeFileSync(join(here, "cat", "catalyst.svg"), render({}));
for (const e of EXPRESSIONS) writeFileSync(join(out, `expression-${e}.svg`), render({ expression: e }));
for (const p of POSES) writeFileSync(join(out, `pose-${p}.svg`), render({ pose: p }));

// 2. Live preview: every expression and pose, animated
const client = await bundle("client", `
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Cat } from "../cat/Cat";
const EXPRESSIONS = ${JSON.stringify(EXPRESSIONS)};
const POSES = ${JSON.stringify(POSES)};
function App() {
  const [t, setT] = useState(0);
  useEffect(() => {
    let raf, start = performance.now();
    const tick = (now) => { setT((now - start) / 1000); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const card = (label, props) => (
    <figure key={label}><Cat t={t + label.length} size={200} {...props} /><figcaption>{label}</figcaption></figure>
  );
  return (<>
    <h2>Expressions</h2><div className="grid">{EXPRESSIONS.map((e) => card(e, { expression: e }))}</div>
    <h2>Poses</h2><div className="grid">{POSES.map((p) => card(p, { pose: p, expression: p === "shrug" ? "shrug" : "happy" }))}</div>
    <h2>Looking around</h2><div className="grid">{card("lookAt follows t", { expression: "curious", lookAt: [Math.sin(t), Math.cos(t * 0.7) * 0.6] })}</div>
  </>);
}
createRoot(document.getElementById("root")).render(<App />);
`, "iife");
const logo = readFileSync(join(here, "logo", "catalyst-logo.svg"), "utf8");
writeFileSync(join(here, "cat", "preview.html"), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Catalyst the cat</title>
<style>
body{margin:0;padding:24px 16px 48px;background:linear-gradient(160deg,#F6F1FF,#EAF6F5);color:#2B2D42;
font-family:ui-rounded,"SF Pro Rounded","Nunito",system-ui,sans-serif}
header{display:flex;align-items:center;gap:16px;flex-wrap:wrap}header svg{height:56px;width:auto}
h2{font-size:15px;letter-spacing:.08em;text-transform:uppercase;opacity:.6;margin:32px 0 8px}
.grid{display:flex;flex-wrap:wrap;gap:12px}
figure{margin:0;background:#ffffffaa;border-radius:20px;padding:12px 12px 8px;text-align:center}
figcaption{font-size:14px;opacity:.7}
</style></head><body>
<header>${logo}<p>Mascot preview. Source: <code>assets/cat/Cat.tsx</code></p></header>
<div id="root"></div>
<script>${readFileSync(client, "utf8")}</script>
</body></html>
`);
rmSync(tmp, { recursive: true, force: true });
console.log("wrote assets/cat/catalyst.svg, assets/cat/svg/*.svg, assets/cat/preview.html");
