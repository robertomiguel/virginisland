// Colocación determinista de árboles, flora baja, rocas y pasto.
import { ISLAND_SIZE } from './config';
import { LAKE, POOL, castleDistance, coastFactor, lakeNormDistance, riverDistance } from './island';
import { seeded, smoothstep } from './noise';
import { terrainHeight } from './terrain';

export interface Placed { x: number; y: number; z: number; rot: number; scale: number; kind: number; variant: number; sub?: number; r?: number }

// --- Árboles ------------------------------------------------------------------------------
// Modelos de Poly Haven simplificados con gltf-transform: lod1 cerca, lod2 a partir de TREE_NEAR.
export const TREE_KINDS = [
  { id: 'jacaranda_tree', lod1: '/models/jacaranda_tree_lod1.glb', lod2: '/models/jacaranda_tree_lod2.glb', alpha: '/models/jacaranda_tree_leaves_alpha.jpg', scale: [0.6, 0.85], minGap: 5.5, root: 2.0, trunk: 0.55 },   // alto, interior (el modelo mide 19 m)
  { id: 'island_tree_01', lod1: '/models/island_tree_01_lod1.glb', lod2: '/models/island_tree_01_lod2.glb', alpha: '/models/island_tree_01_leaves_alpha.jpg', scale: [1.3, 1.9], minGap: 4.5, root: 0.55, trunk: 0.3 },    // ancho y bajo, franja media y costa (el modelo mide 5 m)
] as const;
export const TREE_NEAR = 120; // metros hasta donde se usa el lod1

class Spacing {
  private cells = new Map<string, { x: number; z: number; r: number }[]>();
  constructor(private cell: number) {}
  ok(x: number, z: number, r: number): boolean {
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const list = this.cells.get(`${cx + i},${cz + j}`);
      if (!list) continue;
      for (const p of list) if (Math.hypot(p.x - x, p.z - z) < Math.max(r, p.r)) return false;
    }
    return true;
  }
  add(x: number, z: number, r: number) {
    const k = `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`;
    const list = this.cells.get(k) ?? [];
    list.push({ x, z, r });
    this.cells.set(k, list);
  }
}

/** Rejilla de círculos: pregunta rápida de "¿algo de radio r en (x,z) pisa uno de estos?". */
class CircleGrid {
  private cells = new Map<string, { x: number; z: number; r: number }[]>();
  constructor(private cell = 12) {}
  add(x: number, z: number, r: number) {
    const k = `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`;
    const list = this.cells.get(k) ?? [];
    list.push({ x, z, r });
    this.cells.set(k, list);
  }
  hits(x: number, z: number, r: number): boolean {
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      for (const p of this.cells.get(`${cx + i},${cz + j}`) ?? []) {
        if (Math.hypot(p.x - x, p.z - z) < p.r + r) return true;
      }
    }
    return false;
  }
}

/** Las rocas ya colocadas, en rejilla: los árboles y los troncos no pueden nacer dentro de una. */
let rockGrid: CircleGrid | null = null;
function rocksAsBlockers(): CircleGrid {
  if (!rockGrid) {
    rockGrid = new CircleGrid();
    for (const r of generateRocks()) rockGrid.add(r.x, r.z, r.r ?? 0);
  }
  return rockGrid;
}

function slopeAt(x: number, z: number): number {
  return Math.max(Math.abs(terrainHeight(x + 2, z) - terrainHeight(x - 2, z)), Math.abs(terrainHeight(x, z + 2) - terrainHeight(x, z - 2))) / 4;
}
/**
 * Cota del suelo bajo la base de una planta: la más baja de su contorno y cuánto desnivel hay.
 * Apoyando en la cota del centro, en una pendiente la mitad de abajo queda en el aire (raíz
 * colgando); tomando la más baja, el tronco se entierra del lado de arriba, que es lo que se ve
 * en el monte.
 */
function footing(x: number, z: number, radius: number): { lo: number; drop: number } {
  let lo = terrainHeight(x, z), hi = lo;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const h = terrainHeight(x + Math.cos(a) * radius, z + Math.sin(a) * radius);
    if (h < lo) lo = h;
    if (h > hi) hi = h;
  }
  return { lo, drop: hi - lo };
}

function nearWater(x: number, z: number): boolean {
  return riverDistance(x, z).d < 9 || lakeNormDistance(x, z) < LAKE.radius + 8 || Math.hypot(x - POOL.x, z - POOL.z) < POOL.radius + 6;
}

