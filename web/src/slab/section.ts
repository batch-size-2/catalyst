import * as THREE from "three";
import { COLORS } from "./materials";

/** Everything needed to draw one particle, in slab coordinates (µm, y already swollen). */
export interface Flake {
  c: THREE.Vector3;
  inv: THREE.Matrix3; // world offset -> flake-local coordinates divided by the semi-axes
  half: THREE.Vector3; // axis-aligned half extents of the (scaled) icosahedron
  shade: number; // per-flake brightness, so neighbouring flakes read apart as in the SEM
  color: THREE.Color;
}

export interface Grain {
  c: THREE.Vector3;
  r: number; // circumradius of the icosahedron
  q: THREE.Quaternion;
  core: number;
  voidR: number;
  rim: number;
  glow: number;
  dead: boolean;
}

export type Face = "front" | "top" | "left" | "right";

export const FACE_RES_UM = 0.2;

/** Milled silicon and graphite flakes are angular: icosahedra with the volume of the sphere or ellipsoid they
    stand for (qc/slab.py packs the same shape). */
const ICO = new THREE.IcosahedronGeometry(1, 0);
const ICO_NORMALS: THREE.Vector3[] = [];
for (let i = 0; i < ICO.attributes.position.count; i += 3) {
  const a = new THREE.Vector3().fromBufferAttribute(ICO.attributes.position, i);
  const b = new THREE.Vector3().fromBufferAttribute(ICO.attributes.position, i + 1);
  const c = new THREE.Vector3().fromBufferAttribute(ICO.attributes.position, i + 2);
  ICO_NORMALS.push(a.add(b).add(c).divideScalar(3));
}
const ICO_INRADIUS = ICO_NORMALS[0].length();
ICO_NORMALS.forEach((n) => n.normalize());
const ICO_VOLUME = ((5 * (3 + Math.sqrt(5))) / 12) * (4 / Math.sqrt(10 + 2 * Math.sqrt(5))) ** 3;
export const ICO_SCALE = Math.cbrt(((4 / 3) * Math.PI) / ICO_VOLUME);

/** Box faces as planes: a point on the face is origin + u * U + v * V. */
export function faceFrame(face: Face, W: number, H: number, Z: number) {
  const o = new THREE.Vector3(), U = new THREE.Vector3(), V = new THREE.Vector3();
  if (face === "front") { o.set(0, 0, Z); U.set(1, 0, 0); V.set(0, 1, 0); return { o, U, V, w: W, h: H }; }
  if (face === "top") { o.set(0, H, Z); U.set(1, 0, 0); V.set(0, 0, -1); return { o, U, V, w: W, h: Z }; }
  if (face === "left") { o.set(0, 0, 0); U.set(0, 0, 1); V.set(0, 1, 0); return { o, U, V, w: Z, h: H }; }
  o.set(W, 0, Z); U.set(0, 0, -1); V.set(0, 1, 0);
  return { o, U, V, w: Z, h: H };
}

const tmp = new THREE.Vector3();
const core = new THREE.Color(COLORS.siPristine), shell = new THREE.Color(COLORS.siLithiated);
const sei = new THREE.Color(COLORS.sei), voidColor = new THREE.Color(COLORS.void), deadColor = new THREE.Color(COLORS.siDead);
const hot = new THREE.Color(COLORS.siHot);
const mixed = new THREE.Color();
const K = ICO_NORMALS.length;
const A = new Float32Array(K), B = new Float32Array(K), C = new Float32Array(K);

/** Linear sRGB bytes of a colour scaled by k (one pow per particle, not per pixel). */
function bytes(c: THREE.Color, k = 1): [number, number, number] {
  const to = (x: number) => Math.round(Math.min(1, Math.max(0, x * k)) ** (1 / 2.2) * 255);
  return [to(c.r), to(c.g), to(c.b)];
}

/** Rasterise the section of the packing on one face into RGBA (sRGB) pixels; pores stay transparent.
    Along a face, each icosahedron's 20 face distances are linear in the pixel indices, so per pixel this is
    20 multiply-adds with an early exit as soon as one says "outside". */
