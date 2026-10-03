"""Indicative 3D anode slab for web/slab.html: a particle packing that hits one batch's measured 2D
fractions, plus textbook electrochemistry for its charge, fast-charge and ageing sliders.

An illustration driven by measured statistics. Not a 3D reconstruction (we only have 2D sections), not
a cell simulation, and never an input to a verdict. Every constant is listed in ASSUMPTIONS with its
source; the UI shows them next to the picture.

Usage: uv run python -m qc.slab Batch_3 [--image <image_id>]
"""

import argparse
import base64
import json
import zlib
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd
import tifffile
from scipy.spatial import ConvexHull

from qc.io import EDGE_CROP_PX, field_paths
from qc.schema import KPI_TABLE, PARTICLE_TABLE, load_config

BOX_UM = (60.0, 50.0, 30.0)  # x along the section, y through the electrode (0 = current collector), z depth
VOXEL_UM = 0.5
PORE_VOXEL_UM = 1.0
SI_PAD_UM = 3.0
BASELINE_TRUE_POROSITY = 0.30
GRADIENT_SCALE = 7.0

SI_Q_MAH_G, SIOX_Q_MAH_G, GR_Q_MAH_G = 3579.0, 1500.0, 372.0
SI_RHO, GR_RHO = 2.33, 2.26
SI_EXPANSION, GR_EXPANSION = 2.80, 0.10
SI_CRITICAL_D_UM = 0.87
D_ELECTROLYTE = 3e-10  # m^2/s
D_SI = 1e-14  # m^2/s
BRUGGEMAN = 1.5
ETA_PER_C = 0.015  # V of kinetic overpotential per C
POROSITY_FLOOR = 0.03
NP_RATIO = 1.1  # anode capacity over cathode capacity
CV_FROM_SOC, CV_END_CURRENT = 0.8, 0.05  # CC-CV: constant current to 80%, then tapering to 5%
PORE_ABSORPTION = (0.3, 0.5, 0.7)  # low, central, high share of particle swelling taken up by pores
FLAKE_SEMI_AXIS_UM, FLAKE_ASPECT, FLAKE_TILT_DEG = 9.0, 2.6, 18.0
FLAKE_OVERLAP = (0.2, 0.9)  # share of a new flake allowed inside existing solid: start, cap

# Graphite flakes are angular: icosahedra (the vertex set of three.js IcosahedronGeometry, which draws them)
# scaled to the volume of the unit sphere, then stretched to the flake's semi-axes.
_T = (1 + 5 ** 0.5) / 2
_ICO = np.array([[-1, _T, 0], [1, _T, 0], [-1, -_T, 0], [1, -_T, 0], [0, -1, _T], [0, 1, _T], [0, -1, -_T],
                 [0, 1, -_T], [_T, 0, -1], [_T, 0, 1], [-_T, 0, -1], [-_T, 0, 1]]) / np.sqrt(1 + _T ** 2)
_HULL = ConvexHull(_ICO)
ICO_NORMALS = _HULL.equations[:, :3]
ICO_SCALE = (4 / 3 * np.pi / _HULL.volume) ** (1 / 3)
ICO_INNER = float(-_HULL.equations[0, 3]) * ICO_SCALE  # inradius after scaling to unit-sphere volume

