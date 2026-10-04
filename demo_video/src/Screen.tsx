// The app inside the window: captured screens from public/screens/manifest.json (falling back to
// standins.json, then a placeholder card), seen through one camera (scroll + zoom over a virtual
// 1400x780 screen = fixed sidebar + scrolling page), with a moving spotlight, a self-drawing outline,
// the cursor, cross-fades on clicks and real clips.
import { Freeze, Img, OffthreadVideo, staticFile } from "remotion";
import type { Timeline } from "./core";
import {
  clamp01, cursorAt, docToV, hlOf, hlToScreen, inOut, lerp, prog, screenAt, sidebarW, sp, VH, VW,
  type Cam, type Layer, type Mark,
} from "./state";
import { C, FPS, MONO, SPRING, glass } from "./theme";

function Placeholder({ name }: { name: string }) {
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: VW, height: VH, display: "flex", alignItems: "center", justifyContent: "center", background: C.bg }}>
      <div style={{ ...glass, borderRadius: 22, padding: "28px 40px", font: `500 18px ${MONO}`, color: C.muted }}>missing screen · {name}</div>
    </div>
  );
}

function clipFrame(layer: Layer, t: number) {
  const fps = layer.shot?.fps ?? FPS;
  const n = layer.shot?.frames ?? 1;
  return Math.max(0, Math.min(n - 1, Math.round((layer.from + Math.max(0, t - layer.t0) * layer.rate) * fps)));
}

// One screen state: its image (or clip) at the camera's scroll, the page under viewport states, the fixed sidebar.
function LayerView({ tl, layer, cam, t, opacity, dy, assets }: { tl: Timeline; layer: Layer; cam: Cam; t: number; opacity: number; dy: number; assets: Record<string, boolean> }) {
  const shot = layer.shot;
  if (!shot) return <div style={{ opacity }}><Placeholder name={layer.name} /></div>;
  const sw = sidebarW(tl);
  const abs = { position: "absolute" as const, left: 0 };
  const page = (s: typeof shot) => <Img src={staticFile(s.file)} style={{ ...abs, top: -cam.scroll, width: s.w, height: s.h }} />;
  const side = layer.base?.vp ?? shot.vp ?? (shot.kind === "viewport" ? shot.file : null);
  return (
    <div
      style={{
        position: "absolute", left: 0, top: 0, width: VW, height: VH, opacity, transformOrigin: "0 0",
        transform: `scale(${cam.s}) translate(${-cam.vx}px, ${-cam.vy + dy}px)`,
      }}
    >
      {shot.kind !== "page" && layer.base ? page(layer.base) : null}
      {shot.kind === "page" ? page(shot) : null}
      {shot.kind === "viewport" ? <Img src={staticFile(shot.file)} style={{ ...abs, top: shot.scrollY - cam.scroll, width: VW, height: VH }} /> : null}
      {shot.kind === "clip" && assets[shot.file] !== false ? (
        <div style={{ ...abs, top: shot.scrollY - cam.scroll, width: VW, height: VH }}>
          <Freeze frame={clipFrame(layer, t)}>
            <OffthreadVideo src={staticFile(shot.file)} muted style={{ width: VW, height: VH }} />
          </Freeze>
        </div>
      ) : null}
      {side && shot.kind !== "clip" ? (
        <div style={{ ...abs, top: 0, width: sw, height: VH, overflow: "hidden" }}>
          <Img src={staticFile(side)} style={{ ...abs, top: 0, width: VW, height: VH }} />
        </div>
      ) : null}
    </div>
  );
}