let treeCache: Placed[] | null = null;

export function generateTrees(candidates = 34000): Placed[] {
  if (treeCache && candidates === 34000) return treeCache; // la escena y las colisiones comparten lista
  const out: Placed[] = [];
  const half = ISLAND_SIZE / 2 - 24;
  const spacing = new Spacing(10);
  const rocks = rocksAsBlockers();
  for (let i = 0; i < candidates; i++) {
    const x = (seeded(i, 11) - 0.5) * 2 * half;
    const z = (seeded(i, 12) - 0.5) * 2 * half;
    const h = terrainHeight(x, z);
    if (h < 2.2 || h > 46) continue;
    if (slopeAt(x, z) > 0.55 || nearWater(x, z)) continue;

    const c = coastFactor(x, z); // 1 costa → 0 centro
    const density = 0.12 + 0.88 * smoothstep(1.0, 0.45, c); // de menos a más hacia el interior
    if (seeded(i, 13) > density) continue;

    // Especie según la distancia a la costa: palmeras en la orilla, jacarandas altas en el interior
    const r = seeded(i, 14);
    let kind: number;
    if (c > 0.8) kind = 1;
    else if (c > 0.58) kind = r < 0.6 ? 1 : 0;
    else kind = r < 0.7 ? 0 : 1;

    const k = TREE_KINDS[kind];
    if (!spacing.ok(x, z, k.minGap)) continue;
    const size = k.scale[0] + (k.scale[1] - k.scale[0]) * seeded(i, 15);
    const scale = size * (0.9 + 0.2 * (1 - Math.min(c, 1)));
    // Nada de troncos brotando dentro de un pedrusco: el cepellón tiene que caber fuera de la roca.
    if (rocks.hits(x, z, k.root * scale * 0.6)) continue;
    spacing.add(x, z, k.minGap);
    // La base se apoya en el punto más bajo del contorno de raíces; si el desnivel bajo el árbol
    // es mayor que su propio radio, no hay dónde plantarlo sin que quede colgando: se descarta.
    const { lo, drop } = footing(x, z, k.root * scale);
    if (drop > k.root * scale * 1.2) continue;
    out.push({ x, y: lo, z, rot: seeded(i, 16) * Math.PI * 2, scale, kind, variant: Math.floor(seeded(i, 17) * 6), r: k.trunk * scale });
  }
  if (candidates === 34000) treeCache = out;
  return out;
}

// --- Flora baja (helechos, arbustos, acedera, anturios) -------------------------------------
export const FLORA_KINDS = [
  { id: 'fern_02', url: '/models/fern_02.glb', alpha: '/models/fern_02_alpha.jpg', scale: [1.1, 1.8], inland: true },
  { id: 'shrub_03', url: '/models/shrub_03.glb', alpha: '/models/shrub_03_alpha.jpg', scale: [1.6, 2.6], inland: false },
  { id: 'shrub_sorrel_01', url: '/models/shrub_sorrel_01.glb', alpha: '/models/shrub_sorrel_01_alpha.jpg', scale: [1.0, 1.8], inland: false },
  { id: 'anthurium_botany_01', url: '/models/anthurium_botany_01.glb', alpha: '/models/anthurium_botany_01_alpha.jpg', scale: [0.9, 1.4], inland: true },
] as const;

export function generateFlora(candidates = 40000, variantCounts: number[] = [4, 4, 11, 6]): Placed[] {
  const out: Placed[] = [];
  const half = ISLAND_SIZE / 2 - 24;
  for (let i = 0; i < candidates; i++) {
    const x = (seeded(i, 21) - 0.5) * 2 * half;
    const z = (seeded(i, 22) - 0.5) * 2 * half;
    const h = terrainHeight(x, z);
    if (h < 2.0 || h > 40) continue;
    if (slopeAt(x, z) > 0.6) continue;
    if (riverDistance(x, z).d < 5 || lakeNormDistance(x, z) < LAKE.radius + 3 || Math.hypot(x - POOL.x, z - POOL.z) < POOL.radius + 2) continue;
    const c = coastFactor(x, z);
    const r = seeded(i, 23);
    let kind: number;
    if (c < 0.6) kind = r < 0.45 ? 0 : r < 0.65 ? 3 : r < 0.85 ? 1 : 2;
    else kind = r < 0.5 ? 1 : r < 0.85 ? 2 : 0;
    const density = 0.3 + 0.7 * smoothstep(1.0, 0.45, c); // sotobosque denso en la selva interior
    if (seeded(i, 24) > density) continue;
    const k = FLORA_KINDS[kind];
    const scale = k.scale[0] + (k.scale[1] - k.scale[0]) * seeded(i, 25);
    const y = footing(x, z, 0.35 * scale).lo - 0.03;
    out.push({ x, y, z, rot: seeded(i, 26) * Math.PI * 2, scale, kind, variant: Math.floor(seeded(i, 27) * variantCounts[kind]) });
  }
  return out;
}