ASSUMPTIONS = [
    {"name": "Area fraction = volume fraction", "value": "Si share of the solid, from the 2D section",
     "source": "Delesse principle (stereology); exact for isotropic random sections"},
    {"name": "True porosity", "value": f"baseline anchored at {BASELINE_TRUE_POROSITY:.0%}; each batch scaled by its apparent porosity over the baseline's",
     "source": "Assumed; calendered graphite anodes are typically 25-35%. The 2D apparent value (~10%) under-counts: open pores show their back wall"},
    {"name": "Si sizes", "value": "measured particle diameters x 4/pi, drawn with weight 1/d",
     "source": "First-order Wicksell correction for spheres: a plane hits big spheres more often and cuts them below their equator"},
    {"name": "Graphite flakes", "value": f"angular plates, semi-axis ~{FLAKE_SEMI_AXIS_UM:.0f} um, aspect {FLAKE_ASPECT}, tilt sd {FLAKE_TILT_DEG:.0f} deg; overlap only once nothing else fits",
     "source": "Assumed from the images (flakes ~10-35 um lying flat); not fitted to graphite_chord_um"},
    {"name": "Electrode", "value": f"{BOX_UM[1]:.0f} um thick, collector to separator",
     "source": "Assumed; typical anode coating 40-80 um. Our sections do not show the full thickness"},
    {"name": "Specific capacity", "value": f"Si {SI_Q_MAH_G:.0f} mAh/g (Li15Si4), SiOx ~{SIOX_Q_MAH_G:.0f}, graphite {GR_Q_MAH_G:.0f} (LiC6)",
     "source": "Obrovac & Chevrier, Chem. Rev. 2014"},
    {"name": "Volume expansion", "value": f"Si +{SI_EXPANSION:.0%} (radius x {(1 + SI_EXPANSION) ** (1 / 3):.2f}), graphite +{GR_EXPANSION:.0%} along c",
     "source": "Obrovac & Christensen 2004; graphite interlayer 3.35 -> 3.70 A"},
    {"name": "Equilibrium potentials", "value": "a-Si sloping 0.6 -> 0 V; graphite staging plateaus ~0.21, 0.12, 0.085 V",
     "source": "Textbook lithiation curves; blend shares one potential, so Si lithiates first"},
    {"name": "Graphite colour", "value": "grey -> blue (stage 3/4) -> red (LiC12) -> gold (LiC6), switching flake by flake",
     "source": "Operando optical microscopy, Harris et al., Chem. Phys. Lett. 2010. Two-phase plateaus: the share of flakes in the new stage follows the lever rule"},
    {"name": "Pore absorption", "value": f"{PORE_ABSORPTION[1]:.0%} of swelling fills pores ({PORE_ABSORPTION[0]:.0%}-{PORE_ABSORPTION[2]:.0%}), floor {POROSITY_FLOOR:.0%}",
     "source": "Assumed; the rest thickens the electrode"},
    {"name": "Ion transport", "value": f"D_eff = D * porosity^{BRUGGEMAN}, D = {D_ELECTROLYTE:.0e} m2/s",
     "source": "Bruggeman relation; LiPF6 in carbonates"},
    {"name": "Through-thickness gradient", "value": f"slope = {GRADIENT_SCALE:g} L^2 / (D_eff t_charge), capped at 1.5",
     "source": "Qualitative: fast charge lithiates the separator side first (Harris 2010). Scale set so the baseline plates near 3C, typical for a 50 um graphite-rich anode at room temperature"},
    {"name": "N/P ratio", "value": f"{NP_RATIO}: a full cell leaves the anode {1 / NP_RATIO:.0%} lithiated on average",
     "source": "Assumed; typical design margin of anode over cathode capacity, against plating"},
    {"name": "Charging protocol", "value": f"CC-CV: constant current to {CV_FROM_SOC:.0%}, then tapering to {CV_END_CURRENT:.0%} at full",
     "source": "Standard Li-ion charging; the plating onset is quoted for constant current to 80%"},
    {"name": "Lithium plating", "value": f"where local potential - {ETA_PER_C * 1000:.0f} mV per C < 0 V vs Li",
     "source": "Thermodynamic criterion with an assumed kinetic overpotential"},
    {"name": "Si fracture", "value": f"particles above {SI_CRITICAL_D_UM} um crack; sooner when larger, later when porous",
     "source": "McDowell et al., Nano Lett. 2013 (a-Si critical size ~870 nm); onset cycles are a scenario"},
    {"name": "Particle stress", "value": f"index = R^2 / (D_Si t_charge), D_Si = {D_SI:.0e} m2/s",
     "source": "Diffusion-induced stress scales with particle diffusion time over charge time"},
    {"name": "Ageing", "value": "SEI ~ sqrt(cycles), faster on Si; cracked Si may lose contact",
     "source": "Scenario band, not a lifetime prediction: no cycling data exists for these batches"},
]

U_GRID = np.linspace(0.0005, 0.8, 4000)
GR_OCV = (np.array([0, .03, .08, .2, .25, .5, .55, .95, .99, 1]),
          np.array([.8, .3, .22, .20, .13, .115, .09, .08, .04, .0]))
SI_OCV = (np.array([0, .05, .2, .4, .6, .8, .95, 1]), np.array([.6, .4, .28, .22, .15, .09, .05, .0]))
SOC = np.linspace(0, 1, 41)  # cell state of charge
FILL = np.linspace(0, 1, 41)  # anode lithiation, 0..1 of its own capacity
DEPTH = np.linspace(0, 1, 11)  # 0 = separator side
C_RATES = np.array([0.25, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8])
CYCLES = np.array([0, 1, 2, 5, 10, 20, 50, 100, 200, 300, 500, 700, 1000])