// ---------- spotlight: the dim glides between marks, the outline draws itself on each ----------
type R = { x: number; y: number; w: number; h: number };
function markRect(tl: Timeline, t: number, m: Mark, cam: Cam): R | null {
  const b = hlOf(tl, t, m.id);
  if (!b) return null;
  const [x, y] = docToV(cam, b.x, b.y);
  const pad = 7;
  return { x: x - pad, y: y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
}
function Spotlight({ tl, t, cam, spots, liftDim }: { tl: Timeline; t: number; cam: Cam; spots: Mark[]; liftDim: number }) {
  const live = spots.filter((m) => t < m.out);
  const cur = live[live.length - 1];
  const prev = cur ? spots.find((m) => m !== cur && Math.abs(m.out - cur.t0) < 0.02) : undefined;
  const ending = !cur ? spots[spots.length - 1] : undefined;
  let rect: R | null = null;
  let dim = 0;
  let outline: { r: R; draw: number; a: number } | null = null;
  if (cur) {
    const r1 = markRect(tl, t, cur, cam);
    const r0 = prev ? markRect(tl, t, prev, cam) : null;
    const p = sp(t, cur.t0, SPRING);
    rect = r1 && r0 ? { x: lerp(r0.x, r1.x, p), y: lerp(r0.y, r1.y, p), w: lerp(r0.w, r1.w, p), h: lerp(r0.h, r1.h, p) } : r1;
    dim = prev ? 1 : clamp01(sp(t, cur.t0, SPRING) * 1.2);
    if (r1) outline = { r: rect!, draw: prog(t, cur.t0 + (prev ? 0.12 : 0.05), 0.5, inOut), a: 1 };
  } else if (ending) {
    rect = markRect(tl, t, ending, cam);
    const a = 1 - prog(t, ending.out, 0.4);
    dim = a;
    if (rect) outline = { r: rect, draw: 1, a };
  }
  const total = Math.max(dim * 0.58, liftDim * 0.55);
  if (total < 0.005) return null;
  const sw = 2.6 / cam.s;
  return (
    <svg width={VW} height={VH} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
      <defs>
        <mask id="spotcut">
          <rect x={-2000} y={-2000} width={VW + 4000} height={VH + 4000} fill="#fff" />
          {rect && dim > 0.005 && liftDim < 0.5 ? <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={14} fill="#000" /> : null}
        </mask>
        <filter id="outglow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation={5 / cam.s} />
        </filter>
      </defs>
      <rect x={-2000} y={-2000} width={VW + 4000} height={VH + 4000} fill="rgba(6,7,9,1)" opacity={total} mask="url(#spotcut)" />
      {outline && liftDim < 0.5 ? (
        <g opacity={outline.a}>
          <rect x={outline.r.x} y={outline.r.y} width={outline.r.w} height={outline.r.h} rx={14} fill="none" stroke={C.orange} strokeWidth={sw * 2.4} opacity={0.5} filter="url(#outglow)" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - outline.draw} />
          <rect x={outline.r.x} y={outline.r.y} width={outline.r.w} height={outline.r.h} rx={14} fill="none" stroke={C.orange} strokeWidth={sw} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - outline.draw} strokeLinecap="round" />
        </g>
      ) : null}
    </svg>
  );
}

// ---------- the macOS pointer ----------
function Cursor({ tl, t, cam }: { tl: Timeline; t: number; cam: Cam }) {
  const c = cursorAt(tl, t);
  if (!c || c.opacity <= 0.01) return null;
  const k = 1 / Math.sqrt(cam.s); // grows a little with the zoom, not fully
  return (
    <>
      {c.ripple >= 0 ? (
        <div
          style={{
            position: "absolute", left: c.x, top: c.y, width: 0, height: 0,
          }}
        >
          <div style={{ position: "absolute", left: -(8 + 34 * c.ripple) * k, top: -(8 + 34 * c.ripple) * k, width: (16 + 68 * c.ripple) * k, height: (16 + 68 * c.ripple) * k, borderRadius: "50%", border: `${2.5 * k}px solid ${C.orange}`, opacity: (1 - c.ripple) * 0.9 }} />
          <div style={{ position: "absolute", left: -10 * k, top: -10 * k, width: 20 * k, height: 20 * k, borderRadius: "50%", background: C.orange, opacity: (1 - c.ripple) * 0.35, filter: `blur(${4 * k}px)` }} />
        </div>
      ) : null}
      <svg
        viewBox="0 0 28 28" width={28 * k} height={28 * k}
        style={{
          position: "absolute", left: c.x - 6 * k, top: c.y - 3 * k, opacity: c.opacity, overflow: "visible",
          transformOrigin: `${6 * k}px ${3 * k}px`, transform: `rotate(${c.rot}deg) scale(${1 - 0.12 * c.press})`,
          filter: "drop-shadow(0 3px 5px rgba(0,0,0,0.55))",
        }}
      >
        <path d="M6 3 L6 22.5 L10.6 18.3 L13.6 25.2 L16.9 23.8 L13.9 17 L20.2 16.6 Z" fill="#111" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    </>
  );
}

