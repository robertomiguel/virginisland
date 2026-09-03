// Colocación determinista de árboles, flora baja, rocas y pasto.
import { ISLAND_SIZE } from './config';
import { LAKE, POOL, coastFactor, lakeNormDistance, riverDistance } from './island';
import { seeded, smoothstep } from './noise';
import { terrainHeight } from './terrain';

export interface Placed { x: number; y: number; z: number; rot: number; scale: number; kind: number; variant: number }

// --- Árboles ------------------------------------------------------------------------------
export const TREE_KINDS = [
  { id: 'jacaranda', scale: [0.85, 1.2], minGap: 5.5 },   // alto, interior (procedural con atlas de Poly Haven)
  { id: 'island_tree', scale: [0.9, 1.3], minGap: 4.5 },  // ancho y bajo, franja media y costa
  { id: 'palm', scale: [0.85, 1.25], minGap: 3 },          // costa (procedural)
] as const;
export const PALM_VARIANTS = 6;

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

function slopeAt(x: number, z: number): number {
  return Math.max(Math.abs(terrainHeight(x + 2, z) - terrainHeight(x - 2, z)), Math.abs(terrainHeight(x, z + 2) - terrainHeight(x, z - 2))) / 4;
}
function nearWater(x: number, z: number): boolean {
  return riverDistance(x, z).d < 9 || lakeNormDistance(x, z) < LAKE.radius + 8 || Math.hypot(x - POOL.x, z - POOL.z) < POOL.radius + 6;
}

export function generateTrees(candidates = 34000): Placed[] {
  const out: Placed[] = [];
  const half = ISLAND_SIZE / 2 - 24;
  const spacing = new Spacing(10);
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
    if (c > 0.8) kind = 1; // (palmeras pendientes de un modelo mejor)
    else if (c > 0.58) kind = r < 0.6 ? 1 : 0;
    else kind = r < 0.7 ? 0 : 1;

    const k = TREE_KINDS[kind];
    if (!spacing.ok(x, z, k.minGap)) continue;
    spacing.add(x, z, k.minGap);
    const size = k.scale[0] + (k.scale[1] - k.scale[0]) * seeded(i, 15);
    const scale = size * (0.9 + 0.2 * (1 - Math.min(c, 1)));
    out.push({ x, y: h, z, rot: seeded(i, 16) * Math.PI * 2, scale, kind, variant: Math.floor(seeded(i, 17) * 6) });
  }
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
    out.push({ x, y: h - 0.03, z, rot: seeded(i, 26) * Math.PI * 2, scale, kind, variant: Math.floor(seeded(i, 27) * variantCounts[kind]) });
  }
  return out;
}

// --- Rocas ---------------------------------------------------------------------------------
export const ROCK_KINDS = [
  { id: 'namaqualand_boulder_05', lod1: '/models/namaqualand_boulder_05_lod1.glb', lod2: '/models/namaqualand_boulder_05_lod2.glb', scale: [0.6, 1.8], split: false },
  { id: 'namaqualand_boulder_03', lod1: '/models/namaqualand_boulder_03_lod1.glb', lod2: '/models/namaqualand_boulder_03_lod2.glb', scale: [0.6, 2.2], split: false },
  { id: 'rock_moss_set_01', lod1: '/models/rock_moss_set_01_lod1.glb', lod2: '/models/rock_moss_set_01_lod2.glb', scale: [0.8, 1.6], split: true },
] as const;

export function generateRocks(candidates = 9000, variantCounts: number[] = [1, 1, 1]): Placed[] {
  const out: Placed[] = [];
  const half = ISLAND_SIZE / 2 - 24;
  for (let i = 0; i < candidates; i++) {
    const x = (seeded(i, 31) - 0.5) * 2 * half;
    const z = (seeded(i, 32) - 0.5) * 2 * half;
    const h = terrainHeight(x, z);
    if (h < 0.6 || h > 88) continue;
    if (riverDistance(x, z).d < 4 || lakeNormDistance(x, z) < LAKE.radius - 2) continue;
    const c = coastFactor(x, z);
    const s = slopeAt(x, z);
    // más rocas en la costa, en laderas y en la montaña
    const density = 0.06 + 0.25 * smoothstep(0.75, 1.0, c) + 0.35 * smoothstep(0.25, 0.6, s) + 0.2 * smoothstep(30, 60, h);
    if (seeded(i, 33) > density) continue;
    const r = seeded(i, 34);
    const kind = c < 0.6 && r < 0.3 ? 2 : r < 0.65 ? 0 : 1;
    const k = ROCK_KINDS[kind];
    const scale = k.scale[0] + (k.scale[1] - k.scale[0]) * seeded(i, 35) * seeded(i, 36);
    out.push({ x, y: h - 0.15 * scale, z, rot: seeded(i, 37) * Math.PI * 2, scale, kind, variant: Math.floor(seeded(i, 38) * variantCounts[kind]) });
  }
  return out;
}

// --- Pasto y flores (solo cerca de la cámara) ----------------------------------------------
export const GRASS_VARIANTS = 5;
export const FLOWER_COLORS = ['#f2e14c', '#e9e9f2', '#d95c8a', '#8a6cd9'];

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
    const variant = isFlower ? Math.floor(seeded(i, 44) * FLOWER_COLORS.length) : Math.floor(seeded(i, 44) * GRASS_VARIANTS);
    const c = coastFactor(x, z);
    const tall = 1 + 0.9 * smoothstep(1.0, 0.4, c); // más alto y tupido en el interior
    out.push({ x, y: h - 0.02, z, rot: seeded(i, 45) * Math.PI * 2, scale: (0.8 + seeded(i, 46) * 0.6) * (isFlower ? 1 : tall), kind, variant });
  }
  return out;
}

// --- Troncos caídos ------------------------------------------------------------------------
export const LOG_KINDS = [
  { id: 'dead_tree_trunk_02', lod1: '/models/dead_tree_trunk_02_lod1.glb', lod2: '/models/dead_tree_trunk_02_lod2.glb', scale: [1.2, 2.4] },
  { id: 'dead_tree_trunk', lod1: '/models/dead_tree_trunk_lod1.glb', lod2: '/models/dead_tree_trunk_lod2.glb', scale: [1.4, 2.6] },
] as const;

export function generateLogs(candidates = 6000): Placed[] {
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
    out.push({ x, y: h - 0.08 * scale, z, rot: seeded(i, 56) * Math.PI * 2, scale, kind, variant: 0 });
  }
  return out;
}