def lithiation(u: np.ndarray, ocv: tuple[np.ndarray, np.ndarray]) -> np.ndarray:
    x, volts = ocv
    return np.interp(-u, -volts, x)


def true_fractions(si_area: float, porosity_apparent: float, baseline_apparent: float) -> tuple[float, float, float]:
    """(Si, graphite, pore) volume fractions. The 2D 'apparent' porosity under-counts pores (open pores show
    their back wall), so the baseline is anchored at a typical true porosity and each batch keeps its measured
    ratio to it. Si keeps its measured share of the solid."""
    porosity = float(np.clip(BASELINE_TRUE_POROSITY * porosity_apparent / baseline_apparent, 0.05, 0.6))
    si_share = si_area / max(1 - porosity_apparent, 1e-6)
    return si_share * (1 - porosity), (1 - si_share) * (1 - porosity), porosity


def capacity_share(si_frac: float, gr_frac: float, si_q: float = SI_Q_MAH_G) -> float:
    q_si, q_gr = si_frac * SI_RHO * si_q, gr_frac * GR_RHO * GR_Q_MAH_G
    return q_si / (q_si + q_gr)


def blend(share: float, fill: np.ndarray = FILL) -> dict[str, np.ndarray]:
    """Si and graphite at one shared potential: fill = s x_Si(U) + (1 - s) x_gr(U), solved on a fine U grid."""
    fill_of_u = share * lithiation(U_GRID, SI_OCV) + (1 - share) * lithiation(U_GRID, GR_OCV)
    u = np.interp(fill, fill_of_u[::-1], U_GRID[::-1])
    return {"u": u, "x_si": lithiation(u, SI_OCV), "x_gr": lithiation(u, GR_OCV)}


def swelling(si_frac: float, gr_frac: float, porosity: float, si_void: float, x_si: np.ndarray,
             x_gr: np.ndarray, absorption: float) -> tuple[np.ndarray, np.ndarray]:
    """(thickness strain, porosity) along the charge. Internal Si voids take up their own share first."""
    d_si = np.maximum(0.0, (1 - si_void) * SI_EXPANSION * x_si - si_void) / (1 - si_void)
    grow = si_frac * d_si + gr_frac * GR_EXPANSION * x_gr
    into_pores = np.minimum(absorption * grow, max(porosity - POROSITY_FLOOR, 0.0))
    strain = grow - into_pores
    return strain, (porosity - into_pores) / (1 + strain)


def local_fill(soc: np.ndarray, slope: np.ndarray) -> np.ndarray:
    """Linear anode-fill profile through the thickness (last axis), separator side ahead, clipped to [0, 1], mean kept."""
    soc, slope = np.broadcast_arrays(np.asarray(soc, float), np.asarray(slope, float))
    ramp = soc[..., None] + slope[..., None] * (0.5 - DEPTH)
    lo, hi = np.full(soc.shape, -1.0), np.full(soc.shape, 1.0)
    for _ in range(40):
        mid = (lo + hi) / 2
        low = np.clip(ramp + mid[..., None], 0, 1).mean(-1) < soc
        lo, hi = np.where(low, mid, lo), np.where(low, hi, mid)
    return np.clip(ramp + ((lo + hi) / 2)[..., None], 0, 1)


def gradient(c_rate: np.ndarray, porosity: np.ndarray) -> np.ndarray:
    """Through-thickness SOC slope: electrolyte diffusion time over charge time, capped."""
    return np.minimum(1.5, GRADIENT_SCALE * (BOX_UM[1] * 1e-6) ** 2 * c_rate
                      / (D_ELECTROLYTE * porosity ** BRUGGEMAN * 3600))


def current_taper(soc: np.ndarray) -> np.ndarray:
    """Share of the nominal C-rate flowing at each cell SOC under CC-CV charging."""
    return np.clip(1 - (1 - CV_END_CURRENT) * (soc - CV_FROM_SOC) / (1 - CV_FROM_SOC), CV_END_CURRENT, 1.0)


def fast_charge(anode_u: np.ndarray, porosity: np.ndarray) -> dict:
    """On the cell SOC grid, per C-rate: anode fill at each depth, and its margin to 0 V vs Li after overpotential."""
    current = C_RATES[:, None] * current_taper(SOC)[None, :]
    slope = gradient(current, porosity[None, :])
    local = local_fill(SOC[None, :] / NP_RATIO, slope)
    margin = np.interp(local, FILL, anode_u) - ETA_PER_C * current[..., None]
    return {"c_rates": C_RATES.tolist(), "depth": DEPTH.tolist(), "slope": slope.round(4).tolist(),
            "local_fill": local.round(4).tolist(), "plating_margin_v": margin.round(4).tolist()}


