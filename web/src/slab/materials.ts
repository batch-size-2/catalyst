import * as THREE from "three";

/** Colours. Graphite follows its staging colours under lithiation (operando optical microscopy). */
export const COLORS = {
  graphiteStages: [
    ["#55575d", "pristine"], // dark grey, as in the SEM images
    ["#2a4fb5", "stage 3/4"], // blue
    ["#a32f2f", "stage 2, LiC12"], // red
    ["#e9bb25", "stage 1, LiC6"], // gold
  ] as [string, string][],
  siPristine: "#d6d6da",
  siLithiated: "#f2b98a", // LixSi: pale peach, kept apart from gold LiC6 and from the stress glow
  siHot: "#ff4d12",
  siDead: "#5d534b",
  sei: "#6b4a2b",
  void: "#050607",
  electrolyte: "#08161b",
  copper: "#b87333",
  separator: "#e8ecf2",
  ion: "#8be9ff",
  lithium: "#dfe4ea",
};

const stages = COLORS.graphiteStages.map(([c]) => new THREE.Color(c));

/** Staging colour of one flake at lithiation x. Each transition is a two-phase plateau, so flakes switch one by
    one: the flake's own threshold u in [0, 1] spreads the switch so the share of switched flakes follows the
    lever rule (the mosaic seen in operando microscopy) instead of every flake blending to an unphysical hue. */
export function stagingColor(x: number, u: number, out: THREE.Color): THREE.Color {
  const stage = x > 0.5 + 0.45 * u ? 3 : x > 0.22 + 0.26 * u ? 2 : x > 0.04 + 0.14 * u ? 1 : 0;
  return out.copy(stages[stage]);
}

export interface BoxUniforms {
  uBoxMin: { value: THREE.Vector3 };
  uBoxMax: { value: THREE.Vector3 };
}

/** Lit outer surface. Surfaces seen through a pore dim with their depth below the visible box faces, as signal
    from deep pores does in the SEM, so open pores read dark instead of as solid. Per instance, aInfo.x is how
    open the particle's surroundings are (contact shading) and aInfo.w silicon's stress glow. Graphite gets faint
    bands along its c-axis, the layered look of a flake. */
export function surfaceMaterial(kind: "graphite" | "silicon", planes: THREE.Plane[], box: BoxUniforms): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    flatShading: true,
    roughness: kind === "graphite" ? 0.55 : 0.42,
    metalness: kind === "graphite" ? 0.25 : 0.05,
    clippingPlanes: planes,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, box);
    shader.vertexShader = "attribute vec4 aInfo;\nvarying float vGlow;\nvarying float vOpen;\nvarying vec3 vW;\nvarying vec3 vCax;\n" + shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
      vGlow = max(aInfo.w, 0.0);
      vOpen = aInfo.x;
      #ifdef USE_INSTANCING
        mat4 placed = modelMatrix * instanceMatrix;
      #else
        mat4 placed = modelMatrix;
      #endif
      vW = (placed * vec4(transformed, 1.0)).xyz;
      vCax = normalize(mat3(placed) * vec3(0.0, 1.0, 0.0));`);
    shader.fragmentShader = "uniform vec3 uBoxMin;\nuniform vec3 uBoxMax;\nvarying float vGlow;\nvarying float vOpen;\nvarying vec3 vW;\nvarying vec3 vCax;\n" + shader.fragmentShader
      .replace("#include <color_fragment>",
        `#include <color_fragment>
        ${kind === "graphite" ? "diffuseColor.rgb *= 0.93 + 0.07 * sin(dot(vW, vCax) * 6.2831853 / 1.4);" : ""}`)
      .replace("#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(1.0, 0.24, 0.03) * vGlow * ${kind === "silicon" ? "1.1" : "0.0"};`)
      .replace("#include <opaque_fragment>",
        `float depth = 1e4;
        if (cameraPosition.x < uBoxMin.x) depth = min(depth, vW.x - uBoxMin.x);
        if (cameraPosition.x > uBoxMax.x) depth = min(depth, uBoxMax.x - vW.x);
        if (cameraPosition.y > uBoxMax.y) depth = min(depth, uBoxMax.y - vW.y);
        if (cameraPosition.z > uBoxMax.z) depth = min(depth, uBoxMax.z - vW.z);
        if (cameraPosition.z < uBoxMin.z) depth = min(depth, vW.z - uBoxMin.z);
        outgoingLight *= mix(0.08, 1.0, exp(-max(depth, 0.0) / 3.0)) * mix(0.55, 1.0, clamp(vOpen * 2.5, 0.0, 1.0));
        #include <opaque_fragment>`);
  };
  return material;
}

let glowTexture: THREE.Texture | null = null;

export function glowSprite(): THREE.Texture {
  if (glowTexture) return glowTexture;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(200,245,255,0.85)");
  g.addColorStop(1, "rgba(120,220,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  glowTexture = new THREE.CanvasTexture(canvas);
  return glowTexture;
}
