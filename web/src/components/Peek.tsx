import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { getParticles, imageUrl, maskUrl } from "../api";
import { batchLabel } from "../lib";
import { href } from "../router";
import type { TileParticles } from "../types";
import { PHASE_LEGEND, Seg } from "./bits";

/** "Look closer without leaving" (design/README.md): peek on hover or focus, pin on click.
 *  A region is a real particle centroid (particles.csv) or, without one, the whole tile. */
export interface PeekItem {
  batch: string;
  imageId: string;
  title: string;
  note?: string;
  region?: { x: number; y: number; r: number };  // full-resolution px of the cropped tile
  detectors?: string[];
  hasMask?: boolean;
}

type Geometry = Pick<TileParticles, "width" | "height" | "px_um">;
const geometryCache = new Map<string, Promise<Geometry>>();
let returningFocus = false;  // the inspector hands focus back to its trigger: don't reopen the peek for that

function useGeometry(batch: string, imageId: string): Geometry | null {
  const [geo, setGeo] = useState<Geometry | null>(null);
  useEffect(() => {
    const key = `${batch}/${imageId}`;
    if (!geometryCache.has(key))
      geometryCache.set(key, getParticles(batch, imageId, 0).catch((err) => {
        geometryCache.delete(key);  // try again next time rather than remember a failure
        throw err;
      }));
    let live = true;
    geometryCache.get(key)!.then((g) => live && setGeo(g), () => undefined);
    return () => {
      live = false;
    };
  }, [batch, imageId]);
  return geo;
}

const BARS_UM = [20, 10, 5, 2, 1];

/** Crop maths: the region fills ~70% of the box (1.4× to 12×), the crop never shows past the image edge,
 *  and the scale bar is the largest of 20/10/5/2/1 µm that fits in 110 px. Without a region: the whole tile. */
function crop(geo: Geometry, box: { w: number; h: number }, region?: PeekItem["region"]) {
  const fit = Math.min(box.w / geo.width, box.h / geo.height);
  const zoom = region ? Math.min(12, Math.max(1.4, (0.7 * Math.min(box.w, box.h)) / (2 * region.r) / fit)) : 1;
  const k = fit * zoom;
  const w = geo.width * k;
  const h = geo.height * k;
  const cx = region ? region.x : geo.width / 2;
  const cy = region ? region.y : geo.height / 2;
  const clamp = (v: number, size: number, boxSize: number) => (size <= boxSize ? (boxSize - size) / 2 : Math.min(0, Math.max(boxSize - size, v)));
  const left = clamp(box.w / 2 - cx * k, w, box.w);
  const top = clamp(box.h / 2 - cy * k, h, box.h);
  const umPerPx = geo.px_um ? geo.px_um / k : null;  // no pixel size, no scale bar: never guess one
  const bar = umPerPx ? BARS_UM.find((um) => um / umPerPx <= 110) ?? 1 : null;
  return {
    zoom, k, w, h, left, top, bar, barPx: bar && umPerPx ? bar / umPerPx : 0,
    ring: region ? { x: left + region.x * k, y: top + region.y * k, r: region.r * k } : null,
  };
}

function Magnified({ item, detector = "BSE", mask = false, box: maxBox }: { item: PeekItem; detector?: string; mask?: boolean; box: { w: number; h: number } }) {
  const geo = useGeometry(item.batch, item.imageId);
  // a whole tile gets a box of its own shape, so it isn't letterboxed
  const box = geo && !item.region ? { w: maxBox.w, h: Math.min(maxBox.h, Math.round((maxBox.w * geo.height) / geo.width)) } : maxBox;
  const c = geo ? crop(geo, box, item.region) : null;
  const img: CSSProperties | undefined = c ? { position: "absolute", left: c.left, top: c.top, width: c.w, height: c.h, maxWidth: "none" } : undefined;
  return (
    <div className="relative overflow-hidden rounded-xl bg-black" style={{ width: box.w, height: box.h }}>
      {c && (
        <>
          <img src={imageUrl(item.batch, item.imageId, detector, 2048)} alt="" style={img} />
          {mask && <img src={maskUrl(item.batch, item.imageId)} alt="" style={{ ...img, opacity: 0.9 }} />}
          {c.ring && (
            <span
              className="absolute rounded-full border-2 border-cx-text-strong"
              style={{ left: c.ring.x - c.ring.r, top: c.ring.y - c.ring.r, width: 2 * c.ring.r, height: 2 * c.ring.r, boxShadow: "0 0 0 2px rgba(10,11,13,.6)" }}
            />
          )}
          {c.bar && (
            <span className="mono absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] text-cx-text">
              <span className="inline-block h-[3px] bg-cx-text-strong" style={{ width: c.barPx }} />
              {c.bar} µm
            </span>
          )}
          {item.region && (
            <span className="mono absolute top-2 right-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] text-cx-text-2">
              {c.zoom.toFixed(1)}×
            </span>
          )}
        </>
      )}
    </div>
  );
}