def plating_onset_c(anode_u: np.ndarray, porosity: np.ndarray, soc_limit: float = 0.8) -> float:
    """Lowest C-rate at which the separator side plates before the cell reaches soc_limit."""
    keep = SOC <= soc_limit + 1e-9
    c = np.arange(0.25, 10.01, 0.05)[:, None]
    front = local_fill(SOC[keep][None, :] / NP_RATIO, gradient(c, porosity[keep][None, :]))[..., 0]
    plates = (np.interp(front, FILL, anode_u) - ETA_PER_C * c < 0).any(1)
    return round(float(c[plates.argmax(), 0]), 2) if plates.any() else float("inf")


def physics(si_frac: float, gr_frac: float, porosity: float, si_void: float) -> dict:
    share = capacity_share(si_frac, gr_frac)
    anode, curve = blend(share), blend(share, SOC / NP_RATIO)
    strain, eps = swelling(si_frac, gr_frac, porosity, si_void, curve["x_si"], curve["x_gr"], PORE_ABSORPTION[1])
    return {"share": share, "anode": anode, "curve": curve, "strain": strain, "porosity": eps,
            "strain_range": [swelling(si_frac, gr_frac, porosity, si_void, curve["x_si"][-1:], curve["x_gr"][-1:], a)[0][0]
                             for a in (PORE_ABSORPTION[2], PORE_ABSORPTION[0])]}


def indicators(si_frac: float, gr_frac: float, porosity: float, si_void: float, prone_share: float) -> dict[str, float]:
    p = physics(si_frac, gr_frac, porosity, si_void)
    return {"si_capacity_share": p["share"], "thickness_swell_full": float(p["strain"][-1]),
            "porosity_full": float(p["porosity"][-1]),
            "transport_full_vs_empty": float((p["porosity"][-1] / porosity) ** BRUGGEMAN),
            "plating_onset_c": plating_onset_c(p["anode"]["u"], p["porosity"]),
            "fracture_prone_si_share": prone_share}


def si_sizes(particles: pd.DataFrame, target_um3: float, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray]:
    """3D diameters and void fractions drawn from measured 2D particles until the Si volume is reached."""
    whole = particles[~particles["border"].astype(bool)] if "border" in particles else particles
    d2 = whole["d_um"].to_numpy(float)
    voids = whole["void_frac"].fillna(0).to_numpy(float) if "void_frac" in whole else np.zeros_like(d2)
    weights = 1 / d2 / (1 / d2).sum()
    picked, total = [], 0.0
    while total < target_um3:
        i = rng.choice(len(d2), p=weights)
        d = min(d2[i] * 4 / np.pi, 12.0)
        picked.append((d, voids[i]))
        total += np.pi / 6 * d ** 3
    out = np.array(picked)
    return out[:, 0], out[:, 1]


def place_silicon(diam: np.ndarray, agglomerated: float, corr_um: float, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray]:
    """Centres for the Si spheres: a share in clusters of about the correlation length, the rest dispersed, no overlaps."""
    box = np.array(BOX_UM)
    order = np.argsort(-diam)
    clustered = rng.random(len(diam)) < agglomerated
    cluster_r = max(3.0, 2 * corr_um)
    n_clusters = max(1, round(float((np.pi / 6 * diam[clustered] ** 3).sum()) / (0.35 * 4 / 3 * np.pi * cluster_r ** 3)))
    lo, hi = -SI_PAD_UM, box + SI_PAD_UM
    centres_cl = lo + rng.random((n_clusters, 3)) * (hi - lo)
    pos = np.full((len(diam), 3), np.nan)
    for i in order:
        r = diam[i] / 2
        for attempt in range(400):
            if clustered[i] and attempt < 200:
                c = np.clip(centres_cl[rng.integers(n_clusters)] + rng.normal(0, cluster_r / 2, 3), lo, hi)
            else:
                c = lo + rng.random(3) * (hi - lo)
            placed = ~np.isnan(pos[:, 0])
            if not placed.any() or (np.linalg.norm(pos[placed] - c, axis=1) >= 0.95 * (diam[placed] / 2 + r)).all():
                pos[i] = c
                break
    return pos, clustered


