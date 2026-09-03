import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Variant } from './variants';

/**
 * Árbol procedural: tronco y ramas como tubos afilados, hojas como tarjetas recortadas de un atlas
 * con alfa (atlas de hojas de Poly Haven). Controla el número de triángulos (~3-4k por árbol).
 */

export interface LeafRect { u0: number; v0: number; u1: number; v1: number } // coords de imagen (v desde arriba)

export interface TreeSpec {
  trunkHeight: [number, number];
  trunkRadius: number;
  firstLength: [number, number];
  lengthRatio: number;
  radiusRatio: number;
  children: number[];        // ramas hijas por nivel
  angle: number;             // apertura respecto a la rama madre (rad)
  upBias: number;            // tendencia a subir (+) o caer (-) por nivel
  cardsPerTip: number;
  cardSize: [number, number]; // ancho, alto de la tarjeta (m)
  cardsAlongBranch: boolean;  // tarjetas también a lo largo de las ramas finales
  cloudRadius: number;        // dispersión de las tarjetas alrededor de la rama (m)
  rects: LeafRect[];
}

// Atlas island_tree_01_leaves: 8 hojas sueltas
export const ISLAND_LEAF_RECTS: LeafRect[] = [
  { u0: 0.02, v0: 0.02, u1: 0.16, v1: 0.42 }, { u0: 0.17, v0: 0.02, u1: 0.34, v1: 0.40 }, { u0: 0.36, v0: 0.03, u1: 0.49, v1: 0.37 },
  { u0: 0.51, v0: 0.04, u1: 0.65, v1: 0.38 }, { u0: 0.69, v0: 0.02, u1: 0.83, v1: 0.42 },
  { u0: 0.02, v0: 0.62, u1: 0.17, v1: 0.98 }, { u0: 0.21, v0: 0.58, u1: 0.35, v1: 0.99 }, { u0: 0.42, v0: 0.60, u1: 0.57, v1: 0.99 },
];
// Atlas jacaranda_leaves: 3 frondas grandes
export const JACARANDA_LEAF_RECTS: LeafRect[] = [
  { u0: 0.15, v0: 0.02, u1: 1.0, v1: 0.47 }, { u0: 0.0, v0: 0.34, u1: 0.44, v1: 0.71 }, { u0: 0.25, v0: 0.6, u1: 1.0, v1: 1.0 },
];

export const ISLAND_TREE: TreeSpec = {
  trunkHeight: [2.2, 3.4], trunkRadius: 0.3, firstLength: [2.6, 3.4], lengthRatio: 0.68, radiusRatio: 0.62,
  children: [3, 3, 3], angle: 0.75, upBias: 0.05, cardsPerTip: 44, cardSize: [0.28, 0.42], cardsAlongBranch: true, cloudRadius: 0.55, rects: ISLAND_LEAF_RECTS,
};
export const JACARANDA: TreeSpec = {
  trunkHeight: [5, 7.5], trunkRadius: 0.36, firstLength: [4.2, 5.2], lengthRatio: 0.72, radiusRatio: 0.6,
  children: [3, 3, 2], angle: 0.55, upBias: 0.12, cardsPerTip: 26, cardSize: [1.0, 0.65], cardsAlongBranch: true, cloudRadius: 0.7, rects: JACARANDA_LEAF_RECTS,
};

const UP = new THREE.Vector3(0, 1, 0);

function rnd(seed: number) {
  let s = seed * 9301 + 49297;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

function segment(from: THREE.Vector3, to: THREE.Vector3, r0: number, r1: number, radial: number): THREE.BufferGeometry {
  const dir = to.clone().sub(from);
  const len = dir.length();
  dir.normalize();
  const g = new THREE.CylinderGeometry(r1, r0, len, radial, 1, true);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1.5, uv.getY(i) * len * 0.6);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir));
  g.translate(from.x, from.y, from.z);
  return g;
}

function leafCard(pos: THREE.Vector3, dir: THREE.Vector3, spec: TreeSpec, rect: LeafRect, r: () => number, roll: number): THREE.BufferGeometry {
  const [w, h] = spec.cardSize;
  const k = 0.85 + r() * 0.3;
  const g = new THREE.PlaneGeometry(w * k, h * k);
  g.translate(0, h * k * 0.45, 0); // el tallo de la hoja queda en el punto de anclaje
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const rw = rect.u1 - rect.u0, rh = rect.v1 - rect.v0;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, rect.u0 + uv.getX(i) * rw, 1 - (rect.v0 + (1 - uv.getY(i)) * rh));
  // orientar: eje de la hoja según la dirección de la rama, inclinada hacia fuera y girada al azar
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir);
  g.applyQuaternion(new THREE.Quaternion().setFromAxisAngle(UP, roll));
  g.applyQuaternion(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (r() - 0.5) * 1.2));
  g.applyQuaternion(q);
  g.translate(pos.x, pos.y, pos.z);
  return g;
}

