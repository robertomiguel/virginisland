import * as THREE from 'three';
import { addWindSway } from './windShader';

export interface Part { geometry: THREE.BufferGeometry; material: THREE.Material }
export interface Variant { parts: Part[]; baseY: number }

export interface VariantOptions {
  registry?: THREE.WebGLProgramParametersWithUniforms[]; // para el viento
  windLeaves?: number;   // fuerza de viento en materiales "leaves"
  windBranches?: number; // fuerza en "branch"
  alphaMap?: THREE.Texture | null; // mapa alfa externo (Poly Haven lo entrega aparte)
  splitComponents?: boolean;       // separar una única malla en piezas conexas (sets de rocas)
}

/** Recorta una geometría indexada a un subconjunto de triángulos. */
function subGeometry(geo: THREE.BufferGeometry, tris: number[]): THREE.BufferGeometry {
  const index = geo.getIndex()!;
  const out = new THREE.BufferGeometry();
  const map = new Map<number, number>();
  const newIndex: number[] = [];
  const attrs = Object.keys(geo.attributes);
  const arrays: Record<string, number[]> = {};
  for (const a of attrs) arrays[a] = [];
  for (const t of tris) {
    for (let k = 0; k < 3; k++) {
      const vi = index.getX(t * 3 + k);
      let ni = map.get(vi);
      if (ni === undefined) {
        ni = map.size;
        map.set(vi, ni);
        for (const a of attrs) {
          const attr = geo.attributes[a] as THREE.BufferAttribute;
          for (let c = 0; c < attr.itemSize; c++) arrays[a].push(attr.getComponent(vi, c));
        }
      }
      newIndex.push(ni);
    }
  }
  for (const a of attrs) {
    const attr = geo.attributes[a] as THREE.BufferAttribute;
    out.setAttribute(a, new THREE.Float32BufferAttribute(arrays[a], attr.itemSize));
  }
  out.setIndex(newIndex);
  return out;
}

/** Componentes conexos por vértices compartidos; luego se agrupan por proximidad de cajas (una planta = varias hojas). */
function splitConnected(geo: THREE.BufferGeometry, gap = 0.12): THREE.BufferGeometry[] {
  const index = geo.getIndex();
  if (!index) return [geo];
  const nV = geo.attributes.position.count;
  const parent = new Int32Array(nV);
  for (let i = 0; i < nV; i++) parent[i] = i;
  const find = (i: number) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const nT = index.count / 3;
  for (let t = 0; t < nT; t++) {
    const a = find(index.getX(t * 3)), b = find(index.getX(t * 3 + 1)), c = find(index.getX(t * 3 + 2));
    parent[b] = a; parent[find(c)] = find(a);
  }
  const groups = new Map<number, number[]>();
  for (let t = 0; t < nT; t++) {
    const r = find(index.getX(t * 3));
    let g = groups.get(r);
    if (!g) groups.set(r, (g = []));
    g.push(t);
  }
  // cajas por componente
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const comps = [...groups.values()].map((tris) => {
    const box = new THREE.Box3();
    for (const t of tris) for (let k = 0; k < 3; k++) box.expandByPoint(new THREE.Vector3().fromBufferAttribute(pos, index.getX(t * 3 + k)));
    return { tris, box };
  });
  // fusionar componentes cuyas cajas (expandidas) se tocan
  const merged: { tris: number[]; box: THREE.Box3 }[] = [];
  for (const c of comps.sort((a, b) => b.tris.length - a.tris.length)) {
    const target = merged.find((m) => m.box.clone().expandByScalar(gap).intersectsBox(c.box));
    if (target) { target.tris.push(...c.tris); target.box.union(c.box); }
    else merged.push({ tris: [...c.tris], box: c.box.clone() });
  }
  // descartar migajas
  const big = merged.filter((m) => m.tris.length > nT * 0.02);
  if (big.length <= 1) return [geo];
  return big.map((m) => subGeometry(geo, m.tris));
}

function prepareMaterial(src: THREE.Material, opts: VariantOptions): THREE.Material {
  const mat = (src as THREE.MeshStandardMaterial).clone();
  mat.side = THREE.DoubleSide;
  mat.roughness = Math.max(mat.roughness, 0.85);
  const hadAlpha = mat.transparent || mat.alphaTest > 0;
  mat.transparent = false;
  if (opts.alphaMap) {
    mat.alphaMap = opts.alphaMap;
    mat.alphaTest = 0.45;
  } else if (hadAlpha) {
    mat.alphaTest = 0.5;
  }
  const name = mat.name.toLowerCase();
  if (opts.registry) {
    if (/leaves|hoja/.test(name) && opts.windLeaves) addWindSway(mat, opts.windLeaves, opts.registry);
    else if (/branch|rama/.test(name) && opts.windBranches) addWindSway(mat, opts.windBranches, opts.registry);
  }
  return mat;
}

/**
 * Convierte un glTF en variantes independientes: un nodo con malla por variante (sets a/b/c…),
 * o, si solo hay una malla y se pide, sus piezas conexas. Cada variante se recentra en XZ y apoya en y=0.
 */
export function extractVariants(scene: THREE.Object3D, opts: VariantOptions = {}): Variant[] {
  scene.updateMatrixWorld(true);
  const meshNodes: THREE.Mesh[] = [];
  scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshNodes.push(o as THREE.Mesh); });

  // agrupar mallas por su nodo "variante" (padre con nombre _a, _b… o la propia malla)
  const byNode = new Map<THREE.Object3D, THREE.Mesh[]>();
  for (const m of meshNodes) {
    let n: THREE.Object3D = m;
    while (n.parent && n.parent !== scene && !/_[a-z]$|LOD\d/i.test(n.name)) n = n.parent;
    const key = /_[a-z]$/i.test(n.name) ? n : m;
    const arr = byNode.get(key) ?? [];
    arr.push(m);
    byNode.set(key, arr);
  }

  const materialCache = new Map<THREE.Material, THREE.Material>();
  const mat = (m: THREE.Material) => {
    let r = materialCache.get(m);
    if (!r) materialCache.set(m, (r = prepareMaterial(m, opts)));
    return r;
  };

  const raw: { geometry: THREE.BufferGeometry; material: THREE.Material }[][] = [];
  for (const meshes of byNode.values()) {
    const parts = meshes.map((m) => {
      const g = m.geometry.clone();
      g.applyMatrix4(m.matrixWorld);
      return { geometry: g, material: mat(m.material as THREE.Material) };
    });
    if (opts.splitComponents && byNode.size === 1 && parts.length === 1) {
      for (const piece of splitConnected(parts[0].geometry)) raw.push([{ geometry: piece, material: parts[0].material }]);
    } else raw.push(parts);
  }

  return raw.map((parts) => {
    const box = new THREE.Box3();
    for (const p of parts) { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox!); }
    const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
    for (const p of parts) {
      p.geometry.translate(-cx, -box.min.y, -cz);
      p.geometry.computeBoundingSphere();
    }
    return { parts, baseY: 0 };
  });
}