// a box in document px -> content px (inside the window) for the live camera
function boxToContent(cam: Cam, b: { x: number; y: number; w: number; h: number }) {
  const [vx, vy] = docToV(cam, b.x, b.y);
  return { x: (vx - cam.vx) * cam.s, y: (vy - cam.vy) * cam.s, w: b.w * cam.s, h: b.h * cam.s };
}

// the previous state stays inside part of a box while the new one wipes in, row by row (Verify's ticks)
function RevealHold({ tl, t, s, assets }: { tl: Timeline; t: number; s: ReturnType<typeof screenAt>; assets: Record<string, boolean> }) {
  const b = tl.beats.find((x) => x.reveal && Math.abs(x.t - s.changeT) < 0.01);
  if (!b || !s.prev) return null;
  const box = s.cur?.shot?.highlights[b.reveal!.id] ?? s.prev.shot?.highlights[b.reveal!.id];
  if (!box) return null;
  const steps = b.reveal!.steps ?? 4;
  const p = Math.floor(clamp01((t - b.t) / (b.reveal!.dur ?? 0.9)) * steps + 0.001) / steps;
  if (p >= 1) return null;
  const r = boxToContent(s.cam, box);
  const down = (b.reveal!.dir ?? "down") === "down";
  const clip = down
    ? `polygon(${r.x}px ${r.y + r.h * p}px, ${r.x + r.w}px ${r.y + r.h * p}px, ${r.x + r.w}px ${r.y + r.h}px, ${r.x}px ${r.y + r.h}px)`
    : `polygon(${r.x + r.w * p}px ${r.y}px, ${r.x + r.w}px ${r.y}px, ${r.x + r.w}px ${r.y + r.h}px, ${r.x + r.w * p}px ${r.y + r.h}px)`;
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: VW, height: VH, clipPath: clip }}>
      <LayerView tl={tl} layer={s.prev} cam={s.cam} t={t} opacity={1} dy={0} assets={assets} />
    </div>
  );
}

// bars "grow": a cover the colour of their card slides off to the right (V space, inside the camera)
function Covers({ tl, t, cam }: { tl: Timeline; t: number; cam: Cam }) {
  return (
    <>
      {tl.beats.filter((b) => b.cover && t >= b.t - 1 && t < b.t + 3).map((b, i) => {
        const c = b.cover!;
        const box = hlOf(tl, t, c.id);
        if (!box) return null;
        const [l, tp, r, bt] = c.inset ?? [0, 0, 0, 0];
        const p = prog(t, b.t + (c.delay ?? 0), c.dur ?? 0.7, (x) => 1 - Math.pow(1 - x, 3));
        if (p >= 1) return null;
        const [x, y] = docToV(cam, box.x + l, box.y + tp);
        const w = box.w - l - r, h = box.h - tp - bt;
        return <div key={i} style={{ position: "absolute", left: x + w * p, top: y, width: w * (1 - p) + 1, height: h, background: c.color }} />;
      })}
    </>
  );
}

export function Screen({ tl, t, assets }: { tl: Timeline; t: number; assets: Record<string, boolean> }) {
  const s = screenAt(tl, t);
  if (!s.cur) return null;
  const f = prog(t, s.changeT, s.nav ? 0.42 : 0.24, inOut);
  const liftDim = Math.max(0, ...s.lifts.map((m) => sp(t, m.t0) * (1 - prog(t, m.out, 0.45))));
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: VW, height: VH, overflow: "hidden", background: C.bg }}>
      {s.prev && f < 1 ? <LayerView tl={tl} layer={s.prev} cam={s.nav ? s.prevCam : s.cam} t={t} opacity={1} dy={0} assets={assets} /> : null}
      <LayerView tl={tl} layer={s.cur} cam={s.cam} t={t} opacity={s.prev ? f : 1} dy={s.nav && s.prev ? 16 * (1 - f) : 0} assets={assets} />
      <RevealHold tl={tl} t={t} s={s} assets={assets} />
      <div style={{ position: "absolute", left: 0, top: 0, width: VW, height: VH, transformOrigin: "0 0", transform: `scale(${s.cam.s}) translate(${-s.cam.vx}px, ${-s.cam.vy}px)` }}>
        <Covers tl={tl} t={t} cam={s.cam} />
      </div>
      <div style={{ position: "absolute", left: 0, top: 0, width: VW, height: VH, transformOrigin: "0 0", transform: `scale(${s.cam.s}) translate(${-s.cam.vx}px, ${-s.cam.vy}px)` }}>
        <Spotlight tl={tl} t={t} cam={s.cam} spots={s.spots} liftDim={liftDim} />
        <Cursor tl={tl} t={t} cam={s.cam} />
      </div>
    </div>
  );
}

