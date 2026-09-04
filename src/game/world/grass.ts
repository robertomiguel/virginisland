import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Mata de musgo: varios matojos del modelo moss_01 (Poly Haven) girados, escalados y repartidos
 * en un corro. Cada mata se fusiona en una sola geometría para instanciarla de una pasada.
 */
export function buildMossClump(seed: number, tufts: THREE.BufferGeometry[], scale: number): THREE.BufferGeometry {
  const rnd = (i: number) => { const x = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453; return x - Math.floor(x); };
  const parts: THREE.BufferGeometry[] = [];
  const n = 7 + Math.floor(rnd(1) * 5);
  for (let i = 0; i < n; i++) {
    const g = tufts[Math.floor(rnd(10 + i) * tufts.length) % tufts.length].clone();
    const s = scale * (0.7 + rnd(20 + i) * 0.7);
    const a = rnd(30 + i) * Math.PI * 2;
    const r = 0.22 * Math.sqrt(rnd(40 + i));
    g.scale(s, s * (0.85 + rnd(50 + i) * 0.5), s);
    g.rotateY(a);
    g.translate(Math.cos(a) * r, 0, Math.sin(a) * r);
    parts.push(g);
  }
  return mergeGeometries(parts, false)!;
}
