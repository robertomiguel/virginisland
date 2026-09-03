import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Variant } from './variants';
import { addWindSway } from './windShader';

/** Mata de hierba procedural: hojas como triángulos finos con leve curvatura. */
export function buildGrassClump(seed: number, registry: THREE.WebGLProgramParametersWithUniforms[], windStrength: number): Variant {
  const rnd = (i: number) => { const x = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453; return x - Math.floor(x); };
  const blades: THREE.BufferGeometry[] = [];
  const n = 7 + Math.floor(rnd(1) * 6);
  for (let i = 0; i < n; i++) {
    const h = 0.35 + rnd(10 + i) * 0.45;
    const w = 0.05 + rnd(20 + i) * 0.04;
    const a = rnd(30 + i) * Math.PI * 2;
    const lean = 0.15 + rnd(40 + i) * 0.4;
    // hoja: 3 segmentos que se estrechan y se curvan
    const pos: number[] = [];
    const idx: number[] = [];
    const segs = 3;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const ww = w * (1 - t * 0.85);
      const bend = lean * t * t;
      const x = Math.cos(a) * bend, z = Math.sin(a) * bend;
      pos.push(x - Math.sin(a) * ww, h * t, z + Math.cos(a) * ww, x + Math.sin(a) * ww, h * t, z - Math.cos(a) * ww);
      if (s < segs) { const b = s * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    const ox = (rnd(50 + i) - 0.5) * 0.35, oz = (rnd(60 + i) - 0.5) * 0.35;
    g.translate(ox, 0, oz);
    blades.push(g);
  }
  const geo = mergeGeometries(blades, false)!;
  geo.computeVertexNormals();
  const hue = 0.24 + rnd(2) * 0.06;
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(hue, 0.5, 0.3 + rnd(3) * 0.1), roughness: 0.9, side: THREE.DoubleSide, name: 'grass_leaves' });
  if (windStrength > 0) addWindSway(mat, windStrength, registry);
  return { parts: [{ geometry: geo, material: mat }], baseY: 0 };
}

/** Flor: tallo fino y corola de cuatro pétalos. */
export function buildFlower(seed: number, color: string, registry: THREE.WebGLProgramParametersWithUniforms[], windStrength: number): Variant {
  const rnd = (i: number) => { const x = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453; return x - Math.floor(x); };
  const parts: THREE.BufferGeometry[] = [];
  const heads: THREE.BufferGeometry[] = [];
  const n = 2 + Math.floor(rnd(1) * 3);
  for (let i = 0; i < n; i++) {
    const h = 0.3 + rnd(10 + i) * 0.3;
    const ox = (rnd(20 + i) - 0.5) * 0.4, oz = (rnd(30 + i) - 0.5) * 0.4;
    const stem = new THREE.CylinderGeometry(0.008, 0.012, h, 3, 1);
    stem.translate(ox, h / 2, oz);
    parts.push(stem);
    for (let p = 0; p < 4; p++) {
      const petal = new THREE.PlaneGeometry(0.09, 0.05);
      petal.translate(0.05, 0, 0);
      petal.rotateX(-Math.PI / 2 + 0.5);
      petal.rotateY((p / 4) * Math.PI * 2 + rnd(40 + i) * 0.5);
      petal.translate(ox, h, oz);
      heads.push(petal);
    }
  }
  const stemMat = new THREE.MeshStandardMaterial({ color: '#4f7a2e', roughness: 0.9, name: 'grass_leaves' });
  const headMat = new THREE.MeshStandardMaterial({ color, roughness: 0.7, side: THREE.DoubleSide, name: 'flower_leaves' });
  if (windStrength > 0) { addWindSway(stemMat, windStrength, registry); addWindSway(headMat, windStrength, registry); }
  const stems = mergeGeometries(parts, false)!;
  const head = mergeGeometries(heads, false)!;
  head.computeVertexNormals();
  return { parts: [{ geometry: stems, material: stemMat }, { geometry: head, material: headMat }], baseY: 0 };
}
