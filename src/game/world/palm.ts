import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Variant } from './variants';

/** Palmera procedural: tronco curvado con textura de corteza y frondas con foliolos. */
export function buildPalm(bark: THREE.Texture, barkNormal: THREE.Texture, seed: number): Variant {
  const rnd = (i: number) => { const x = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453; return x - Math.floor(x); };
  const height = 8 + rnd(1) * 3;
  const lean = 0.8 + rnd(2) * 1.4;
  const leanDir = rnd(3) * Math.PI * 2;

  // Tronco
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    const off = lean * t * t;
    pts.push(new THREE.Vector3(Math.cos(leanDir) * off, height * t, Math.sin(leanDir) * off));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const trunk = new THREE.TubeGeometry(curve, 28, 0.26, 9, false);
  {
    // afinar hacia arriba y anillos
    const pos = trunk.attributes.position as THREE.BufferAttribute;
    const tmp = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      tmp.fromBufferAttribute(pos, i);
      const t = tmp.y / height;
      const c = curve.getPointAt(Math.min(1, Math.max(0, t)));
      const k = 1 - t * 0.35 + Math.sin(t * 60) * 0.06;
      tmp.sub(c).multiplyScalar(k).add(c);
      pos.setXYZ(i, tmp.x, tmp.y, tmp.z);
    }
    trunk.computeVertexNormals();
    const uv = trunk.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 5, uv.getY(i) * 1.5);
  }
  const top = curve.getPointAt(1);

  // Frondas: arco que sube, se dobla y cae con la punta casi vertical
  const frondGeos: THREE.BufferGeometry[] = [];
  const n = 12 + Math.floor(rnd(4) * 5);
  for (let f = 0; f < n; f++) {
    const a = (f / n) * Math.PI * 2 + rnd(10 + f) * 0.5;
    const age = rnd(30 + f); // 0 = fronda joven (más erguida), 1 = vieja (cuelga)
    const len = 3.6 + rnd(50 + f) * 1.4;
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const spine: THREE.Vector3[] = [];
    const steps = 18;
    // ángulo de salida: de 55° hacia arriba (joven) a 10° bajo la horizontal (vieja)
    const start = (0.95 - age * 1.15);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      // integración simple: la dirección gira hacia abajo cada vez más (curvatura creciente)
      const ang = start - (1.9 + age * 0.9) * t * t - 0.35 * t;
      const step = len / steps;
      const prev = i === 0 ? top.clone() : spine[i - 1];
      spine.push(prev.clone().addScaledVector(dir, Math.cos(ang) * step).add(new THREE.Vector3(0, Math.sin(ang) * step, 0)));
    }
    const curve = new THREE.CatmullRomCurve3(spine);
    const rachis = new THREE.TubeGeometry(curve, 18, 0.045, 4, false);
    {
      const pos = rachis.attributes.position as THREE.BufferAttribute;
      const tmp = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        tmp.fromBufferAttribute(pos, i);
        const t = Math.floor(i / 5) / 18; // afinar hacia la punta
        const c = curve.getPointAt(Math.min(1, t));
        tmp.sub(c).multiplyScalar(1 - t * 0.7).add(c);
        pos.setXYZ(i, tmp.x, tmp.y, tmp.z);
      }
    }
    frondGeos.push(rachis);
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    for (let i = 2; i < steps; i++) {
      const t = i / steps;
      const p = spine[i];
      const fwd = spine[i + 1].clone().sub(spine[i - 1]).normalize();
      const w = 0.62 * (1 - t * 0.55) + 0.12;
      for (const sgn of [-1, 1]) {
        const leaf = new THREE.PlaneGeometry(w, 0.11, 2, 1);
        leaf.translate(w / 2, 0, 0);
        // el foliolo cae: más cuanto más cerca de la punta y más vieja la fronda
        const droop = 0.5 + t * 0.7 + age * 0.4;
        const x = side.clone().multiplyScalar(sgn).addScaledVector(fwd, 0.45).normalize();
        const z = new THREE.Vector3().crossVectors(x, new THREE.Vector3(0, 1, 0)).normalize();
        const y = new THREE.Vector3().crossVectors(z, x).normalize();
        leaf.applyMatrix4(new THREE.Matrix4().makeRotationX(sgn * droop));
        leaf.applyMatrix4(new THREE.Matrix4().makeBasis(x, y, z).setPosition(p));
        frondGeos.push(leaf);
      }
    }
  }
  const fronds = mergeGeometries(frondGeos, false)!;
  fronds.computeVertexNormals();

  // Cocos
  const cocoGeos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const g = new THREE.SphereGeometry(0.16, 6, 5);
    const a = rnd(80 + i) * Math.PI * 2;
    g.translate(top.x + Math.cos(a) * 0.35, top.y - 0.25 - rnd(90 + i) * 0.15, top.z + Math.sin(a) * 0.35);
    cocoGeos.push(g);
  }
  const cocos = mergeGeometries(cocoGeos, false)!;

  const trunkMat = new THREE.MeshStandardMaterial({ map: bark, normalMap: barkNormal, roughness: 0.95, name: 'palm_trunk' });
  const frondMat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.3 + rnd(5) * 0.04, 0.55, 0.3 + rnd(6) * 0.08), roughness: 0.8, side: THREE.DoubleSide, name: 'palm_leaves' });
  const cocoMat = new THREE.MeshStandardMaterial({ color: '#6b4a24', roughness: 0.9, name: 'palm_coco' });

  return { parts: [{ geometry: trunk, material: trunkMat }, { geometry: fronds, material: frondMat }, { geometry: cocos, material: cocoMat }], baseY: 0 };
}