// --- Rocas ---------------------------------------------------------------------------------
// `radius` y `height` son la huella y el alto del modelo (medidos en el GLB): en metros son eso por la escala.
export const ROCK_KINDS = [
  { id: 'namaqualand_boulder_05', lod1: '/models/namaqualand_boulder_05_lod1.glb', lod2: '/models/namaqualand_boulder_05_lod2.glb', scale: [0.6, 1.8], split: false, radius: 0.68, height: 0.53 },
  { id: 'namaqualand_boulder_03', lod1: '/models/namaqualand_boulder_03_lod1.glb', lod2: '/models/namaqualand_boulder_03_lod2.glb', scale: [0.6, 2.2], split: false, radius: 1.53, height: 1.47 },
  { id: 'rock_moss_set_01', lod1: '/models/rock_moss_set_01_lod1.glb', lod2: '/models/rock_moss_set_01_lod2.glb', scale: [0.8, 1.6], split: true, radius: 1.40, height: 1.40 },
] as const;

const rockCache = new Map<string, Placed[]>();

export function generateRocks(candidates = 9000, variantCounts: number[] = [1, 1, 1]): Placed[] {
  // Se memoriza: la misma lista la usan la capa instanciada, los árboles y las colisiones.
  const key = `${candidates}|${variantCounts.join(',')}`;
  const cached = rockCache.get(key);
  if (cached) return cached;
  const out: Placed[] = [];
  const half = ISLAND_SIZE / 2 - 24;
  for (let i = 0; i < candidates; i++) {
    const x = (seeded(i, 31) - 0.5) * 2 * half;
    const z = (seeded(i, 32) - 0.5) * 2 * half;
    const h = terrainHeight(x, z);
    if (h < 0.6 || h > 88) continue;
    if (riverDistance(x, z).d < 4 || lakeNormDistance(x, z) < LAKE.radius - 2) continue;
    if (castleDistance(x, z) < 2) continue; // la explanada del castillo se deja limpia
    const c = coastFactor(x, z);
    const s = slopeAt(x, z);
    // más rocas en la costa, en laderas y en la montaña
    const density = 0.06 + 0.25 * smoothstep(0.75, 1.0, c) + 0.35 * smoothstep(0.25, 0.6, s) + 0.2 * smoothstep(30, 60, h);
    if (seeded(i, 33) > density) continue;
    const r = seeded(i, 34);
    const kind = c < 0.6 && r < 0.3 ? 2 : r < 0.65 ? 0 : 1;
    const k = ROCK_KINDS[kind];
    const scale = k.scale[0] + (k.scale[1] - k.scale[0]) * seeded(i, 35) * seeded(i, 36);
    out.push({ x, y: h - 0.15 * scale, z, rot: seeded(i, 37) * Math.PI * 2, scale, kind, variant: Math.floor(seeded(i, 38) * variantCounts[kind]), r: k.radius * scale });
  }
  rockCache.set(key, out);
  return out;
}

// --- Pasto y flores (solo cerca de la cámara) ----------------------------------------------
// El pasto son matas de musgo (moss_01 de Poly Haven): matojos sueltos que se agrupan en corros.
export const GRASS_MODEL = { url: '/models/moss_01.glb', alpha: '/models/moss_01_alpha.jpg', tuftScale: 8 } as const;
export const GRASS_VARIANTS = 5;
// Flores: modelos de Poly Haven (antes eran tallos y pétalos de geometría hecha a mano).
// `variant` de un elemento con kind 1 dice la especie; `sub`, cuál de los ejemplares del modelo.
export const FLOWER_KINDS = [
  { id: 'celandine_01', url: '/models/celandine_01.glb', alpha: '/models/celandine_01_alpha.jpg', scale: [1.2, 1.9] },                 // amarillas, 12-19 cm
  { id: 'dandelion_01', url: '/models/dandelion_01.glb', alpha: '/models/dandelion_01_alpha.jpg', scale: [1.6, 2.6] },                 // blancas, 5-16 cm
  { id: 'flower_gazania', url: '/models/flower_gazania.glb', alpha: '/models/flower_gazania_alpha.jpg', scale: [1.2, 2.0] },           // naranjas, 6-24 cm
  { id: 'flower_heliophila', url: '/models/flower_heliophila.glb', alpha: '/models/flower_heliophila_alpha.jpg', scale: [0.8, 1.3] },  // mata baja de flores blancas menudas, 27-40 cm
] as const;