def rotation(yaw: float, tilt: float) -> np.ndarray:
    cy, sy, ct, st = np.cos(yaw), np.sin(yaw), np.cos(tilt), np.sin(tilt)
    ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    rx = np.array([[1, 0, 0], [0, ct, -st], [0, st, ct]])
    return ry @ rx  # flake local axes: x, z in-plane, y = short c-axis (through the electrode)


def quaternion(m: np.ndarray) -> list[float]:
    w = np.sqrt(max(0.0, 1 + m[0, 0] + m[1, 1] + m[2, 2])) / 2
    x = np.copysign(np.sqrt(max(0.0, 1 + m[0, 0] - m[1, 1] - m[2, 2])) / 2, m[2, 1] - m[1, 2])
    y = np.copysign(np.sqrt(max(0.0, 1 - m[0, 0] + m[1, 1] - m[2, 2])) / 2, m[0, 2] - m[2, 0])
    z = np.copysign(np.sqrt(max(0.0, 1 - m[0, 0] - m[1, 1] + m[2, 2])) / 2, m[1, 0] - m[0, 1])
    return [float(x), float(y), float(z), float(w)]


def grid_window(centre: np.ndarray, half: np.ndarray, shape: tuple[int, ...]) -> tuple[tuple[slice, ...], np.ndarray]:
    lo = np.maximum(np.floor((centre - half) / VOXEL_UM).astype(int), 0)
    hi = np.minimum(np.ceil((centre + half) / VOXEL_UM).astype(int), shape)
    if (hi <= lo).any():
        return (), np.empty((0, 3))
    axes = [(np.arange(a, b) + 0.5) * VOXEL_UM for a, b in zip(lo, hi)]
    pts = np.stack(np.meshgrid(*axes, indexing="ij"), -1)
    return tuple(slice(a, b) for a, b in zip(lo, hi)), pts


def flake_inside(pts: np.ndarray, centre: np.ndarray, rot: np.ndarray, axes: np.ndarray) -> np.ndarray:
    local = ((pts - centre) @ rot) / axes
    return (local @ ICO_NORMALS.T).max(-1) <= ICO_INNER


def pack(target: dict[str, float], particles: pd.DataFrame, seed: int) -> dict:
    """Si spheres placed first (clustered as measured), then graphite flakes added until the pore fraction is reached."""
    rng = np.random.default_rng(seed)
    box = np.array(BOX_UM)
    shape = tuple(int(round(b / VOXEL_UM)) for b in BOX_UM)
    label = np.zeros(shape, np.uint8)  # 0 pore, 1 graphite, 2 Si
    diam, voids = si_sizes(particles, target["si_frac"] * (box + 2 * SI_PAD_UM).prod(), rng)
    si_pos, clustered = place_silicon(diam, target["agglomerated"], target["corr_um"], rng)
    ok = ~np.isnan(si_pos[:, 0])
    ok[ok] = (np.abs(si_pos[ok] - box / 2) < box / 2 + diam[ok, None] / 2).all(1)
    diam, voids, si_pos, clustered = diam[ok], voids[ok], si_pos[ok], clustered[ok]
    owner = np.full(shape, -1, np.int32)
    for i, (c, d) in enumerate(zip(si_pos, diam)):
        window, pts = grid_window(c, np.full(3, d / 2), shape)
        if window:
            owner[window][np.linalg.norm(pts - c, axis=-1) <= d / 2] = i
    counts = np.bincount(owner[owner >= 0], minlength=len(diam))
    excess = counts.sum() - target["si_frac"] * label.size
    keep = np.ones(len(diam), bool)
    for i in rng.permutation(len(diam)):  # sampling overshoot from a few large particles: drop at random
        if excess <= counts[i] / 2:
            break
        keep[i], excess = False, excess - counts[i]
    label[np.isin(owner, np.flatnonzero(keep))] = 2
    diam, voids, si_pos, clustered = diam[keep], voids[keep], si_pos[keep], clustered[keep]
    pore_target = target["porosity"] * label.size
    pores = int((label == 0).sum())
    # Random sequential addition with a growing overlap allowance: flakes first fill free space and only
    # interpenetrate (as calendering presses them together) once nothing else fits.
    flakes, attempts, misses, allowed = [], 0, 0, FLAKE_OVERLAP[0]
    while pores > pore_target and attempts < 40000:
        attempts += 1
        if misses > 150:
            allowed, misses = min(allowed + 0.05, FLAKE_OVERLAP[1]), 0
        a = FLAKE_SEMI_AXIS_UM * np.exp(rng.normal(0, 0.3))
        axes = np.array([a, a / FLAKE_ASPECT * np.exp(rng.normal(0, 0.15)), a * rng.uniform(0.6, 1.0)])
        rot = rotation(rng.uniform(0, np.pi), np.radians(rng.normal(0, FLAKE_TILT_DEG)))
        centre = rng.random(3) * (box + a) - a / 2
        half = np.sqrt(((rot * axes) ** 2).sum(1)) * ICO_SCALE
        window, pts = grid_window(centre, half, shape)
        misses += 1
        if not window:
            continue
        sub = label[window]
        coarse, sub_coarse = pts[::2, ::2, ::2], sub[::2, ::2, ::2]
        inside = flake_inside(coarse, centre, rot, axes)
        n_inside = int(inside.sum())
        n_free = int((inside & (sub_coarse == 0)).sum())
        if not n_free or (inside & (sub_coarse == 2)).sum() > 0.02 * n_inside or n_free < (1 - allowed) * n_inside:
            continue
        fill = flake_inside(pts, centre, rot, axes) & (sub == 0)
        sub[fill] = 1
        pores -= int(fill.sum())
        misses = 0
        flakes.append([*centre, *axes, *quaternion(rot)])
    fractions = {k: float((label == v).mean()) for k, v in (("porosity", 0), ("graphite_frac", 1), ("si_frac", 2))}
    return {"label": label, "flakes": np.array(flakes), "si_pos": si_pos, "si_d": diam, "si_void": voids,
            "clustered": clustered, "achieved": fractions}


