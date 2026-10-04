import { OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getConfig, listBatches } from "../api";
import { BatchDot, Cat, ErrorPanel, Folds, IconWarn, Panel, Spinner } from "../components/bits";
import { batchColor, batchLabel } from "../lib";
import { Chart, Legend } from "./Charts";
import { COLORS } from "./materials";
import { loadSlab, profile, state, type Loaded, type State } from "./model";
import { SEI_EXAGGERATION, Slab } from "./Slab";
import type { Drive, Indicator } from "./types";

const SI_LINE = "#FF9A3C"; // --cx-phase-si
const HONESTY = "Indicative illustration from measured 2D statistics · not a 3D reconstruction · not a cell simulation · never part of a verdict";
const pct = (v: number, digits = 0) => `${(v * 100).toFixed(digits)}%`;
const cFromT = (t: number) => 0.25 * 2 ** (t * 5);
const tFromC = (c: number) => Math.log2(c / 0.25) / 5;
const cyclesFromT = (t: number) => Math.round(t * t * 1000);
const cRateText = (c: number) => `${c.toFixed(c < 1 ? 2 : 1)}C`;
const cssColor = (value: string) =>
  value.startsWith("var(") ? getComputedStyle(document.documentElement).getPropertyValue(value.slice(4, -1)).trim() || "#8A8C92" : value;

function formatIndicator(ind: Indicator, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (ind.unit === "C") return `${v.toFixed(1)}C`;
  if (ind.unit === "ratio") return `×${v.toFixed(2)}`;
  return pct(v, v < 0.2 ? 1 : 0);
}

/** One line for the top of the page: the chosen batch against the baseline on the three headline indicators,
    and whether the gap is bigger than the image-to-image spread within each batch. Numbers only, no verdict. */
function takeaway(base: Loaded, other: Loaded | null): ReactNode {
  const keys = ["si_capacity_share", "thickness_swell_full", "plating_onset_c"] as const;
  const words = {
    si_capacity_share: ["silicon gives ", " of the capacity"],
    thickness_swell_full: ["", " thicker at full charge"],
    plating_onset_c: ["plating from ", ""],
  } as const;
  if (!other)
    return (
      <>
        {batchLabel(base.batch)}: {formatIndicator(base.indicators.si_capacity_share, base.indicators.si_capacity_share.value)} of the capacity
        from {pct(base.targets.si_frac, 1)} silicon by volume, {formatIndicator(base.indicators.thickness_swell_full, base.indicators.thickness_swell_full.value)} thicker
        at full charge, lithium plating from {formatIndicator(base.indicators.plating_onset_c, base.indicators.plating_onset_c.value)}.
      </>
    );
  const overlap = keys.every((k) => {
    const a = base.indicators[k].range, b = other.indicators[k].range;
    return !a || !b || (a[0] <= b[1] && b[0] <= a[1]);
  });
  return (
    <>
      {batchLabel(other.batch)} vs {batchLabel(base.batch)}:{" "}
      {keys.map((k, i) => {
        const ind = other.indicators[k];
        return (
          <span key={k}>
            {i > 0 && " · "}
            {words[k][0]}<span className="mono">{formatIndicator(ind, ind.value)}</span>
            <span className="text-cx-faint"> vs {formatIndicator(base.indicators[k], base.indicators[k].value)}</span>{words[k][1]}
          </span>
        );
      })}
      <span className="text-cx-muted">
        {overlap ? ". Each gap is within the spread between one batch's own images." : ". At least one gap is larger than the spread within a batch."}
      </span>
    </>
  );
}

/** Frames one slab or two side by side for the canvas's aspect; re-runs when that count or the size changes. */
function CameraRig({ count }: { count: number }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const controls = useThree((s) => s.controls) as unknown as { target: { set: (x: number, y: number, z: number) => void }; update: () => void } | null;
  useEffect(() => {
    const half = Math.tan(((36 / 2) * Math.PI) / 180);
    const aspect = size.width / Math.max(1, size.height);
    const halfW = count > 1 ? 92 : 52, halfH = 46;
    const distance = Math.max(halfH / half, halfW / (half * aspect)) + 22;
    camera.position.set(0, 40, distance);
    controls?.target.set(0, 26, 0);
    controls?.update();
  }, [camera, controls, count, size.width, size.height]);
  return null;
}

