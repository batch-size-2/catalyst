import { OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { getConfig, listBatches } from "../api";
import { batchColor, batchLabel } from "../lib";
import { Chart, Legend } from "./Charts";
import { COLORS } from "./materials";
import { loadSlab, profile, state, type Loaded, type State } from "./model";
import { SEI_EXAGGERATION, Slab } from "./Slab";
import type { Drive, Indicator } from "./types";

const SI_LINE = "#FF9A3C"; // --cx-phase-si
const pct = (v: number, digits = 0) => `${(v * 100).toFixed(digits)}%`;
const cFromT = (t: number) => 0.25 * 2 ** (t * 5);
const tFromC = (c: number) => Math.log2(c / 0.25) / 5;
const cyclesFromT = (t: number) => Math.round(t * t * 1000);
const cssColor = (value: string) =>
  value.startsWith("var(") ? getComputedStyle(document.documentElement).getPropertyValue(value.slice(4, -1)).trim() || "#8A8C92" : value;

function formatIndicator(ind: Indicator, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (ind.unit === "C") return `${v.toFixed(1)}C`;
  if (ind.unit === "ratio") return `×${v.toFixed(2)}`;
  return pct(v, v < 0.2 ? 1 : 0);
}

/** Frames the scene for one slab or two side by side; re-runs only when that count changes. */
function CameraRig({ count }: { count: number }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as { target: { set: (x: number, y: number, z: number) => void }; update: () => void } | null;
  useEffect(() => {
    camera.position.set(0, 46, count > 1 ? 192 : 125);
    controls?.target.set(0, 24, 0);
    controls?.update();
  }, [camera, controls, count]);
  return null;
}

function Slider({ label, value, min, max, step, onChange, hint }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; hint: string;
}) {
  return (
    <label className="mt-3 block">
      <div className="flex items-baseline justify-between text-[12px]">
        <span className="text-cx-text-2">{label}</span>
        <span className="mono text-cx-text">{hint}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-[var(--cx-orange)]" />
    </label>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!on)}
      className={`rounded-[10px] border px-2.5 py-1 text-[12px] ${on ? "border-cx-orange/60 bg-cx-orange/10 text-cx-orange-text" : "border-cx-line text-cx-faint"}`}>
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

