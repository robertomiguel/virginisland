// Colocación determinista de árboles, flora baja, rocas y pasto.
import { ISLAND_SIZE } from './config';
import { LAKE, POOL, castleDistance, coastFactor, lakeNormDistance, riverDistance } from './island';
import { seeded, smoothstep } from './noise';
import { terrainHeight } from './terrain';

export interface Placed { x: number; y: number; z: number; rot: number; scale: number; kind: number; variant: number; sub?: number; r?: number; rank?: number }

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

// --- Flora baja (helechos, arbustos, acedera, anturios, matorral) ---------------------------
/**
 * `parts` dice a qué materiales del modelo se les pone el mapa alfa: los matorrales de Poly Haven
 * traen tronco (malla maciza, opaca), hojas y ramitas (tarjetas recortadas), y el alfa solo va en
 * las dos últimas; los modelos de un solo material lo llevan entero (`parts` vacío).
 * `far`, hasta dónde se dibuja la especie: una planta de 17k triángulos no puede alcanzar tan lejos
 * como una de 300 (el anturio, con 11k, era él solo la mitad de los triángulos de la isla).
 */
export const FLORA_KINDS = [
  { id: 'fern_02', url: '/models/fern_02.glb', alpha: '/models/fern_02_alpha.jpg', scale: [1.1, 1.8], parts: [] as readonly string[], far: 160 },
  { id: 'shrub_03', url: '/models/shrub_03.glb', alpha: '/models/shrub_03_alpha.jpg', scale: [1.6, 2.6], parts: [] as readonly string[], far: 160 },
  { id: 'shrub_sorrel_01', url: '/models/shrub_sorrel_01.glb', alpha: '/models/shrub_sorrel_01_alpha.jpg', scale: [1.0, 1.8], parts: [] as readonly string[], far: 160 },
  { id: 'anthurium_botany_01', url: '/models/anthurium_botany_01.glb', alpha: '/models/anthurium_botany_01_alpha.jpg', scale: [0.9, 1.4], parts: [] as readonly string[], far: 70 },
  // Matorral de la colección namaqualand (arbustos secos de 0,4 a 5 m), ver guardado/pipeline-plantas
  { id: 'searsia_lucida', url: '/models/searsia_lucida.glb', alpha: '/models/searsia_lucida_alpha.jpg', scale: [0.7, 1.3], parts: ['leaves', 'twigs'] as readonly string[], far: 110 },
  { id: 'othonna_cerarioides', url: '/models/othonna_cerarioides.glb', alpha: '/models/othonna_cerarioides_alpha.jpg', scale: [0.8, 1.4], parts: ['leaves'] as readonly string[], far: 140 },
  { id: 'searsia_burchellii', url: '/models/searsia_burchellii.glb', alpha: '/models/searsia_burchellii_alpha.jpg', scale: [0.6, 1.1], parts: ['leaves', 'twigs'] as readonly string[], far: 100 },
] as const;

/**
 * Reparto de especies por franja. Los tres namaqualand son matorral seco: pesan hacia la costa y
 * el monte bajo, y poco en la selva húmeda del interior. Cada fila suma 1.
 */
const FLORA_MIX = {
  interior: [0.36, 0.16, 0.12, 0.18, 0.10, 0.05, 0.03],
  costa:    [0.06, 0.22, 0.18, 0.02, 0.24, 0.22, 0.06],
} as const;