export function rasterise(face: Face, W: number, H: number, Z: number, flakes: Flake[], grains: Grain[], data: Uint8Array, nu: number, nv: number) {
  const { o, U, V, w, h } = faceFrame(face, W, H, Z);
  const du = w / nu, dv = h / nv;
  data.fill(0);
  const normal = new THREE.Vector3().crossVectors(U, V);
  const window = (c: THREE.Vector3, ext: THREE.Vector3) => {
    tmp.subVectors(c, o);
    const dist = Math.abs(tmp.dot(normal));
    const eu = Math.abs(U.x) * ext.x + Math.abs(U.y) * ext.y + Math.abs(U.z) * ext.z;
    const ev = Math.abs(V.x) * ext.x + Math.abs(V.y) * ext.y + Math.abs(V.z) * ext.z;
    const en = Math.abs(normal.x) * ext.x + Math.abs(normal.y) * ext.y + Math.abs(normal.z) * ext.z;
    if (dist > en) return null;
    const cu = tmp.dot(U), cv = tmp.dot(V);
    return [Math.max(0, Math.floor((cu - eu) / du)), Math.min(nu - 1, Math.ceil((cu + eu) / du)),
      Math.max(0, Math.floor((cv - ev) / dv)), Math.min(nv - 1, Math.ceil((cv + ev) / dv))];
  };
  const p0 = new THREE.Vector3(), pu = new THREE.Vector3(), pv = new THREE.Vector3(), n = new THREE.Vector3();
  /** Fill A, B, C so that the k-th face distance at pixel (iu, iv) is (A + iu B + iv C) / scale. */
  const linearise = (centre: THREE.Vector3, map: (v: THREE.Vector3) => THREE.Vector3, normals: THREE.Vector3[], scale: number) => {
    map(p0.copy(o).sub(centre));
    map(pu.copy(U).multiplyScalar(du));
    map(pv.copy(V).multiplyScalar(dv));
    for (let k = 0; k < K; k++) {
      n.copy(normals[k]);
      B[k] = n.dot(pu) / scale;
      C[k] = n.dot(pv) / scale;
      A[k] = n.dot(p0) / scale + 0.5 * (B[k] + C[k]);
    }
  };
  const radius = (iu: number, iv: number) => {
    let r = 0;
    for (let k = 0; k < K; k++) {
      const d = A[k] + iu * B[k] + iv * C[k];
      if (d > 1) return 2;
      if (d > r) r = d;
    }
    return r;
  };
  const put = (i: number, c: [number, number, number]) => {
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
  };

  for (const f of flakes) {
    const win = window(f.c, f.half);
    if (!win) continue;
    linearise(f.c, (v) => v.applyMatrix3(f.inv), ICO_NORMALS, ICO_INRADIUS * ICO_SCALE);
    const body = bytes(f.color, f.shade), rim = bytes(f.color, f.shade * 0.5);
    for (let iv = win[2]; iv <= win[3]; iv++) {
      for (let iu = win[0]; iu <= win[1]; iu++) {
        const r = radius(iu, iv);
        if (r <= 1) put((iv * nu + iu) * 4, r > 0.93 ? rim : body);
      }
    }
  }
  const ext = new THREE.Vector3();
  const normals = ICO_NORMALS.map((v) => v.clone());
  const identity = (v: THREE.Vector3) => v;
  for (const g of grains) {
    const win = window(g.c, ext.setScalar(g.r));
    if (!win) continue;
    normals.forEach((v, k) => v.copy(ICO_NORMALS[k]).applyQuaternion(g.q));
    linearise(g.c, identity, normals, g.r * ICO_INRADIUS);
    const heat = g.dead ? 0 : g.glow * 0.8;
    const cCore = bytes(mixed.copy(core).lerp(hot, heat));
    const cShell = bytes(mixed.copy(shell).lerp(hot, heat));
    const cVoid = bytes(voidColor);
    const cDead = bytes(deadColor);
    const cRim = bytes(mixed.copy(g.dead ? deadColor : shell).lerp(sei, 0.8));
    for (let iv = win[2]; iv <= win[3]; iv++) {
      for (let iu = win[0]; iu <= win[1]; iu++) {
        const r = radius(iu, iv);
        if (r > 1) continue;
        put((iv * nu + iu) * 4, g.rim > 0 && r > 1 - g.rim ? cRim : g.dead ? cDead : r < g.voidR ? cVoid : r < g.core ? cCore : cShell);
      }
    }
  }
}