interface Pinned {
  items: PeekItem[];
  index: number;
  returnTo: HTMLElement | null;
}

const PeekContext = createContext<{
  peek: (item: PeekItem, anchor: DOMRect) => void;
  unpeek: () => void;
  pin: (items: PeekItem[], index: number, from: HTMLElement) => void;
} | null>(null);

export function PeekProvider({ children }: { children: ReactNode }) {
  const [hover, setHover] = useState<{ item: PeekItem; anchor: DOMRect } | null>(null);
  const [pinned, setPinned] = useState<Pinned | null>(null);
  const peek = useCallback((item: PeekItem, anchor: DOMRect) => setHover({ item, anchor }), []);
  const unpeek = useCallback(() => setHover(null), []);
  const pin = useCallback((items: PeekItem[], index: number, from: HTMLElement) => {
    setHover(null);
    setPinned({ items, index, returnTo: from });
  }, []);
  return (
    <PeekContext.Provider value={{ peek, unpeek, pin }}>
      {children}
      {hover && !pinned && <Popover item={hover.item} anchor={hover.anchor} />}
      {pinned && (
        <Inspector
          pinned={pinned}
          onMove={(index) => setPinned((p) => p && { ...p, index })}
          onClose={() => {
            setPinned(null);
            returningFocus = true;
            pinned.returnTo?.focus();
            returningFocus = false;
          }}
        />
      )}
    </PeekContext.Provider>
  );
}

/** Regions zoom into a 300×200 crop; a whole tile gets a wider box so it reads larger than its thumbnail. */
const popBox = (item: PeekItem) => (item.region ? { w: 300, h: 200 } : { w: 460, h: 240 });

/** Beside the anchor, on the side with more room, kept inside the viewport; never over the anchor if it fits. */
function Popover({ item, anchor }: { item: PeekItem; anchor: DOMRect }) {
  const POP = popBox(item);
  const width = POP.w + 28;
  const right = window.innerWidth - anchor.right;
  const side = right >= width + 16 || right > anchor.left ? anchor.right + 12 : anchor.left - width - 12;
  const left = Math.max(12, Math.min(window.innerWidth - width - 12, side));
  const top = Math.max(12, Math.min(window.innerHeight - POP.h - 120, anchor.top + anchor.height / 2 - POP.h / 2 - 30));
  return (
    <div role="tooltip" className="glass font-cx pointer-events-none fixed z-50 flex flex-col gap-2 rounded-[16px] p-3.5 text-cx-text" style={{ left, top, width, background: "rgba(20,21,25,.92)" }}>
      <span className="text-[13px] font-medium">{item.title}</span>
      <Magnified item={item} box={POP} />
      {item.note && <span className="text-xs leading-snug text-cx-text-2">{item.note}</span>}
      <span className="mono text-[10px] text-cx-faint">Click to pin · stays on this page</span>
    </div>
  );
}

const PIN = { w: 372, h: 250 };