export function generateGrass(candidates = 60000): Placed[] {
  const out: Placed[] = [];
  const half = ISLAND_SIZE / 2 - 24;
  for (let i = 0; i < candidates; i++) {
    const x = (seeded(i, 41) - 0.5) * 2 * half;
    const z = (seeded(i, 42) - 0.5) * 2 * half;
    const h = terrainHeight(x, z);
    if (h < 2.4 || h > 44) continue;
    if (slopeAt(x, z) > 0.5) continue;
    if (riverDistance(x, z).d < 4.5 || lakeNormDistance(x, z) < LAKE.radius + 2) continue;
    const r = seeded(i, 43);
    const isFlower = r < 0.18;
    const kind = isFlower ? 1 : 0;
    const variant = isFlower ? Math.floor(seeded(i, 44) * FLOWER_KINDS.length) : Math.floor(seeded(i, 44) * GRASS_VARIANTS);
    const c = coastFactor(x, z);
    const tall = 1 + 0.9 * smoothstep(1.0, 0.4, c); // más alto y tupido en el interior
    const sc = (0.8 + seeded(i, 46) * 0.6) * (isFlower ? 1 : tall);
    const scale = isFlower ? sc * (FLOWER_KINDS[variant].scale[0] + (FLOWER_KINDS[variant].scale[1] - FLOWER_KINDS[variant].scale[0]) * seeded(i, 47)) : sc;
    out.push({ x, y: h - 0.02, z, rot: seeded(i, 45) * Math.PI * 2, scale, kind, variant, sub: Math.floor(seeded(i, 48) * 8) });
  }
  return out;
}

// --- Troncos caídos ------------------------------------------------------------------------
// `half` es la media longitud del tronco en el modelo; `thick`, su radio. En metros, por la escala.
export const LOG_KINDS = [
  { id: 'dead_tree_trunk_02', lod1: '/models/dead_tree_trunk_02_lod1.glb', lod2: '/models/dead_tree_trunk_02_lod2.glb', scale: [1.2, 2.4], half: 2.02, thick: 0.52 },
  { id: 'dead_tree_trunk', lod1: '/models/dead_tree_trunk_lod1.glb', lod2: '/models/dead_tree_trunk_lod2.glb', scale: [1.4, 2.6], half: 1.53, thick: 0.15 },
] as const;

let logCache: Placed[] | null = null;

export function generateLogs(candidates = 6000): Placed[] {
  if (logCache && candidates === 6000) return logCache;
  const out: Placed[] = [];
  const half = ISLAND_SIZE / 2 - 24;
  for (let i = 0; i < candidates; i++) {
    const x = (seeded(i, 51) - 0.5) * 2 * half;
    const z = (seeded(i, 52) - 0.5) * 2 * half;
    const h = terrainHeight(x, z);
    if (h < 2.5 || h > 40) continue;
    if (slopeAt(x, z) > 0.45 || nearWater(x, z)) continue;
    const c = coastFactor(x, z);
    const density = 0.02 + 0.16 * smoothstep(0.9, 0.4, c); // sobre todo en la selva interior
    if (seeded(i, 53) > density) continue;
    const kind = seeded(i, 54) < 0.5 ? 0 : 1;
    const k = LOG_KINDS[kind];
    const scale = k.scale[0] + (k.scale[1] - k.scale[0]) * seeded(i, 55);
    if (rocksAsBlockers().hits(x, z, k.half * scale)) continue; // ni atravesando un pedrusco
    out.push({ x, y: h - 0.08 * scale, z, rot: seeded(i, 56) * Math.PI * 2, scale, kind, variant: 0, r: k.thick * scale });
  }
  if (candidates === 6000) logCache = out;
  return out;
}
