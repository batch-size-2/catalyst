import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import { COLORS, glowSprite, stagingColor, surfaceMaterial } from "./materials";
import { FACE_RES_UM, ICO_SCALE, faceFrame, rasterise, type Face, type Flake, type Grain } from "./section";
import { atDepth, interp, isPore, type Loaded, type State } from "./model";
import type { Drive } from "./types";

export const SEPARATOR_UM = 12;
export const COPPER_UM = 6;
export const SEI_EXAGGERATION = 10;
const N_IONS = 520;
const RASTER_INTERVAL_S = 0.08; // sections are redrawn on the CPU; cap the rate while the charge plays
const N_SITES = 420;
const TETRA = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]].map((v) => new THREE.Vector3(...v).normalize());

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));

interface Props {
  model: Loaded;
  drive: Drive;
  st: State;
  offsetX: number;
  color: string;
  title: string;
  subtitle: string;
  labels?: boolean;
  /** Stable container for the HTML labels, so drei does not re-target (and drop) them when events connect. */
  labelRoot: RefObject<HTMLElement>;
}

/** One anode slab: graphite flakes and silicon particles as instanced meshes clipped to the box. The visible box
    faces are true sections of the packing, rasterised on the CPU (overlapping particles make the usual stencil
    cap wrong), with pores left open so you look into them. Li+ ions move in the pores; Li metal grows where
    plating is predicted. */