function Inspector({ pinned, onMove, onClose }: { pinned: Pinned; onMove: (index: number) => void; onClose: () => void }) {
  const item = pinned.items[pinned.index];
  const n = pinned.items.length;
  const [detector, setDetector] = useState("BSE");
  const [mask, setMask] = useState(false);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => close.current?.focus(), []);
  useEffect(() => {
    // capture phase, and stop it there: while pinned these keys belong to the inspector, not to a walkthrough
    const onKey = (e: KeyboardEvent) => {
      const inTabs = (e.target as HTMLElement | null)?.closest?.('[role="tablist"]');
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" && n > 1 && !inTabs) onMove((pinned.index + 1) % n);
      else if (e.key === "ArrowLeft" && n > 1 && !inTabs) onMove((pinned.index - 1 + n) % n);
      else return;
      e.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [pinned.index, n, onMove, onClose]);
  const detectors = item.detectors?.length ? item.detectors : ["BSE", "ETD", "InLens"];
  return (
    <aside aria-label="Region inspector" className="glass font-cx fixed top-20 right-6 z-50 flex w-[404px] flex-col gap-3 rounded-[20px] p-4 text-cx-text" style={{ background: "rgba(20,21,25,.94)" }}>
      <div className="flex items-center gap-2.5">
        <span className="flex min-w-0 flex-col">
          <span className="text-[15px] font-medium">{item.title}</span>
          <span className="mono truncate text-[11px] text-cx-faint">{batchLabel(item.batch)} · {item.imageId}</span>
        </span>
        <button ref={close} type="button" aria-label="Close inspector" onClick={onClose} className="ml-auto grid h-8 w-8 cursor-pointer place-items-center rounded-lg border border-cx-line bg-transparent text-cx-text">
          ✕
        </button>
      </div>
      <Magnified item={item} detector={detector} mask={mask && !!item.hasMask} box={PIN} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Seg options={detectors.map((d) => ({ value: d, label: <span className="mono text-xs">{d}</span> }))} value={detectors.includes(detector) ? detector : detectors[0]} onChange={setDetector} />
        <button
          type="button"
          role="switch"
          aria-checked={mask}
          disabled={!item.hasMask}
          onClick={() => setMask((m) => !m)}
          title={item.hasMask ? "Silicon, pore and binder from the segmentation" : "Not measured yet"}
          className="flex cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-[13px] text-cx-text disabled:cursor-not-allowed disabled:opacity-45"
        >
          <span className="relative h-5 w-[34px] rounded-[10px]" style={{ background: mask ? "var(--cx-phase-si)" : "rgba(255,255,255,.14)" }}>
            <span className="absolute top-0.5 h-4 w-4 rounded-full transition-all" style={{ left: mask ? 16 : 2, background: mask ? "#fff" : "var(--cx-muted)" }} />
          </span>
          Phases
        </button>
      </div>
      {mask && item.hasMask && (
        <div className="flex flex-wrap gap-3 text-xs text-cx-muted">
          {PHASE_LEGEND.map(([name, color]) => (
            <span key={name} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: color }} />
              {name}
            </span>
          ))}
        </div>
      )}
      {item.note && <p className="m-0 text-[13px] leading-normal text-cx-text-2">{item.note}</p>}
      <div className="flex items-center gap-2">
        <button className="btn min-h-9 px-3" type="button" aria-label="Previous" disabled={n < 2} onClick={() => onMove((pinned.index - 1 + n) % n)}>←</button>
        <span className="mono text-xs text-cx-muted">{pinned.index + 1} / {n}</span>
        <button className="btn min-h-9 px-3" type="button" aria-label="Next" disabled={n < 2} onClick={() => onMove((pinned.index + 1) % n)}>→</button>
        <a href={href.library(item.batch, item.imageId)} onClick={onClose} className="ml-auto text-[13px]">Open full tile</a>
      </div>
    </aside>
  );
}

/** A thumbnail, chip or spot that peeks on hover and focus and pins on click (or tap). */
export function Peekable({
  items,
  index,
  className,
  style,
  label,
  children,
}: {
  items: PeekItem[];
  index: number;
  className?: string;
  style?: CSSProperties;
  label: string;
  children?: ReactNode;
}) {
  const ctx = useContext(PeekContext);
  const ref = useRef<HTMLButtonElement>(null);
  const show = () => ref.current && ctx?.peek(items[index], ref.current.getBoundingClientRect());
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      className={`cursor-zoom-in border-0 p-0 ${className ?? ""}`}
      style={style}
      onMouseEnter={show}
      onMouseLeave={() => ctx?.unpeek()}
      onFocus={() => !returningFocus && show()}
      onBlur={() => ctx?.unpeek()}
      onClick={() => ref.current && ctx?.pin(items, index, ref.current)}
    >
      {children}
    </button>
  );
}