export default function SlabLab() {
  const [baseline, setBaseline] = useState<string>("");
  const [options, setOptions] = useState<string[]>([]);
  const [other, setOther] = useState<string>("");
  const [models, setModels] = useState<Record<string, Loaded>>({});
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
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
  const first = shown[0] ? models[shown[0]] : null;

  const readouts: { label: string; value: (s: State, m: Loaded) => string; hint?: string }[] = [
    { label: "Current flowing", value: (s) => `${s.current.toFixed(s.current < 1 ? 2 : 1)}C`, hint: "CC-CV: tapers above 80% state of charge" },
    { label: "Coating thickness", value: (s) => `${s.thicknessUm.toFixed(1)} µm` },
    { label: "Porosity", value: (s) => pct(s.porosity, 1) },
    { label: "Ion transport vs empty", value: (s, m) => `×${((s.porosity / m.targets.porosity) ** 1.5).toFixed(2)}`, hint: "Bruggeman, porosity^1.5" },
    { label: "Si / graphite lithiated", value: (s) => `${pct(s.xSi)} / ${pct(s.xGr)}` },
    { label: "Separator side vs 0 V Li", value: (s) => (s.margin[0] < 0 ? "PLATING" : `+${(s.margin[0] * 1000).toFixed(0)} mV`) },
    { label: "Capacity left (scenario)", value: (s) => `${pct(s.capacity[0])}–${pct(s.capacity[1])}` },
    { label: "Si cracked / lost contact", value: (s) => `${pct(s.crackedShare)} / ${pct(s.deadShare)}` },
  ];

  const socTicks = [0, 0.25, 0.5, 0.75, 1];
  const fx = (v: number) => pct(v);

  return (
    <div className="cx flex h-screen flex-col overflow-hidden">
      <header className="flex items-center justify-between gap-4 border-b border-cx-line px-5 py-3">
        <div className="flex items-baseline gap-3">
          <a href="/" className="text-[15px] font-semibold text-cx-text-strong">Catalyst</a>
          <span className="text-[14px] text-cx-muted">Anode lab · what the measured microstructure means inside a cell</span>
        </div>
        <span className="rounded-full border border-cx-investigate/40 bg-cx-investigate/10 px-3 py-1 text-[11px] text-cx-investigate-text">
          Indicative illustration from measured 2D statistics · not a 3D reconstruction · not a cell simulation · never part of a verdict
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1" ref={labelRoot}>
          <Canvas flat dpr={[1, 2]} camera={{ position: [0, 46, 192], fov: 36, near: 1, far: 3000 }}
            onCreated={({ gl }) => { gl.localClippingEnabled = true; }}>
            <color attach="background" args={["#0A0B0D"]} />
            <ambientLight intensity={0.5} />
            <hemisphereLight args={["#cfe0ff", "#1a1208", 0.45]} />
            <directionalLight position={[70, 140, 160]} intensity={1.7} />
            <directionalLight position={[-140, 50, -80]} intensity={0.55} color="#9ecbff" />
            {shown.map((name, i) => (
              <Slab key={name} labelRoot={labelRoot} model={models[name]} drive={drive} st={states[name]} color={colors[name]}
                offsetX={shown.length > 1 ? (i - 0.5) * spacing : 0} labels={name === baseline}
                title={`${batchLabel(name)}${name === baseline ? " · baseline" : ""}`}
                subtitle={`median of ${models[name].n_images} images · ${models[name].n_particles_measured.toLocaleString()} measured Si particles`} />
            ))}
            <OrbitControls makeDefault enableDamping target={[0, 24, 0]} maxDistance={600} minDistance={30} maxPolarAngle={Math.PI * 0.6} />
            <CameraRig count={shown.length} />
          </Canvas>

          {!first && (
            <div className="absolute inset-0 grid place-items-center text-[13px] text-cx-faint">
              {error ?? "Packing the slabs from the measured statistics…"}
            </div>
          )}
          {error && first && <div className="absolute left-4 top-4 text-[12px] text-cx-reject-text">{error}</div>}

          <div className="glass pointer-events-none absolute bottom-4 left-4 max-w-[640px] rounded-[16px] px-4 py-3 text-[11px] text-cx-muted">
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              <span className="inline-flex items-center gap-1.5">
                graphite
                {COLORS.graphiteStages.map(([c, label]) => (
                  <span key={label} title={label} className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: c }} />
                ))}
                grey → blue → red (LiC₁₂) → gold (LiC₆)
              </span>
              <Swatch color={COLORS.siPristine} label="silicon" />
              <Swatch color={COLORS.siLithiated} label="LiₓSi shell (cut face)" />
              <Swatch color={COLORS.siHot} label="Si stress glow" round />
              <Swatch color={COLORS.ion} label="Li⁺ in electrolyte" round />
              <Swatch color={COLORS.lithium} label="Li metal (plating)" />
              <Swatch color={COLORS.sei} label={`SEI (drawn ${SEI_EXAGGERATION}× thicker)`} />
              <Swatch color={COLORS.siDead} label="Si that lost contact" />
            </div>
            <div className="mt-1.5 text-cx-faint">
              Drag to orbit · scroll to zoom · cut faces show what lies on the plane, dark gaps are electrolyte-filled pores
            </div>
          </div>
        </div>

        <aside className="w-[400px] shrink-0 overflow-y-auto border-l border-cx-line bg-cx-sidebar px-5 pb-10 pt-4">
          <section>
            <div className="text-[11px] uppercase tracking-wider text-cx-faint">Compare</div>
            <div className="mt-2 flex items-center gap-2 text-[13px]">
              <span className="rounded-[10px] border border-cx-line px-2.5 py-1" style={{ color: colors[baseline] }}>{batchLabel(baseline || "…")}</span>
              <span className="text-cx-faint">vs</span>
              <select value={other} onChange={(e) => setOther(e.target.value)}
                className="rounded-[10px] border border-cx-line bg-transparent px-2 py-1 text-cx-text">
                <option value="">— none —</option>
                {options.map((n) => <option key={n} value={n} className="bg-cx-bg">{batchLabel(n)}</option>)}
              </select>
            </div>
          </section>

          <section className="mt-5">
            <div className="flex items-center justify-between">
              <div className="text-[11px] uppercase tracking-wider text-cx-faint">Drive the cell</div>
              <div className="flex gap-2">
                <button type="button" onClick={() => { if (drive.soc >= 0.999) set({ soc: 0 }); setPlaying(!playing); }}
                  className="rounded-[10px] bg-cx-orange px-3 py-1 text-[12px] font-medium text-cx-on-orange hover:bg-cx-orange-hover">
                  {playing ? "Pause" : `Charge at ${drive.cRate.toFixed(drive.cRate < 1 ? 2 : 1)}C`}
                </button>
                <button type="button" onClick={() => { setPlaying(false); set({ soc: 0 }); }}
                  className="rounded-[10px] border border-cx-line px-3 py-1 text-[12px] text-cx-text-2">Empty</button>
              </div>
            </div>
            <Slider label="State of charge" value={drive.soc} min={0} max={1} step={0.005} hint={pct(drive.soc)}
              onChange={(soc) => { setPlaying(false); set({ soc }); }} />
            <Slider label="Charge rate" value={tFromC(drive.cRate)} min={0} max={1} step={0.005}
              hint={`${drive.cRate.toFixed(drive.cRate < 1 ? 2 : 1)}C · ${Math.round(60 / drive.cRate)} min to full`}
              onChange={(t) => set({ cRate: Number(cFromT(t).toFixed(2)) })} />
            <Slider label="Cycles (wear scenario)" value={Math.sqrt(drive.cycles / 1000)} min={0} max={1} step={0.002}
              hint={`${drive.cycles}`} onChange={(t) => set({ cycles: cyclesFromT(t) })} />
            <Slider label="FIB slice: mill into the block" value={30 - drive.sliceUm} min={0} max={29} step={0.25}
              hint={`${(30 - drive.sliceUm).toFixed(1)} µm milled`} onChange={(v) => set({ sliceUm: 30 - v })} />
            <div className="mt-3 flex flex-wrap gap-2">
              <Toggle label="Li⁺ ions" on={drive.showIons} onChange={(showIons) => set({ showIons })} />
              <Toggle label="Real section on the cut face" on={drive.showSection} onChange={(showSection) => set({ showSection })} />
            </div>
          </section>

          {shown.length > 0 && (
            <section className="mt-5">
              <div className="text-[11px] uppercase tracking-wider text-cx-faint">Right now</div>
              <table className="mt-2 w-full text-[12px]">
                <thead>
                  <tr className="text-cx-faint">
                    <th className="pb-1 text-left font-normal" />
                    {shown.map((n) => <th key={n} className="pb-1 text-right font-medium" style={{ color: colors[n] }}>{batchLabel(n)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {readouts.map((r) => (
                    <tr key={r.label} className="border-t border-cx-line-soft" title={r.hint}>
                      <td className="py-1 text-cx-muted">{r.label}</td>
                      {shown.map((n) => {
                        const text = r.value(states[n], models[n]);
                        return <td key={n} className={`mono py-1 text-right ${text === "PLATING" ? "text-cx-reject-text" : "text-cx-text"}`}>{text}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {first && (
            <section className="mt-2">
              <Chart title="Who takes the lithium" caption="one shared potential: Si fills first"
                x={[0, 1]} y={[0, 1]} xTicks={socTicks} yTicks={[0, 0.5, 1]} fx={fx} fy={fx}
                markers={[{ x: drive.soc }]}
                series={shown.flatMap((n, i) => [
                  { xs: models[n].charge.soc, ys: models[n].charge.x_si, color: SI_LINE, dash: i ? "4 3" : undefined },
                  { xs: models[n].charge.soc, ys: models[n].charge.x_gr, color: COLORS.graphiteStages[3][0], dash: i ? "4 3" : undefined },
                ])} />
              <Legend items={[{ color: SI_LINE, label: "silicon lithiated" }, { color: COLORS.graphiteStages[3][0], label: "graphite lithiated" },
                ...(shown.length > 1 ? [{ color: "#8A8C92", label: `dashed: ${batchLabel(shown[1])}`, dash: true }] : [])]} />

              <Chart title="Separator side: margin to Li plating" caption={`at ${drive.cRate.toFixed(1)}C, local potential − overpotential`}
                x={[0, 1]} y={[-0.1, 0.3]} xTicks={socTicks} yTicks={[-0.1, 0, 0.1, 0.2, 0.3]} fx={fx} fy={(v) => `${(v * 1000).toFixed(0)}`}
                markers={[{ x: drive.soc }]} hlines={[{ y: 0, label: "0 V vs Li: plating below" }]}
                series={shown.map((n) => ({
                  xs: models[n].charge.soc,
                  ys: models[n].charge.soc.map((s) => profile(models[n], models[n].fast_charge.plating_margin_v, drive.cRate, s)[0]),
                  color: colors[n],
                }))} />
              <div className="text-[11px] text-cx-faint">mV, against the cell state of charge</div>

              <Chart title="Through the thickness" caption={`anode lithiation, separator → collector (N/P ${first.np_ratio})`}
                x={[0, 1]} y={[0, 1]} xTicks={[0, 0.5, 1]} yTicks={[0, 0.5, 1]}
                fx={(v) => (v === 0 ? "separator" : v === 1 ? "collector" : "middle")} fy={fx}
                series={shown.map((n) => ({ xs: models[n].fast_charge.depth, ys: states[n].localFill, color: colors[n] }))} />

              <Chart title="Capacity over cycles (scenario band)" caption="SEI growth + Si losing contact"
                x={[0, 1000]} y={[0.6, 1]} xTicks={[0, 250, 500, 750, 1000]} yTicks={[0.6, 0.8, 1]} fy={fx}
                markers={[{ x: drive.cycles }]}
                bands={shown.map((n) => ({ xs: models[n].ageing.cycles, lo: models[n].ageing.capacity_low, hi: models[n].ageing.capacity_high, color: colors[n] }))} />
            </section>
          )}

          {first && (
            <section className="mt-5">
              <div className="text-[11px] uppercase tracking-wider text-cx-faint">Indicative consequences</div>
              <div className="mt-1 text-[11px] text-cx-faint">Batch median; brackets are the 10th–90th percentile across the batch's images.</div>
              <table className="mt-2 w-full text-[12px]">
                <tbody>
                  {Object.entries(first.indicators).map(([key, ind]) => (
                    <tr key={key} className="border-t border-cx-line-soft align-top" title={ind.formula}>
                      <td className="py-1.5 pr-2 text-cx-muted">{ind.label}</td>
                      {shown.map((n) => {
                        const own = models[n].indicators[key];
                        return (
                          <td key={n} className="mono py-1.5 text-right">
                            <div style={{ color: colors[n] }}>{formatIndicator(own, own.value)}</div>
                            {own.range && <div className="text-[10px] text-cx-faint">{formatIndicator(own, own.range[0])}–{formatIndicator(own, own.range[1])}</div>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-2 text-[11px] text-cx-faint">
                If the additive is SiOx rather than Si, the silicon share of the capacity drops to {pct(first.indicators.si_capacity_share.siox_value ?? NaN)} ({batchLabel(first.batch)}).
                Thickening spans {pct(first.indicators.thickness_swell_full.assumption_range?.[0] ?? NaN)}–{pct(first.indicators.thickness_swell_full.assumption_range?.[1] ?? NaN)} depending on how much swelling the pores absorb.
              </div>
            </section>
          )}

          {first && (
            <details className="mt-5 text-[12px]">
              <summary className="cursor-pointer text-[11px] uppercase tracking-wider text-cx-faint">Packing check</summary>
              <table className="mt-2 w-full">
                <thead><tr className="text-cx-faint"><th className="text-left font-normal" />{shown.map((n) => <th key={n} className="text-right font-normal">{batchLabel(n)}</th>)}</tr></thead>
                <tbody>
                  {(["si_frac", "graphite_frac", "porosity"] as const).map((k) => (
                    <tr key={k} className="border-t border-cx-line-soft">
                      <td className="py-1 text-cx-muted">{{ si_frac: "silicon", graphite_frac: "graphite", porosity: "pore" }[k]} volume</td>
                      {shown.map((n) => (
                        <td key={n} className="mono py-1 text-right text-cx-text">
                          {pct(models[n].achieved[k], 1)} <span className="text-cx-faint">/ {pct(models[n].targets[k], 1)}</span>
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr className="border-t border-cx-line-soft">
                    <td className="py-1 text-cx-muted">apparent 2D porosity</td>
                    {shown.map((n) => <td key={n} className="mono py-1 text-right text-cx-text">{pct(models[n].targets.porosity_apparent, 1)}</td>)}
                  </tr>
                  <tr className="border-t border-cx-line-soft">
                    <td className="py-1 text-cx-muted">Si d50: 2D section / 3D volume</td>
                    {shown.map((n) => <td key={n} className="mono py-1 text-right text-cx-text">{models[n].si_d50_um_2d.toFixed(1)} / {models[n].si_d50_um_3d_volume.toFixed(1)} µm</td>)}
                  </tr>
                  <tr className="border-t border-cx-line-soft">
                    <td className="py-1 text-cx-muted">Si in clusters</td>
                    {shown.map((n) => <td key={n} className="mono py-1 text-right text-cx-text">{pct(models[n].targets.agglomerated)}</td>)}
                  </tr>
                  <tr className="border-t border-cx-line-soft">
                    <td className="py-1 text-cx-muted">particles drawn</td>
                    {shown.map((n) => <td key={n} className="mono py-1 text-right text-cx-text">{models[n].silicon.length} Si · {models[n].graphite.length} flakes</td>)}
                  </tr>
                </tbody>
              </table>
              <div className="mt-1 text-[11px] text-cx-faint">achieved in the illustration / target from the measurements</div>
            </details>
          )}

          {first && (
            <details className="mt-4 text-[12px]" open>
              <summary className="cursor-pointer text-[11px] uppercase tracking-wider text-cx-faint">Assumptions and sources</summary>
              <ul className="mt-2 space-y-2">
                {first.assumptions.map((a) => (
                  <li key={a.name}>
                    <div className="text-cx-text-2">{a.name}: <span className="text-cx-muted">{a.value}</span></div>
                    <div className="text-[11px] text-cx-faint">{a.source}</div>
                  </li>
                ))}
              </ul>
              <div className="mt-3 text-[11px] text-cx-faint">{first.label} Computed in <span className="mono">qc/slab.py</span>; the page only draws it.</div>
            </details>
          )}
        </aside>
      </div>
    </div>
  );
}