export function Slab({ model, drive, st, offsetX, color, title, subtitle, labels = false, labelRoot }: Props) {
  const [W, H0, D] = model.box_um;
  const H = st.thicknessUm;
  const zFront = clamp(drive.sliceUm, 1, D);
  const front = zFront - D / 2;

  const planes = useMemo(() => Array.from({ length: 6 }, () => new THREE.Plane()), []);
  const latest = useRef<{ flakes: Flake[]; grains: Grain[]; H: number; zFront: number } | null>(null);
  const stale = useRef(new Set<Face>());
  const lastRaster = useRef(-1);
  const box = useMemo(() => ({ uBoxMin: { value: new THREE.Vector3() }, uBoxMax: { value: new THREE.Vector3() } }), []);

  const scene = useMemo(() => {
    const rnd = mulberry32(model.silicon.length * 7919 + model.graphite.length);
    const make = (kind: "graphite" | "silicon", count: number) => {
      const geometry = new THREE.IcosahedronGeometry(1, 0);
      const info = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
      info.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute("aInfo", info);
      const surface = new THREE.InstancedMesh(geometry, surfaceMaterial(kind, planes, box), count);
      surface.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      surface.setColorAt(0, new THREE.Color());
      surface.frustumCulled = false;
      return { surface, info };
    };
    const graphite = make("graphite", model.graphite.length);
    const silicon = make("silicon", model.silicon.length * 5);
    const siRotation = model.silicon.map(() =>
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 6.28, rnd() * 6.28, rnd() * 6.28)));

    const faces = (["front", "top", "left", "right"] as Face[]).map((face) => {
      const { w, h } = faceFrame(face, W, H0, D);
      const nu = Math.round(w / FACE_RES_UM), nv = Math.round(h / FACE_RES_UM);
      const data = new Uint8Array(nu * nv * 4);
      const texture = new THREE.DataTexture(data, nu, nv, THREE.RGBAFormat);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.magFilter = THREE.LinearFilter;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(12), 3));
      geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2));
      geometry.setIndex([0, 1, 2, 2, 1, 3]);
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
        map: texture, alphaTest: 0.5, side: THREE.DoubleSide, toneMapped: false,
      }));
      mesh.frustumCulled = false;
      return { face, data, texture, mesh, nu, nv };
    });

    const ionGeometry = new THREE.BufferGeometry();
    ionGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N_IONS * 3), 3));
    const ions = new THREE.Points(ionGeometry, new THREE.PointsMaterial({
      size: 2.2, map: glowSprite(), color: COLORS.ion, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, clippingPlanes: planes,
    }));
    ions.frustumCulled = false;
    const ionPos = new Float32Array(N_IONS * 3);
    const ionStuck = new Uint8Array(N_IONS);
    const spawn = (i: number, top: boolean) => {
      for (let t = 0; t < 200; t++) {
        const x = rnd() * W, y = top ? H0 - rnd() * 3 : rnd() * H0, z = rnd() * D;
        if (isPore(model, x, y, z)) {
          ionPos.set([x, y, z], i * 3);
          ionStuck[i] = 0;
          return;
        }
      }
    };
    for (let i = 0; i < N_IONS; i++) spawn(i, false);

    const sites: { x: number; y: number; z: number; q: THREE.Quaternion }[] = [];
    const v = model.pores.voxel_um;
    for (let t = 0; t < 6000 && sites.length < N_SITES; t++) {
      const x = rnd() * W, z = rnd() * D;
      for (let y = H0 - v / 2; y > H0 - 8; y -= v) {
        if (isPore(model, x, y, z) && !isPore(model, x, y - v, z)) {
          const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.3, rnd() * 6.28, (rnd() - 0.5) * 0.3));
          sites.push({ x, y: y - v / 2, z, q });
          break;
        }
      }
    }
    const coneGeometry = new THREE.ConeGeometry(0.4, 1, 5).translate(0, 0.5, 0);
    const lithium = new THREE.InstancedMesh(coneGeometry, new THREE.MeshStandardMaterial({
      color: COLORS.lithium, metalness: 0.9, roughness: 0.2, emissive: "#9fb4c8", emissiveIntensity: 0.35,
      clippingPlanes: planes,
    }), N_SITES);
    lithium.frustumCulled = false;
    lithium.count = 0;

    const flakeShade = model.graphite.map(() => rnd());
    const flakePhase = model.graphite.map(() => rnd());
    return { graphite, silicon, siRotation, flakeShade, flakePhase, faces, ions, ionPos, ionStuck, spawn, sites, lithium };
  }, [model, planes, box, W, H0, D]);

  useEffect(() => () => {
    for (const part of [scene.graphite, scene.silicon]) {
      part.surface.geometry.dispose();
      (part.surface.material as THREE.Material).dispose();
    }
    for (const f of scene.faces) {
      f.texture.dispose();
      f.mesh.geometry.dispose();
      (f.mesh.material as THREE.Material).dispose();
    }
    scene.ions.geometry.dispose();
    scene.lithium.geometry.dispose();
  }, [scene]);

  useEffect(() => {
    const x0 = offsetX - W / 2, x1 = offsetX + W / 2;
    planes[0].set(new THREE.Vector3(1, 0, 0), -x0);
    planes[1].set(new THREE.Vector3(-1, 0, 0), x1);
    planes[2].set(new THREE.Vector3(0, 1, 0), 0);
    planes[3].set(new THREE.Vector3(0, -1, 0), H);
    planes[4].set(new THREE.Vector3(0, 0, 1), D / 2);
    planes[5].set(new THREE.Vector3(0, 0, -1), front);
    box.uBoxMin.value.set(x0, 0, -D / 2);
    box.uBoxMax.value.set(x1, H, front);

    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    const c = new THREE.Color(), sei = new THREE.Color(COLORS.sei);
    const siPristine = new THREE.Color(COLORS.siPristine), siLith = new THREE.Color(COLORS.siLithiated);
    const siDead = new THREE.Color(COLORS.siDead);
    const { fill: fillGrid, x_gr, x_si } = model.anode;
    const { graphite_expansion: ge, si_expansion: se, d_si_m2_s: dSi, stress_reference_s: tRef, stress_full_index: sFull } = model.constants;
    const sy = 1 + st.strain;
    const localX = (y: number, curve: number[]) =>
      interp(fillGrid, curve, atDepth(model, st.localFill, clamp(1 - y / H0)));
    const toWorld = (v: THREE.Vector3) => v.set(offsetX - W / 2 + v.x, v.y, v.z - D / 2);
    const flakes: Flake[] = [];
    const grains: Grain[] = [];

    const g = scene.graphite;
    const grTint = clamp((st.seiNmGr - 5) / 70, 0, 0.4);
    const rot = new THREE.Matrix3();
    model.graphite.forEach((row, i) => {
      const xg = localX(row[1], x_gr);
      const centre = new THREE.Vector3(row[0], row[1] * sy, row[2]);
      q.set(row[6], row[7], row[8], row[9]);
      s.set(row[3], row[4] * (1 + ge * xg), row[5]);
      const color = stagingColor(xg, scene.flakePhase[i], new THREE.Color()).lerp(sei, grTint);
      rot.setFromMatrix4(m4.makeRotationFromQuaternion(q));
      const e = rot.elements; // column-major
      const half = new THREE.Vector3(
        Math.hypot(e[0] * s.x, e[3] * s.y, e[6] * s.z),
        Math.hypot(e[1] * s.x, e[4] * s.y, e[7] * s.z),
        Math.hypot(e[2] * s.x, e[5] * s.y, e[8] * s.z)).multiplyScalar(ICO_SCALE);
      const inv = new THREE.Matrix3().set(1 / s.x, 0, 0, 0, 1 / s.y, 0, 0, 0, 1 / s.z).multiply(rot.clone().transpose());
      flakes.push({ c: centre, inv, half, shade: 0.86 + 0.28 * scene.flakeShade[i], color });
      g.surface.setMatrixAt(i, m4.compose(toWorld(p.copy(centre)), q, s.multiplyScalar(ICO_SCALE)));
      g.surface.setColorAt(i, color);
    });

    const si = scene.silicon;
    const n = model.silicon.length;
    const N = drive.cycles;
    const hide = new THREE.Matrix4().makeScale(0, 0, 0);
    const info = si.info.array as Float32Array;
    model.silicon.forEach((row, i) => {
      const [x, y, z, r, vf, crack, deadAt] = row;
      const dead = deadAt >= 0 && N >= deadAt;
      const cracked = crack >= 0 && N >= crack;
      const xs = dead ? 0 : localX(y, x_si);
      const ratio = 1 + Math.max(0, (1 - vf) * se * xs - vf);
      const rOut = r * Math.cbrt(ratio);
      const core = Math.cbrt(Math.max(0, (1 - xs) * (1 - vf)) / ratio);
      const voidR = vf > 0 ? Math.cbrt(vf / ratio) : 0;
      const tau = (r * 1e-6) ** 2 / (dSi * tRef);
      const glow = dead ? 0 : clamp((st.current * tau / sFull) * 4 * xs * (1 - xs) * (1 - 2 * vf));
      const rim = N >= 1 ? clamp((st.seiNmSi * SEI_EXAGGERATION) / 1000 / rOut * (cracked ? 1.5 : 1), 0, 0.4) : 0;
      if (dead) c.copy(siDead);
      else c.copy(siPristine).lerp(siLith, xs);
      c.lerp(sei, rim * 0.8);
      const centre = new THREE.Vector3(x, y * sy, z);
      const qi = scene.siRotation[i];
      const pieces = cracked
        ? TETRA.map((d) => ({
          at: d.clone().applyQuaternion(qi).multiplyScalar(0.42 * rOut + rOut * (0.05 + 0.25 * clamp((N - crack) / 500))).add(centre),
          r: 0.62 * rOut,
        }))
        : [{ at: centre, r: rOut }];
      const slots = cracked ? [n + 4 * i, n + 4 * i + 1, n + 4 * i + 2, n + 4 * i + 3] : [i];
      (cracked ? [i] : [n + 4 * i, n + 4 * i + 1, n + 4 * i + 2, n + 4 * i + 3]).forEach((j) => si.surface.setMatrixAt(j, hide));
      pieces.forEach((piece, k) => {
        const j = slots[k];
        si.surface.setMatrixAt(j, m4.compose(toWorld(p.copy(piece.at)), qi, s.setScalar(piece.r * ICO_SCALE)));
        si.surface.setColorAt(j, c);
        info[j * 4 + 3] = glow;
        grains.push({ c: piece.at, r: piece.r * ICO_SCALE, q: qi, core, voidR, rim, glow, dead });
      });
    });
    for (const part of [g, si]) {
      part.surface.instanceMatrix.needsUpdate = true;
      part.surface.instanceColor!.needsUpdate = true;
      part.info.needsUpdate = true;
    }

    latest.current = { flakes, grains, H, zFront };
    stale.current = new Set(scene.faces.map((f) => f.face));
    for (const f of scene.faces) {
      const { o, U, V, w, h } = faceFrame(f.face, W, H, zFront);
      const out = new THREE.Vector3().crossVectors(U, V).multiplyScalar(0.02);
      const corners = [o.clone(), o.clone().addScaledVector(U, w), o.clone().addScaledVector(V, h),
        o.clone().addScaledVector(U, w).addScaledVector(V, h)];
      const pos = f.mesh.geometry.attributes.position as THREE.BufferAttribute;
      corners.forEach((v, k) => { toWorld(v.add(out)); pos.setXYZ(k, v.x, v.y, v.z); });
      pos.needsUpdate = true;
    }

    let count = 0;
    for (const site of scene.sites) {
      const margin = atDepth(model, st.margin, clamp(1 - site.y / H0));
      if (margin >= 0 || drive.soc <= 0.001) continue;
      const length = 4 * clamp(-margin / 0.04, 0.25, 1);
      p.set(offsetX + site.x - W / 2, site.y * sy, site.z - D / 2);
      scene.lithium.setMatrixAt(count++, m4.compose(p, site.q, s.set(1, length, 1)));
    }
    scene.lithium.count = count;
    scene.lithium.instanceMatrix.needsUpdate = true;
  }, [scene, model, st, drive.cycles, drive.soc, offsetX, front, zFront, planes, box, W, H, H0, D]);

  useFrame(({ clock, camera }, delta) => {
    const now = clock.elapsedTime;
    if (latest.current && stale.current.size && now - lastRaster.current > RASTER_INTERVAL_S) {
      const { flakes, grains, H: h, zFront: z } = latest.current;
      const cam = camera.position;
      const visible: Record<Face, boolean> = {
        front: cam.z > z - D / 2, top: cam.y > h, left: cam.x < offsetX - W / 2, right: cam.x > offsetX + W / 2,
      };
      for (const f of scene.faces) {
        if (!stale.current.has(f.face) || !visible[f.face]) continue;
        rasterise(f.face, W, h, z, flakes, grains, f.data, f.nu, f.nv);
        f.texture.needsUpdate = true;
        stale.current.delete(f.face);
      }
      lastRaster.current = now;
    }
    scene.ions.visible = drive.showIons;
    if (!drive.showIons) return;
    const dt = Math.min(delta, 0.05);
    const flowing = st.current > 0;
    const transport = (st.porosity / 0.3) ** 1.5;
    const drift = 3 * Math.sqrt(st.current);
    const jitter = 9 * Math.sqrt(transport);
    const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 2;
    const pos = scene.ionPos;
    const world = scene.ions.geometry.attributes.position as THREE.BufferAttribute;
    const sy = 1 + st.strain;
    for (let i = 0; i < N_IONS; i++) {
      let x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      const nx = x + gauss() * jitter * dt, ny = y - drift * dt + gauss() * jitter * dt, nz = z + gauss() * jitter * dt;
      if (isPore(model, nx, ny, nz)) {
        x = nx; y = ny; z = nz;
      } else if (isPore(model, nx, y, nz)) {
        x = nx; z = nz;
        scene.ionStuck[i]++;
      } else {
        scene.ionStuck[i]++;
      }
      if (y < 0.5 || (flowing && scene.ionStuck[i] > 40)) {
        scene.spawn(i, true);
        x = pos[i * 3]; y = pos[i * 3 + 1]; z = pos[i * 3 + 2];
      } else {
        pos.set([x, y, z], i * 3);
      }
      world.setXYZ(i, offsetX + x - W / 2, y * sy, z - D / 2);
    }
    world.needsUpdate = true;
  });

  const zMid = -D / 2 + zFront / 2;
  const section = model.section;
  const texture = useMemo(() => {
    if (!section) return null;
    const url = `/api/images/${encodeURIComponent(model.batch)}/${encodeURIComponent(section.image_id)}/${section.detector}?size=2048`;
    const tex = new THREE.TextureLoader().load(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    const [u0, u1] = section.u, [v0, v1] = section.v;
    tex.repeat.set((u1 - u0) / 2, v1 - v0);
    tex.offset.set(u0, 1 - v1);
    return tex;
  }, [model.batch, section]);
  useEffect(() => () => texture?.dispose(), [texture]);

  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), []);
  const labelStyle = "pointer-events-none whitespace-nowrap text-[11px] text-cx-faint";

  return (
    <group>
      <primitive object={scene.graphite.surface} />
      <primitive object={scene.silicon.surface} />
      {scene.faces.map((f) => <primitive key={f.face} object={f.mesh} />)}
      <primitive object={scene.ions} />
      <primitive object={scene.lithium} />

      <mesh position={[offsetX, H / 2, zMid]} scale={[W - 0.02, H - 0.02, zFront - 0.02]}>
        <boxGeometry />
        <meshBasicMaterial color={COLORS.electrolyte} side={THREE.BackSide} />
      </mesh>
      <lineSegments geometry={edges} position={[offsetX, H / 2, zMid]} scale={[W, H, zFront]}>
        <lineBasicMaterial color={color} transparent opacity={0.55} />
      </lineSegments>

      <mesh position={[offsetX, H + SEPARATOR_UM / 2, zMid]} scale={[W, SEPARATOR_UM, zFront]}>
        <boxGeometry />
        <meshStandardMaterial color={COLORS.separator} transparent opacity={0.16} depthWrite={false} roughness={0.9} />
      </mesh>
      <lineSegments geometry={edges} position={[offsetX, H + SEPARATOR_UM / 2, zMid]} scale={[W, SEPARATOR_UM, zFront]}>
        <lineBasicMaterial color={COLORS.separator} transparent opacity={0.25} />
      </lineSegments>
      <mesh position={[offsetX, -COPPER_UM / 2, zMid]} scale={[W, COPPER_UM, zFront]}>
        <boxGeometry />
        <meshStandardMaterial color={COLORS.copper} metalness={0.75} roughness={0.32} />
      </mesh>

      {texture && drive.showSection && (
        <mesh position={[offsetX - W / 4, H0 / 2, front + 0.05]}>
          <planeGeometry args={[W / 2, H0]} />
          <meshBasicMaterial map={texture} toneMapped={false} />
        </mesh>
      )}

      <Html portal={labelRoot} position={[offsetX, H + SEPARATOR_UM + 5, zMid]} center>
        <div className="pointer-events-none whitespace-nowrap text-center">
          <div className="text-[13px] font-medium" style={{ color }}>{title}</div>
          <div className="text-[11px] text-cx-faint">{subtitle}</div>
        </div>
      </Html>
      {labels && (
        <>
          <Html portal={labelRoot} position={[offsetX - W / 2 - 2, H + SEPARATOR_UM / 2, front]} style={{ transform: "translateX(-100%)" }}>
            <div className={labelStyle}>separator</div>
          </Html>
          <Html portal={labelRoot} position={[offsetX - W / 2 - 2, H / 2, front]} style={{ transform: "translateX(-100%)" }}>
            <div className={labelStyle}>coating {H.toFixed(1)} µm</div>
          </Html>
          <Html portal={labelRoot} position={[offsetX - W / 2 - 2, -COPPER_UM / 2, front]} style={{ transform: "translateX(-100%)" }}>
            <div className={labelStyle}>Cu current collector</div>
          </Html>
        </>
      )}
      {texture && drive.showSection && (
        <Html portal={labelRoot} position={[offsetX - W / 4, -COPPER_UM - 3, front]} center>
          <div className={labelStyle}>real FIB-SEM section · {section!.image_id}</div>
        </Html>
      )}
      <Html portal={labelRoot} position={[offsetX + (drive.showSection && texture ? W / 4 : 0), -COPPER_UM - 3, front]} center>
        <div className={labelStyle}>{drive.showSection && texture ? "illustration" : `${W} × ${H.toFixed(0)} × ${zFront.toFixed(0)} µm`}</div>
      </Html>
    </group>
  );
}