// ---------- 2.5D lift: the element's crop rises off the page toward the camera (frame space) ----------
export function Lifts({ tl, t }: { tl: Timeline; t: number }) {
  const s = screenAt(tl, t);
  const shot = s.cur?.shot?.kind === "clip" ? s.cur.base : s.cur?.shot;
  if (!shot || !s.lifts.length) return null;
  return (
    <>
      {s.lifts.map((m) => {
        const box = hlOf(tl, t, m.id);
        const r = hlToScreen(tl, t, m.id, false);
        if (!box || !r || r.w <= 0) return null;
        const a = sp(t, m.t0, { damping: 15, stiffness: 140, mass: 0.8 }) * (1 - prog(t, m.out, 0.45, inOut));
        if (a <= 0.005) return null;
        const k = r.w / box.w;
        const imgTop = shot.kind === "page" ? 0 : shot.scrollY;
        const px = (r.x + r.w / 2 - 960) * 0.014 * a;
        const py = -10 * a + Math.sin((t - m.t0) * 1.6) * 2 * a;
        // fx "type" on the same beat: the row's text types itself (stepped left-to-right reveal + caret)
        const typeB = tl.beats.find((b) => b.fx === "type" && Math.abs(b.t - m.t0) < 0.01);
        const steps = Math.max(8, Math.round((box.text ?? "").length * 0.9));
        const tp = typeB ? Math.floor(clamp01((t - m.t0 - 0.25) / (typeB.dur ?? 1.2)) * steps) / steps : 1;
        const pad = 10 * k;
        return (
          <div
            key={m.id + m.t0}
            style={{
              position: "absolute", left: r.x - pad, top: r.y - pad, width: r.w + 2 * pad, height: r.h + 2 * pad, overflow: "hidden",
              borderRadius: 14 * k, transform: `translate(${px}px, ${py}px) scale(${1 + 0.07 * a})`,
              background: typeB ? typeB.liftBg ?? "rgba(20,21,25,0.98)" : undefined,
              boxShadow: `0 ${34 * a}px ${80 * a}px rgba(0,0,0,${0.7 * a}), 0 0 0 ${1.5}px rgba(255,255,255,${0.14 * a}), 0 0 ${40 * a}px rgba(255,122,47,${0.18 * a})`,
              opacity: clamp01(a * 3),
            }}
          >
            <div style={{ position: "absolute", inset: 0, overflow: "hidden", clipPath: typeB ? `inset(0 ${(1 - tp) * (r.w / (r.w + 2 * pad)) * 100}% 0 0)` : undefined }}>
              <Img src={staticFile(shot.file)} style={{ position: "absolute", left: pad - box.x * k, top: pad - (box.y - imgTop) * k, width: shot.w * k, height: (shot.kind === "page" ? shot.h : VH) * k }} />
            </div>
            {/* covers ("grow" fx) inside the lifted crop, so lifted bars still grow */}
            {tl.beats.filter((b) => b.cover && t >= b.t - 1 && t < b.t + 3).map((b, i) => {
              const c = b.cover!;
              const cb = hlOf(tl, t, c.id);
              if (!cb) return null;
              const [l, tp2, rr, bt] = c.inset ?? [0, 0, 0, 0];
              const p = prog(t, b.t + (c.delay ?? 0), c.dur ?? 0.7, (x) => 1 - Math.pow(1 - x, 3));
              if (p >= 1) return null;
              const w = (cb.w - l - rr) * k, h = (cb.h - tp2 - bt) * k;
              return <div key={i} style={{ position: "absolute", left: pad + (cb.x + l - box.x) * k + w * p, top: pad + (cb.y + tp2 - box.y) * k, width: w * (1 - p) + 1, height: h, background: c.color }} />;
            })}
            {typeB && tp < 1 ? (
              <div style={{ position: "absolute", left: pad + r.w * tp + 2, top: pad - 2, width: 3 * Math.max(1, k / 2), height: r.h + 4, background: C.orange, opacity: Math.floor(t * 4) % 2 ? 1 : 0.35 }} />
            ) : null}
          </div>
        );
      })}
    </>
  );
}