export function buildTree(spec: TreeSpec, seed: number, barkMat: THREE.Material, leafMat: THREE.Material): Variant {
  const r = rnd(seed);
  const wood: THREE.BufferGeometry[] = [];
  const leaves: THREE.BufferGeometry[] = [];

  const trunkH = spec.trunkHeight[0] + r() * (spec.trunkHeight[1] - spec.trunkHeight[0]);
  const base = new THREE.Vector3(0, -0.3, 0);
  const lean = new THREE.Vector3((r() - 0.5) * 0.2, 1, (r() - 0.5) * 0.2).normalize();
  const top = base.clone().addScaledVector(lean, trunkH);
  // tronco en dos tramos para que no sea recto
  const mid = base.clone().addScaledVector(lean, trunkH * 0.5).add(new THREE.Vector3((r() - 0.5) * 0.3, 0, (r() - 0.5) * 0.3));
  wood.push(segment(base, mid, spec.trunkRadius * 1.15, spec.trunkRadius * 0.85, 9));
  wood.push(segment(mid, top, spec.trunkRadius * 0.85, spec.trunkRadius * 0.6, 9));

  const grow = (from: THREE.Vector3, dir: THREE.Vector3, length: number, radius: number, level: number) => {
    // rama curvada en 2 tramos
    const bend = new THREE.Vector3((r() - 0.5) * 0.35, spec.upBias * 0.6, (r() - 0.5) * 0.35);
    const d1 = dir.clone().add(bend).normalize();
    const m = from.clone().addScaledVector(d1, length * 0.5);
    const d2 = d1.clone().add(new THREE.Vector3((r() - 0.5) * 0.3, spec.upBias * 0.6, (r() - 0.5) * 0.3)).normalize();
    const end = m.clone().addScaledVector(d2, length * 0.5);
    const radial = level === 0 ? 7 : level === 1 ? 6 : 5;
    const rEnd = radius * spec.radiusRatio;
    wood.push(segment(from, m, radius, (radius + rEnd) / 2, radial));
    wood.push(segment(m, end, (radius + rEnd) / 2, rEnd, radial));

    const isTip = level >= spec.children.length - 1;
    if (isTip) {
      const n = spec.cardsPerTip;
      for (let i = 0; i < n; i++) {
        const t = spec.cardsAlongBranch ? 0.35 + (i / n) * 0.65 : 1;
        const p = t < 0.5 ? from.clone().lerp(m, t * 2) : m.clone().lerp(end, (t - 0.5) * 2);
        // nube de hojas alrededor de la rama (más densa hacia la punta)
        const cr = spec.cloudRadius * (0.4 + t * 0.6);
        p.add(new THREE.Vector3((r() - 0.5) * 2 * cr, (r() - 0.5) * 2 * cr * 0.7, (r() - 0.5) * 2 * cr));
        const rect = spec.rects[Math.floor(r() * spec.rects.length)];
        const side = d2.clone().cross(UP).normalize().multiplyScalar((r() - 0.5) * 0.6);
        const ld = d2.clone().add(side).add(new THREE.Vector3(0, (r() - 0.6) * 0.5, 0)).normalize();
        leaves.push(leafCard(p, ld, spec, rect, r, r() * Math.PI * 2));
      }
      return;
    }
    const k = spec.children[level + 1];
    const perp = new THREE.Vector3().crossVectors(d2, Math.abs(d2.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : UP).normalize();
    const a0 = r() * Math.PI * 2;
    for (let i = 0; i < k; i++) {
      const a = a0 + (i / k) * Math.PI * 2 + (r() - 0.5) * 0.8;
      const around = perp.clone().applyAxisAngle(d2, a);
      const cd = d2.clone().applyAxisAngle(around.clone().cross(d2).normalize(), spec.angle * (0.75 + r() * 0.5)).normalize();
      cd.y += spec.upBias;
      cd.normalize();
      grow(end, cd, length * spec.lengthRatio * (0.85 + r() * 0.3), rEnd, level + 1);
    }
  };

  const k0 = spec.children[0];
  const a0 = r() * Math.PI * 2;
  for (let i = 0; i < k0; i++) {
    const a = a0 + (i / k0) * Math.PI * 2 + (r() - 0.5) * 0.6;
    const cd = new THREE.Vector3(Math.cos(a) * Math.sin(spec.angle), Math.cos(spec.angle), Math.sin(a) * Math.sin(spec.angle)).normalize();
    const len = spec.firstLength[0] + r() * (spec.firstLength[1] - spec.firstLength[0]);
    grow(top, cd, len, spec.trunkRadius * 0.6, 0);
  }

  const woodGeo = mergeGeometries(wood, false)!;
  woodGeo.computeVertexNormals();
  const leafGeo = mergeGeometries(leaves, false)!;
  leafGeo.computeVertexNormals();
  return { parts: [{ geometry: woodGeo, material: barkMat }, { geometry: leafGeo, material: leafMat }], baseY: 0 };
}