export function generateFlora(candidates = 40000, variantCounts: number[] = [4, 4, 11, 6, 7, 7, 3]): Placed[] {
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
    const mix = c < 0.6 ? FLORA_MIX.interior : FLORA_MIX.costa;
    let kind = mix.length - 1, acc = 0;
    for (let m = 0; m < mix.length; m++) { acc += mix[m]; if (r < acc) { kind = m; break; } }
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

// --- Pasto ---------------------------------------------------------------------------------
/**
 * El pasto son matas de hierba de Poly Haven a su tamaño real: `grass_medium_02` (matojos de
 * 15-40 cm) y algo de musgo (`moss_01`, matojos de 3 cm) a ras de suelo. Antes era solo el musgo,
 * agrandado ×8 y sembrado a 0,09 matas/m2: de cerca no había briznas, solo bultos verdes cada 3 m,
 * y lo que se veía como pasto era la textura del terreno.
 *
 * `grass_bermuda_01` y `grass_medium_01`, las otras dos hierbas del catálogo, se probaron y se
 * descartaron: sus atlas son mucho más oscuros (color medio de la brizna 78,84,42 y 34,35,17 frente
 * a 131,130,89) y sobre el suelo claro se leían como matojos quemados, no como pasto.
 *
 * `tufts` y `radius` arman cada mata a partir de los matojos del modelo; `scale`, el tamaño de la
 * mata ya puesta en el suelo; `share`, qué parte del pasto es de esta especie.
 */
export const GRASS_KINDS = [
  { id: 'grass_medium_02', url: '/models/grass_medium_02.glb', alpha: '/models/grass_medium_02_alpha.jpg', share: 0.82, tufts: [1, 2], radius: 0.15, tuftScale: 1, scale: [0.9, 1.9] },
  { id: 'moss_01', url: '/models/moss_01.glb', alpha: '/models/moss_01_alpha.jpg', share: 0.18, tufts: [7, 11], radius: 0.16, tuftScale: 3, scale: [1.2, 2.0] },
] as const;
export const GRASS_VARIANTS = 7;       // matas distintas que se arman por especie
export const GRASS_CELL = 4;           // lado de la celda de siembra, en metros
export const GRASS_DENSITY_NEAR = 3.4; // matas por m2 en la alfombra de los pies
export const GRASS_DENSITY = 1.8;      // matas por m2 a media distancia
export const GRASS_CARPET = 8;         // hasta este radio, la alfombra tupida
export const GRASS_NEAR = 18;          // aquí ya se ha ralado a GRASS_DENSITY
export const GRASS_FAR = 30;           // aquí no queda ninguna: de ahí para allá manda la textura

/**
 * Matas por m2 a esa distancia de la cámara. Tupido a los pies —que es donde se ve si el suelo
 * tiene pasto o no— y ralo hacia el borde, para que el pasto se acabe difuminado y no en un círculo.
 */
export function grassDensityAt(d: number): number {
  const carpet = GRASS_DENSITY_NEAR - GRASS_DENSITY;
  return (GRASS_DENSITY + carpet * (1 - smoothstep(GRASS_CARPET, GRASS_NEAR, d))) * (1 - smoothstep(GRASS_NEAR, GRASS_FAR, d));
}

/**
 * Matas de una celda de `GRASS_CELL` metros. A la densidad que hace falta para que el suelo se vea
 * cubierto no cabe una lista de toda la isla (serían cientos de miles de matas), así que se siembra
 * alrededor de la cámara: la celda es determinista, se siembra una vez al entrar en el radio y se
 * tira al salir, de modo que el pasto no baila cuando el jugador va y vuelve.
 *
 * Los rechazos por agua, altura y pendiente se hacen por celda —varían despacio y ahorran cinco
 * sondeos de terreno por mata—, con margen de media diagonal para que valgan en toda su superficie.
 * Solo la cota de cada mata se mide en su sitio.
 */
export function grassCell(ix: number, iz: number): Placed[] {
  const out: Placed[] = [];
  const x0 = ix * GRASS_CELL, z0 = iz * GRASS_CELL;
  const cx = x0 + GRASS_CELL / 2, cz = z0 + GRASS_CELL / 2;
  const margin = GRASS_CELL * 0.71; // media diagonal de la celda
  const hc = terrainHeight(cx, cz);
  if (hc < 1.0 || hc > 48) return out;
  if (slopeAt(cx, cz) > 0.5) return out;
  if (riverDistance(cx, cz).d < 4.5 + margin) return out;
  if (lakeNormDistance(cx, cz) < LAKE.radius + 2 + margin) return out;
  if (Math.hypot(cx - POOL.x, cz - POOL.z) < POOL.radius + 2 + margin) return out;
  const tall = 1 + 0.5 * smoothstep(1.0, 0.4, coastFactor(cx, cz)); // más alto tierra adentro
  const base = Math.imul(ix, 73856093) ^ Math.imul(iz, 19349663);
  const n = Math.round(GRASS_DENSITY_NEAR * GRASS_CELL * GRASS_CELL);
  for (let k = 0; k < n; k++) {
    const s = base + k;
    const x = x0 + seeded(s, 61) * GRASS_CELL;
    const z = z0 + seeded(s, 62) * GRASS_CELL;
    const h = terrainHeight(x, z);
    if (h < 2.4 || h > 44) continue;
    const r = seeded(s, 63);
    let kind = GRASS_KINDS.length - 1, acc = 0;
    for (let i = 0; i < GRASS_KINDS.length; i++) { acc += GRASS_KINDS[i].share; if (r < acc) { kind = i; break; } }
    const sc = GRASS_KINDS[kind].scale;
    out.push({
      x, y: h - 0.02, z,
      rot: seeded(s, 65) * Math.PI * 2,
      scale: (sc[0] + (sc[1] - sc[0]) * seeded(s, 64)) * tall,
      kind,
      variant: Math.floor(seeded(s, 66) * GRASS_VARIANTS),
      rank: seeded(s, 67) * GRASS_DENSITY_NEAR, // matas por m2 que hacen falta para que esta salga
    });
  }
  return out;
}

// --- Flores --------------------------------------------------------------------------------
// Modelos de Poly Haven (antes eran tallos y pétalos de geometría hecha a mano).
// `variant` dice la especie; `sub`, cuál de los ejemplares del modelo.
export const FLOWER_KINDS = [
  { id: 'celandine_01', url: '/models/celandine_01.glb', alpha: '/models/celandine_01_alpha.jpg', scale: [1.2, 1.9] },                 // amarillas, 12-19 cm
  { id: 'dandelion_01', url: '/models/dandelion_01.glb', alpha: '/models/dandelion_01_alpha.jpg', scale: [1.6, 2.6] },                 // blancas, 5-16 cm
  { id: 'flower_gazania', url: '/models/flower_gazania.glb', alpha: '/models/flower_gazania_alpha.jpg', scale: [1.2, 2.0] },           // naranjas, 6-24 cm
  { id: 'flower_heliophila', url: '/models/flower_heliophila.glb', alpha: '/models/flower_heliophila_alpha.jpg', scale: [0.8, 1.3] },  // mata baja de flores blancas menudas, 27-40 cm
] as const;

/** Flores silvestres de toda la isla: son pocas y se listan de una vez, como el resto de la flora. */
export function generateFlowers(candidates = 60000): Placed[] {
  const out: Placed[] = [];
  const half = ISLAND_SIZE / 2 - 24;
  for (let i = 0; i < candidates; i++) {
    if (seeded(i, 43) >= 0.18) continue;
    const x = (seeded(i, 41) - 0.5) * 2 * half;
    const z = (seeded(i, 42) - 0.5) * 2 * half;
    const h = terrainHeight(x, z);
    if (h < 2.4 || h > 44) continue;
    if (slopeAt(x, z) > 0.5) continue;
    if (riverDistance(x, z).d < 4.5 || lakeNormDistance(x, z) < LAKE.radius + 2) continue;
    const variant = Math.floor(seeded(i, 44) * FLOWER_KINDS.length);
    const k = FLOWER_KINDS[variant];
    const scale = (0.8 + seeded(i, 46) * 0.6) * (k.scale[0] + (k.scale[1] - k.scale[0]) * seeded(i, 47));
    out.push({ x, y: h - 0.02, z, rot: seeded(i, 45) * Math.PI * 2, scale, kind: 1, variant, sub: Math.floor(seeded(i, 48) * 8) });
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