def pore_bits(label: np.ndarray) -> dict:
    k = int(round(PORE_VOXEL_UM / VOXEL_UM))
    nx, ny, nz = (s // k for s in label.shape)
    coarse = (label[:nx * k, :ny * k, :nz * k] == 0).reshape(nx, k, ny, k, nz, k).mean((1, 3, 5)) >= 0.5
    return {"shape": [nx, ny, nz], "voxel_um": PORE_VOXEL_UM, "order": "x-major (index = (ix * ny + iy) * nz + iz)",
            "bits": base64.b64encode(zlib.compress(np.packbits(coarse.ravel()).tobytes())).decode()}


def ageing(si_d: np.ndarray, si_void: np.ndarray, share: float, si_frac: float, rng: np.random.Generator) -> tuple[dict, np.ndarray, np.ndarray]:
    """Scenario: when each Si particle cracks and whether/when it loses contact; SEI and the capacity band."""
    prone = si_d > SI_CRITICAL_D_UM
    onset = 400 * (SI_CRITICAL_D_UM / si_d) ** 2 * (1 + 20 * si_void) * np.exp(rng.normal(0, 0.5, len(si_d)))
    crack = np.where(prone, np.maximum(1, onset), -1)
    dies = prone & (rng.random(len(si_d)) < 0.5)
    dead = np.where(dies, crack + 600 * np.exp(rng.normal(0, 0.7, len(si_d))), -1)
    vol = si_d ** 3
    cracked_share = np.array([(vol * ((crack >= 0) & (crack <= n))).sum() / vol.sum() for n in CYCLES])
    dead_share = np.array([(vol * ((dead >= 0) & (dead <= n))).sum() / vol.sum() for n in CYCLES])
    root = np.sqrt(CYCLES)
    lli = np.outer([0.0015, 0.003], root) * (1 + 2 * share)
    capacity = 1 - lli - share * dead_share
    return {
        "cycles": CYCLES.tolist(), "capacity_high": capacity[0].round(4).tolist(),
        "capacity_low": capacity[1].round(4).tolist(),
        "sei_nm_graphite": (5 + 0.8 * root).round(2).tolist(), "sei_nm_si": (5 + 2.5 * root).round(2).tolist(),
        "cracked_si_share": cracked_share.round(4).tolist(), "dead_si_share": dead_share.round(4).tolist(),
        "thickness_irreversible": (0.5 * si_frac * cracked_share).round(5).tolist(),
    }, crack, dead


def representative(rows: pd.DataFrame) -> str:
    cols = ["si_area_frac", "porosity_apparent", "si_d50_um", "si_agglomerate_frac"]
    z = (rows[cols] - rows[cols].median()) / rows[cols].std(ddof=0).replace(0, 1)
    return str(rows.iloc[int(np.argmin((z ** 2).sum(axis=1).to_numpy()))]["image_id"])


def section(batch: str, image_id: str, px_um: float) -> dict | None:
    """Size of the real image in um and the crop matching the slab's front face, for the textured overlay."""
    folder = Path(load_config()["data_dir"]) / batch
    paths = field_paths(folder).get(image_id, {}) if folder.is_dir() else {}
    path = paths.get("BSE") or next(iter(paths.values()), None)
    if path is None or not np.isfinite(px_um):
        return None
    with tifffile.TiffFile(path) as tif:
        h, w = tif.pages[0].shape[:2]
    width, height = (w - 2 * EDGE_CROP_PX) * px_um, h * px_um
    cw, ch = min(BOX_UM[0], width), min(BOX_UM[1], height)
    u0, v0 = (width - cw) / 2 / width, (height - ch) / 2 / height
    return {"image_id": image_id, "detector": "BSE" if "BSE" in paths else next(iter(paths)),
            "width_um": width, "height_um": height, "u": [u0, u0 + cw / width], "v": [v0, v0 + ch / height]}


def summary(values: list[float]) -> dict:
    arr = np.array([v for v in values if np.isfinite(v)])
    return {"range": [float(np.percentile(arr, 10)), float(np.percentile(arr, 90))] if len(arr) else None}


@lru_cache(maxsize=16)
def _build(batch: str, image_id: str | None, stamp: tuple) -> dict:
    kpis = pd.read_csv(KPI_TABLE)
    particles = pd.read_csv(PARTICLE_TABLE) if PARTICLE_TABLE.exists() else pd.DataFrame()
    rows = kpis[kpis["batch"] == batch]
    if image_id is not None:
        rows = rows[rows["image_id"] == image_id]
    if rows.empty:
        raise KeyError(f"no KPI rows for {batch}" + (f"/{image_id}" if image_id else ""))
    parts = particles[(particles["batch"] == batch) & particles["image_id"].isin(rows["image_id"])] \
        if not particles.empty else particles
    if parts.empty:
        raise KeyError(f"no particle rows for {batch}")
    med = rows.median(numeric_only=True)
    baseline = kpis[kpis["batch"] == load_config().get("baseline")]["porosity_apparent"].median()
    baseline_apparent = float(baseline) if np.isfinite(baseline) else float(med["porosity_apparent"])
    si, gr, eps = true_fractions(float(med["si_area_frac"]), float(med["porosity_apparent"]), baseline_apparent)
    target = {"si_frac": si, "graphite_frac": gr, "porosity": eps,
              "porosity_apparent": float(med["porosity_apparent"]), "baseline_porosity_apparent": baseline_apparent,
              "agglomerated": float(np.clip(med.get("si_agglomerate_frac", 0.4), 0, 1)),
              "corr_um": float(med.get("si_corr_length_um", 1.7))}
    seed = zlib.crc32(f"{batch}/{image_id}".encode())
    packed = pack(target, parts, seed)
    si_d, si_void = packed["si_d"], packed["si_void"]
    vol = si_d ** 3
    si_void_mean = float((vol * si_void).sum() / vol.sum())
    prone_share = float((vol * (si_d > SI_CRITICAL_D_UM)).sum() / vol.sum())
    phys = physics(target["si_frac"], target["graphite_frac"], target["porosity"], si_void_mean)
    aging, crack, dead = ageing(si_d, si_void, phys["share"], target["si_frac"], np.random.default_rng(seed + 1))

    per_image = []
    for row in rows.itertuples():
        own = parts[parts["image_id"] == row.image_id]
        d3 = own["d_um"].to_numpy(float) * 4 / np.pi
        w = d3 ** 2  # volume-weight of a 1/d-weighted sample: d^3 / d
        prone = float((w * (d3 > SI_CRITICAL_D_UM)).sum() / w.sum()) if len(d3) else np.nan
        voids = own["void_frac"].fillna(0).to_numpy(float)
        void = float((w * voids).sum() / w.sum()) if len(d3) else 0.0
        per_image.append(indicators(*true_fractions(row.si_area_frac, row.porosity_apparent, baseline_apparent),
                                    void, prone))
    central = indicators(target["si_frac"], target["graphite_frac"], target["porosity"], si_void_mean, prone_share)
    meta = {
        "si_capacity_share": ("Silicon share of the capacity", "fraction", "phi_Si rho_Si q_Si / (phi_Si rho_Si q_Si + phi_gr rho_gr q_gr)"),
        "thickness_swell_full": ("Electrode thickening at full charge", "fraction", "phi_Si 2.8 x_Si + phi_gr 0.10 x_gr, minus what the pores absorb"),
        "porosity_full": ("Porosity at full charge", "fraction", "(porosity - absorbed swelling) / (1 + thickening)"),
        "transport_full_vs_empty": ("Ion transport at full vs empty", "ratio", "(porosity_full / porosity)^1.5 (Bruggeman)"),
        "plating_onset_c": ("Plating onset (charge to 80%)", "C", "lowest C at which the separator side drops below 0 V vs Li"),
        "fracture_prone_si_share": ("Fracture-prone silicon", "fraction of Si volume", f"particles larger than {SI_CRITICAL_D_UM} um"),
    }
    out_indicators = {key: {"label": label, "unit": unit, "formula": formula,
                            "value": central[key] if np.isfinite(central[key]) else None,
                            **summary([p[key] for p in per_image])}
                      for key, (label, unit, formula) in meta.items()}
    out_indicators["si_capacity_share"]["siox_value"] = capacity_share(target["si_frac"], target["graphite_frac"], SIOX_Q_MAH_G)
    out_indicators["thickness_swell_full"]["assumption_range"] = phys["strain_range"]

    rep = image_id or representative(rows)
    rep_row = rows[rows["image_id"] == rep].iloc[0]
    flakes = packed["flakes"]
    return {
        "batch": batch, "image_id": image_id, "n_images": int(len(rows)), "n_particles_measured": int(len(parts)),
        "label": "Indicative illustration driven by measured 2D statistics. Not a 3D reconstruction, not a cell simulation.",
        "box_um": list(BOX_UM), "voxel_um": VOXEL_UM,
        "targets": target,
        "achieved": packed["achieved"],
        "si_d50_um_2d": float(med["si_d50_um"]), "si_d50_um_3d_volume": float(np.interp(0.5, np.cumsum(np.sort(si_d) ** 3) / (si_d ** 3).sum(), np.sort(si_d))),
        "section": section(batch, rep, float(rep_row["px_um"])),
        "constants": {"si_expansion": SI_EXPANSION, "graphite_expansion": GR_EXPANSION,
                      "si_critical_d_um": SI_CRITICAL_D_UM, "stress_reference_s": 3600.0, "d_si_m2_s": D_SI},
        "graphite": np.round(flakes, 3).tolist(),
        "graphite_columns": ["x", "y", "z", "sx", "sy", "sz", "qx", "qy", "qz", "qw"],
        "silicon": np.column_stack([np.round(packed["si_pos"], 3), np.round(si_d / 2, 3), np.round(si_void, 4),
                                    np.round(crack, 1), np.round(dead, 1), packed["clustered"].astype(int)]).tolist(),
        "silicon_columns": ["x", "y", "z", "r", "void_frac", "crack_cycle", "dead_cycle", "clustered"],
        "pores": pore_bits(packed["label"]),
        "np_ratio": NP_RATIO,
        "anode": {"fill": FILL.round(4).tolist(), "u_v": phys["anode"]["u"].round(4).tolist(),
                  "x_si": phys["anode"]["x_si"].round(4).tolist(), "x_gr": phys["anode"]["x_gr"].round(4).tolist()},
        "charge": {"soc": SOC.round(4).tolist(), "current_taper": current_taper(SOC).round(4).tolist(),
                   "u_anode_v": phys["curve"]["u"].round(4).tolist(),
                   "x_si": phys["curve"]["x_si"].round(4).tolist(), "x_gr": phys["curve"]["x_gr"].round(4).tolist(),
                   "thickness_strain": phys["strain"].round(4).tolist(), "porosity": phys["porosity"].round(4).tolist()},
        "fast_charge": fast_charge(phys["anode"]["u"], phys["porosity"]),
        "ageing": aging,
        "indicators": out_indicators,
        "assumptions": ASSUMPTIONS,
    }


def build(batch: str, image_id: str | None = None) -> dict:
    stamp = (str(Path.cwd()), *(p.stat().st_mtime if p.exists() else 0.0 for p in (KPI_TABLE, PARTICLE_TABLE)))
    return _build(batch, image_id, stamp)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("batch")
    parser.add_argument("--image")
    args = parser.parse_args()
    result = build(args.batch, args.image)
    print(json.dumps({k: result[k] for k in ("batch", "targets", "achieved", "si_d50_um_2d", "si_d50_um_3d_volume")}
                     | {"n_flakes": len(result["graphite"]), "n_si": len(result["silicon"])}
                     | {k: {"value": v["value"], "range": v["range"]} for k, v in result["indicators"].items()},
                     indent=2, default=float))


if __name__ == "__main__":
    main()
