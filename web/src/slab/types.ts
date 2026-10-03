/** GET /api/slab/{batch} (qc/slab.py). Arrays are row-major in the order of the *_columns fields. */
export interface Indicator {
  label: string;
  unit: string;
  formula: string;
  value: number | null;
  range: [number, number] | null;
  siox_value?: number;
  assumption_range?: [number, number];
}

export interface Assumption {
  name: string;
  value: string;
  source: string;
}

export interface SlabModel {
  batch: string;
  image_id: string | null;
  n_images: number;
  n_particles_measured: number;
  label: string;
  box_um: [number, number, number];
  voxel_um: number;
  targets: {
    si_frac: number;
    graphite_frac: number;
    porosity: number;
    porosity_apparent: number;
    baseline_porosity_apparent: number;
    agglomerated: number;
    corr_um: number;
  };
  achieved: { si_frac: number; graphite_frac: number; porosity: number };
  si_d50_um_2d: number;
  si_d50_um_3d_volume: number;
  section: {
    image_id: string;
    detector: string;
    width_um: number;
    height_um: number;
    u: [number, number];
    v: [number, number];
  } | null;
  constants: {
    si_expansion: number;
    graphite_expansion: number;
    si_critical_d_um: number;
    stress_reference_s: number;
    d_si_m2_s: number;
  };
  graphite: number[][];
  silicon: number[][];
  pores: { shape: [number, number, number]; voxel_um: number; bits: string };
  np_ratio: number;
  /** Indexed by the anode's own lithiation (0..1); local lookups use these. */
  anode: { fill: number[]; u_v: number[]; x_si: number[]; x_gr: number[] };
  /** Indexed by the cell state of charge; the anode reaches 1 / np_ratio at a full cell. */
  charge: {
    soc: number[];
    current_taper: number[];
    u_anode_v: number[];
    x_si: number[];
    x_gr: number[];
    thickness_strain: number[];
    porosity: number[];
  };
  fast_charge: {
    c_rates: number[];
    depth: number[];
    slope: number[][];
    local_fill: number[][][];
    plating_margin_v: number[][][];
  };
  ageing: {
    cycles: number[];
    capacity_high: number[];
    capacity_low: number[];
    sei_nm_graphite: number[];
    sei_nm_si: number[];
    cracked_si_share: number[];
    dead_si_share: number[];
    thickness_irreversible: number[];
  };
  indicators: Record<string, Indicator>;
  assumptions: Assumption[];
}

/** What the sliders set. Everything the scene shows is derived from these and the model. */
export interface Drive {
  soc: number;
  cRate: number;
  cycles: number;
  sliceUm: number;
  showIons: boolean;
  showSection: boolean;
}
