import type { SlabModel } from "./types";

/** Lookups into the curves qc/slab.py computed. Interpolation only: no physics is decided here. */

export interface Loaded extends SlabModel {
  pore: Uint8Array;
}

export async function loadSlab(batch: string): Promise<Loaded> {
  const res = await fetch(`/api/slab/${encodeURIComponent(batch)}`);
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  const model: SlabModel = await res.json();
  const packed = Uint8Array.from(atob(model.pores.bits), (c) => c.charCodeAt(0));
  const stream = new Blob([packed]).stream().pipeThrough(new DecompressionStream("deflate"));
  return { ...model, pore: new Uint8Array(await new Response(stream).arrayBuffer()) };
}

export function isPore(m: Loaded, x: number, y: number, z: number): boolean {
  const [nx, ny, nz] = m.pores.shape;
  const v = m.pores.voxel_um;
  const ix = Math.floor(x / v), iy = Math.floor(y / v), iz = Math.floor(z / v);
  if (ix < 0 || iy < 0 || iz < 0 || ix >= nx || iy >= ny || iz >= nz) return false;
  const i = (ix * ny + iy) * nz + iz;
  return ((m.pore[i >> 3] >> (7 - (i & 7))) & 1) === 1;
}

export function interp(xs: number[], ys: number[], x: number): number {
  if (x <= xs[0]) return ys[0];
  const n = xs.length - 1;
  if (x >= xs[n]) return ys[n];
  let lo = 0, hi = n;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const t = (x - xs[lo]) / (xs[hi] - xs[lo]);
  return ys[lo] + t * (ys[hi] - ys[lo]);
}

function bracket(xs: number[], x: number): [number, number, number] {
  if (x <= xs[0]) return [0, 0, 0];
  const n = xs.length - 1;
  if (x >= xs[n]) return [n, n, 0];
  let i = 0;
  while (xs[i + 1] < x) i++;
  return [i, i + 1, (x - xs[i]) / (xs[i + 1] - xs[i])];
}

/** Profile through the thickness at (C-rate, cell SOC), one value per backend depth point. */
export function profile(m: SlabModel, grid: number[][][], cRate: number, soc: number): number[] {
  const [c0, c1, tc] = bracket(m.fast_charge.c_rates, cRate);
  const [s0, s1, ts] = bracket(m.charge.soc, soc);
  return m.fast_charge.depth.map((_, k) => {
    const a = grid[c0][s0][k] * (1 - ts) + grid[c0][s1][k] * ts;
    const b = grid[c1][s0][k] * (1 - ts) + grid[c1][s1][k] * ts;
    return a * (1 - tc) + b * tc;
  });
}

export const atDepth = (m: SlabModel, values: number[], depth: number) =>
  interp(m.fast_charge.depth, values, depth);

export interface State {
  strain: number;
  porosity: number;
  thicknessUm: number;
  potentialV: number;
  localFill: number[];
  /** C-rate actually flowing (CC-CV tapers it near full). */
  current: number;
  margin: number[];
  xSi: number;
  xGr: number;
  capacity: [number, number];
  crackedShare: number;
  deadShare: number;
  seiNmSi: number;
  seiNmGr: number;
}

export function state(m: SlabModel, soc: number, cRate: number, cycles: number): State {
  const { charge, ageing } = m;
  const strain = interp(charge.soc, charge.thickness_strain, soc);
  const irreversible = interp(ageing.cycles, ageing.thickness_irreversible, cycles);
  return {
    strain: strain + irreversible,
    porosity: interp(charge.soc, charge.porosity, soc),
    thicknessUm: m.box_um[1] * (1 + strain + irreversible),
    potentialV: interp(charge.soc, charge.u_anode_v, soc),
    localFill: profile(m, m.fast_charge.local_fill, cRate, soc),
    current: soc >= 0.999 ? 0 : cRate * interp(charge.soc, charge.current_taper, soc),
    margin: profile(m, m.fast_charge.plating_margin_v, cRate, soc),
    xSi: interp(charge.soc, charge.x_si, soc),
    xGr: interp(charge.soc, charge.x_gr, soc),
    capacity: [interp(ageing.cycles, ageing.capacity_low, cycles), interp(ageing.cycles, ageing.capacity_high, cycles)],
    crackedShare: interp(ageing.cycles, ageing.cracked_si_share, cycles),
    deadShare: interp(ageing.cycles, ageing.dead_si_share, cycles),
    seiNmSi: interp(ageing.cycles, ageing.sei_nm_si, cycles),
    seiNmGr: interp(ageing.cycles, ageing.sei_nm_graphite, cycles),
  };
}