function Slider({ label, value, min, max, step, onChange, hint }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; hint: string;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <label className="mt-3.5 block">
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="text-cx-text-2">{label}</span>
        <span className="mono text-[12px] text-cx-text">{hint}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-cx-text-strong [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cx-text-strong [&::-webkit-slider-thumb]:shadow-[0_0_0_3px_rgba(10,11,13,0.9)]"
        style={{ background: `linear-gradient(90deg, var(--cx-text-2) ${fill}%, rgba(255,255,255,0.1) ${fill}%)` }} />
    </label>
  );
}

function Toggle({ label, on, onChange, dot }: { label: string; on: boolean; onChange: (v: boolean) => void; dot?: string }) {
  return (
    <button type="button" aria-pressed={on} onClick={() => onChange(!on)}
      className={`inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-[10px] border px-3 text-[13px] ${on ? "border-cx-line bg-white/[0.09] text-cx-text-strong" : "border-cx-line-soft bg-transparent text-cx-faint"}`}>
      {dot && <span className="h-2 w-2 rounded-full" style={{ background: dot, opacity: on ? 1 : 0.4 }} />}
      {label}
    </button>
  );
}

function Swatch({ color, label, round = false }: { color: string; label: string; round?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-2.5 w-2.5 ${round ? "rounded-full" : "rounded-[3px]"}`} style={{ background: color }} />
      {label}
    </span>
  );
}

function BatchHead({ names }: { names: string[] }) {
  return (
    <thead>
      <tr className="text-cx-faint">
        <th className="pb-1.5 text-left font-normal" />
        {names.map((n) => (
          <th key={n} className="whitespace-nowrap pb-1.5 pl-3 text-right font-medium text-cx-text-2">
            <span className="inline-flex items-center gap-1.5"><BatchDot name={n} size={7} />{batchLabel(n)}</span>
          </th>
        ))}
      </tr>
    </thead>
  );
}

export default function SlabLab() {
  const [baseline, setBaseline] = useState<string>("");
  const [options, setOptions] = useState<string[]>([]);
  const [other, setOther] = useState<string>("");
  const [models, setModels] = useState<Record<string, Loaded>>({});
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [folds, setFolds] = useState<Record<string, boolean>>({ consequences: true });
  const [drive, setDrive] = useState<Drive>(() => {
    const q = new URLSearchParams(window.location.search);
    const num = (key: string, fallback: number, lo: number, hi: number) => {
      const v = Number(q.get(key) ?? fallback);
      return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
    };
    return {
      soc: num("soc", 0, 0, 1), cRate: num("c", 1, 0.25, 8), cycles: Math.round(num("cycles", 0, 0, 1000)),
      sliceUm: 30 - num("milled", 0, 0, 29), showIons: q.get("ions") !== "0", showSection: q.get("section") === "1",
    };
  });
  const set = (patch: Partial<Drive>) => setDrive((d) => ({ ...d, ...patch }));
  const labelRoot = useRef<HTMLDivElement>(null!);

  useEffect(() => {
    Promise.all([getConfig(), listBatches()]).then(([cfg, batches]) => {
      const names = batches.filter((b) => b.has_images && !b.name.startsWith("drop") && b.name !== "example").map((b) => b.name);
      setBaseline(cfg.baseline);
      setOptions(names.filter((n) => n !== cfg.baseline));
      setOther(names.find((n) => n !== cfg.baseline) ?? "");
    }).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    for (const name of [baseline, other]) {
      if (!name || models[name]) continue;
      loadSlab(name).then((m) => setModels((all) => ({ ...all, [name]: m }))).catch((e) => setError(`${name}: ${e}`));
    }
  }, [baseline, other, models]);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now(), frame = 0;
    const seconds = Math.min(24, Math.max(3, 14 / drive.cRate));
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setDrive((d) => {
        const soc = Math.min(1, d.soc + dt / seconds);
        if (soc >= 1) setPlaying(false);
        return { ...d, soc };
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, drive.cRate]);

  // Swap the whole set at once: slabs appearing one by one would re-key the 3D labels mid-render.
  const wanted = [baseline, other].filter(Boolean);
  const shown = wanted.length && wanted.every((n) => models[n]) ? wanted : [];
  const states = useMemo(() => Object.fromEntries(shown.map((n) => [n, state(models[n], drive.soc, drive.cRate, drive.cycles)])) as Record<string, State>,
    [shown.join(), models, drive.soc, drive.cRate, drive.cycles]); // eslint-disable-line react-hooks/exhaustive-deps
  const colors = useMemo(() => Object.fromEntries(shown.map((n) => [n, cssColor(batchColor(n))])), [shown.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const spacing = 76;
  const base = shown[0] ? models[shown[0]] : null;
  const compared = shown[1] ? models[shown[1]] : null;

  const readouts: { label: string; value: (s: State, m: Loaded) => ReactNode; hint?: string }[] = [
    { label: "Current flowing", value: (s) => cRateText(s.current), hint: "Constant current to 80%, then it tapers (CC-CV)" },
    { label: "Coating thickness", value: (s) => `${s.thicknessUm.toFixed(1)} µm` },
    { label: "Pore space", value: (s) => pct(s.porosity, 1) },
    { label: "Lithium transport through the pores", value: (s, m) => `×${((s.porosity / m.targets.porosity) ** 1.5).toFixed(2)}`, hint: "Compared with the empty cell; Bruggeman, porosity^1.5" },
    { label: "Charge taken up: silicon / graphite", value: (s) => `${(s.xSi * 100).toFixed(0)}/${pct(s.xGr)}` },
    {
      label: "Safety margin against lithium plating", hint: "Separator side: local potential minus overpotential, vs 0 V Li",
      value: (s) => s.margin[0] < 0
        ? <span className="inline-flex items-center gap-1 text-cx-reject-text"><IconWarn size={12} />plating</span>
        : `+${(s.margin[0] * 1000).toFixed(0)} mV`,
    },
    { label: `Capacity left after ${drive.cycles} cycles`, value: (s) => `${(s.capacity[0] * 100).toFixed(0)}–${pct(s.capacity[1])}`, hint: "Scenario range, not a prediction" },
    { label: "Silicon cracked / lost contact", value: (s) => `${(s.crackedShare * 100).toFixed(0)}/${pct(s.deadShare)}` },
  ];

  const socTicks = [0, 0.25, 0.5, 0.75, 1];
  const fx = (v: number) => pct(v);

  return (
    <div className="flex h-[calc(100vh-64px)] min-h-[600px] overflow-hidden">
      <div className="relative min-w-0 flex-1" ref={labelRoot}>
        <Canvas flat dpr={[1, 2]} camera={{ position: [0, 40, 230], fov: 36, near: 1, far: 3000 }}
          onCreated={({ gl }) => { gl.localClippingEnabled = true; }}>
          <color attach="background" args={["#0A0B0D"]} />
          <ambientLight intensity={0.65} />
          <hemisphereLight args={["#cfe0ff", "#1a1208", 0.45]} />
          <directionalLight position={[70, 140, 160]} intensity={1.7} />
          <directionalLight position={[-140, 50, -80]} intensity={0.55} color="#9ecbff" />
          {shown.map((name, i) => (
            <Slab key={name} labelRoot={labelRoot} model={models[name]} drive={drive} st={states[name]} color={colors[name]}
              offsetX={shown.length > 1 ? (i - 0.5) * spacing : 0} labels={i === shown.length - 1}
              title={`${batchLabel(name)}${name === baseline ? " · baseline" : ""}`}
              subtitle={`median of ${models[name].n_images} images · ${models[name].n_particles_measured.toLocaleString()} Si particles`} />
          ))}
          <OrbitControls makeDefault enableDamping target={[0, 26, 0]} maxDistance={600} minDistance={30} maxPolarAngle={Math.PI * 0.6} />
          <CameraRig count={shown.length} />
        </Canvas>

        <div className="glass pointer-events-none absolute inset-x-4 top-4 flex flex-col gap-2 rounded-[16px] px-4 py-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="lbl">Anode lab</span>
            <span className="mono rounded-md border border-cx-orange/40 px-1.5 py-0.5 text-[10px] text-cx-orange-text">EXPERIMENTAL</span>
            <span className="ml-auto rounded-full border border-cx-investigate/40 px-2.5 py-0.5 text-[10px] text-cx-investigate-text">{HONESTY}</span>
          </div>
          {base && <div className="text-[14px] leading-snug text-cx-text">{takeaway(base, compared)}</div>}
        </div>

        {!base && (
          <div className="absolute inset-0 grid place-items-center">
            {error ? (
              <div className="w-[480px]"><ErrorPanel title="The anode lab couldn't load" message={error} command="uv run uvicorn qc.api:app" /></div>
            ) : (
              <div className="flex flex-col items-center gap-3 text-sm text-cx-muted">
                <Cat mood="sniffing" size={48} />
                <span className="inline-flex items-center gap-2"><Spinner size={16} />Packing the blocks from the measured statistics…</span>
              </div>
            )}
          </div>
        )}

        <div className="glass pointer-events-none absolute bottom-4 left-4 max-w-[560px] rounded-[16px] px-3.5 py-2.5 text-[11px] text-cx-muted">
          <div className="lbl mb-1.5">In the picture</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            <span className="inline-flex items-center gap-1.5">
              graphite
              {COLORS.graphiteStages.map(([c, label]) => (
                <span key={label} title={label} className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: c }} />
              ))}
              fills grey → blue → red → gold
            </span>
            <Swatch color={COLORS.siPristine} label="silicon" />
            <Swatch color={COLORS.siLithiated} label="silicon with lithium" />
            <Swatch color={COLORS.siHot} label="stress while charging" round />
            <Swatch color={COLORS.ion} label="lithium ions" round />
            <Swatch color={COLORS.lithium} label="lithium metal (plating)" />
            <Swatch color={COLORS.sei} label={`surface film, SEI (drawn ${SEI_EXAGGERATION}× thicker)`} />
            <Swatch color={COLORS.siDead} label="silicon that lost contact (dead)" />
          </div>
          <div className="mt-1.5 text-[10px] text-cx-faint">Drag to turn · scroll to zoom · cut faces show what lies on the plane; dark gaps are pores filled with electrolyte</div>
        </div>
      </div>

      <aside className="flex w-[380px] shrink-0 flex-col gap-4 overflow-y-auto py-4 pr-4">
        <Panel className="!p-5">
          <div className="lbl">Compare</div>
          <div className="mt-2.5 flex items-center gap-2 text-[13px]">
            <span className="inline-flex min-h-8 items-center gap-2 rounded-full border border-cx-line px-3">
              {baseline && <BatchDot name={baseline} size={8} />}{batchLabel(baseline || "…")}
            </span>
            <span className="text-cx-faint">vs</span>
            <select value={other} onChange={(e) => setOther(e.target.value)}
              className="min-h-8 rounded-[10px] border border-cx-line bg-cx-bg px-2 text-cx-text">
              <option value="">baseline only</option>
              {options.map((n) => <option key={n} value={n}>{batchLabel(n)}</option>)}
            </select>
          </div>

          <div className="mt-5 flex items-center justify-between">
            <div className="lbl">In a cell</div>
            <div className="flex gap-2">
              <button type="button" className="btn pri whitespace-nowrap" style={{ minHeight: 34, padding: "0 14px", fontSize: 13 }}
                onClick={() => { if (drive.soc >= 0.999) set({ soc: 0 }); setPlaying(!playing); }}>
                {playing ? "Pause" : `Charge at ${cRateText(drive.cRate)}`}
              </button>
              <button type="button" className="btn" style={{ minHeight: 34, padding: "0 12px", fontSize: 13 }}
                onClick={() => { setPlaying(false); set({ soc: 0 }); }}>Empty</button>
            </div>
          </div>
          <Slider label="State of charge" value={drive.soc} min={0} max={1} step={0.005} hint={pct(drive.soc)}
            onChange={(soc) => { setPlaying(false); set({ soc }); }} />
          <Slider label="Charge rate" value={tFromC(drive.cRate)} min={0} max={1} step={0.005}
            hint={`${cRateText(drive.cRate)} · ${Math.round(60 / drive.cRate)} min to full`}
            onChange={(t) => set({ cRate: Number(cFromT(t).toFixed(2)) })} />
          <Slider label="Ageing: charge–discharge cycles" value={Math.sqrt(drive.cycles / 1000)} min={0} max={1} step={0.002}
            hint={`${drive.cycles}`} onChange={(t) => set({ cycles: cyclesFromT(t) })} />
          <Slider label="Slice into the block (like a FIB-SEM cut)" value={30 - drive.sliceUm} min={0} max={29} step={0.25}
            hint={drive.sliceUm >= 30 ? "surface" : `${(30 - drive.sliceUm).toFixed(1)} µm in`} onChange={(v) => set({ sliceUm: 30 - v })} />
          <div className="mt-4 flex flex-wrap gap-2">
            <Toggle label="Lithium ions" dot={COLORS.ion} on={drive.showIons} onChange={(showIons) => set({ showIons })} />
            <Toggle label="Real SEM image on the cut" on={drive.showSection} onChange={(showSection) => set({ showSection })} />
          </div>
        </Panel>

        {base && (
          <Panel className="!p-5">
            <div className="lbl">Right now</div>
            <table className="mt-2 w-full text-[12px]">
              <BatchHead names={shown} />
              <tbody>
                {readouts.map((r) => (
                  <tr key={r.label} className="border-t border-cx-line-soft" title={r.hint}>
                    <td className="py-1.5 pr-2 text-cx-muted">{r.label}</td>
                    {shown.map((n) => <td key={n} className="mono whitespace-nowrap py-1.5 pl-3 text-right text-cx-text">{r.value(states[n], models[n])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>

            <Chart title="Who takes the lithium first" caption="one shared potential: silicon fills first"
              x={[0, 1]} y={[0, 1]} xTicks={socTicks} yTicks={[0, 0.5, 1]} fx={fx} fy={fx}
              markers={[{ x: drive.soc }]}
              series={shown.flatMap((n, i) => [
                { xs: models[n].charge.soc, ys: models[n].charge.x_si, color: SI_LINE, dash: i ? "4 3" : undefined },
                { xs: models[n].charge.soc, ys: models[n].charge.x_gr, color: COLORS.graphiteStages[3][0], dash: i ? "4 3" : undefined },
              ])} />
            <Legend items={[{ color: SI_LINE, label: "silicon" }, { color: COLORS.graphiteStages[3][0], label: "graphite" },
              ...(shown.length > 1 ? [{ color: "#8A8C92", label: `dashed: ${batchLabel(shown[1])}`, dash: true }] : [])]} />

            <Chart title="Safety margin against plating" caption={`mV at the separator side, ${cRateText(drive.cRate)}`}
              x={[0, 1]} y={[-0.1, 0.3]} xTicks={socTicks} yTicks={[-0.1, 0, 0.1, 0.2, 0.3]} fx={fx} fy={(v) => `${(v * 1000).toFixed(0)}`}
              markers={[{ x: drive.soc }]} hlines={[{ y: 0, label: "plating below 0 mV" }]}
              series={shown.map((n) => ({
                xs: models[n].charge.soc,
                ys: models[n].charge.soc.map((s) => profile(models[n], models[n].fast_charge.plating_margin_v, drive.cRate, s)[0]),
                color: colors[n],
              }))} />

            <Chart title="Through the thickness" caption={`how full the anode is, separator → collector (N/P ${base.np_ratio})`}
              x={[0, 1]} y={[0, 1]} xTicks={[0, 0.5, 1]} yTicks={[0, 0.5, 1]}
              fx={(v) => (v === 0 ? "separator" : v === 1 ? "collector" : "middle")} fy={fx}
              series={shown.map((n) => ({ xs: models[n].fast_charge.depth, ys: states[n].localFill, color: colors[n] }))} />

            <Chart title="Capacity over cycles" caption="scenario range: surface film growth + silicon losing contact"
              x={[0, 1000]} y={[0.6, 1]} xTicks={[0, 250, 500, 750, 1000]} yTicks={[0.6, 0.8, 1]} fy={fx}
              markers={[{ x: drive.cycles }]}
              bands={shown.map((n) => ({ xs: models[n].ageing.cycles, lo: models[n].ageing.capacity_low, hi: models[n].ageing.capacity_high, color: colors[n] }))} />
          </Panel>
        )}

        {base && (
          <Folds open={folds} onToggle={(id) => setFolds((f) => ({ ...f, [id]: !f[id] }))} rows={[
            {
              id: "consequences",
              title: "What this would mean in a cell",
              summary: "indicative",
              body: () => (
                <>
                  <div className="text-[11px] text-cx-faint">Batch median; below it, the 10th–90th percentile across that batch's images.</div>
                  <table className="mt-2 w-full text-[12px]">
                    <BatchHead names={shown} />
                    <tbody>
                      {Object.entries(base.indicators).map(([key, ind]) => (
                        <tr key={key} className="border-t border-cx-line-soft align-top" title={ind.formula}>
                          <td className="py-1.5 pr-2 text-cx-muted">{ind.label}</td>
                          {shown.map((n) => {
                            const own = models[n].indicators[key];
                            return (
                              <td key={n} className="mono py-1.5 text-right">
                                <div className="text-cx-text">{formatIndicator(own, own.value)}</div>
                                {own.range && <div className="text-[10px] text-cx-faint">{formatIndicator(own, own.range[0])}–{formatIndicator(own, own.range[1])}</div>}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="mt-2 text-[11px] leading-relaxed text-cx-faint">
                    If the additive is SiOx rather than Si, silicon's share of the capacity drops to {pct(base.indicators.si_capacity_share.siox_value ?? NaN)} ({batchLabel(base.batch)}).
                    Thickening spans {pct(base.indicators.thickness_swell_full.assumption_range?.[0] ?? NaN)}–{pct(base.indicators.thickness_swell_full.assumption_range?.[1] ?? NaN)} depending on how much swelling the pores absorb.
                  </div>
                </>
              ),
            },
            {
              id: "packing",
              title: "Packing check",
              summary: `${pct(base.achieved.porosity, 1)} pores`,
              body: () => (
                <>
                  <table className="w-full text-[12px]">
                    <BatchHead names={shown} />
                    <tbody>
                      {(["si_frac", "graphite_frac", "porosity"] as const).map((k) => (
                        <tr key={k} className="border-t border-cx-line-soft">
                          <td className="py-1.5 text-cx-muted">{{ si_frac: "silicon", graphite_frac: "graphite", porosity: "pore" }[k]} volume</td>
                          {shown.map((n) => (
                            <td key={n} className="mono py-1.5 text-right text-cx-text">
                              {pct(models[n].achieved[k], 1)} <span className="text-cx-faint">/ {pct(models[n].targets[k], 1)}</span>
                            </td>
                          ))}
                        </tr>
                      ))}
                      {[
                        ["apparent 2D porosity", (m: Loaded) => pct(m.targets.porosity_apparent, 1)],
                        ["Si d50: 2D section / 3D", (m: Loaded) => `${m.si_d50_um_2d.toFixed(1)} / ${m.si_d50_um_3d_volume.toFixed(1)} µm`],
                        ["Si in clusters", (m: Loaded) => pct(m.targets.agglomerated)],
                        ["particles drawn", (m: Loaded) => `${m.silicon.length} Si · ${m.graphite.length} flakes`],
                      ].map(([label, value]) => (
                        <tr key={label as string} className="border-t border-cx-line-soft">
                          <td className="py-1.5 text-cx-muted">{label as string}</td>
                          {shown.map((n) => <td key={n} className="mono py-1.5 text-right text-cx-text">{(value as (m: Loaded) => string)(models[n])}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="mt-1.5 text-[11px] text-cx-faint">achieved in the illustration / target from the measurements</div>
                </>
              ),
            },
            {
              id: "assumptions",
              title: "Assumptions and sources",
              summary: `${base.assumptions.length}`,
              body: () => (
                <>
                  <ul className="m-0 flex list-none flex-col gap-2.5 p-0 text-[12px]">
                    {base.assumptions.map((a) => (
                      <li key={a.name}>
                        <div className="text-cx-text-2">{a.name}: <span className="text-cx-muted">{a.value}</span></div>
                        <div className="text-[11px] text-cx-faint">{a.source}</div>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 text-[11px] text-cx-faint">{base.label} Computed in <span className="mono">qc/slab.py</span>; this page only draws it.</div>
                </>
              ),
            },
          ]} />
        )}
      </aside>
    </div>
  );
}
