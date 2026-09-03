// Generador de islas: forma de la costa, relieve, montaña, río con cascada y laguna.
// Todo es determinista a partir de ISLAND (parámetros + semilla).
import { DEEP_SEA_FLOOR, ISLAND_RADIUS, ISLAND_SIZE } from './config';
import { fbm, smoothstep } from './noise';

export interface IslandParams {
  seed: number;
  radius: number;
  coastWarp: number;     // metros de deformación de la costa (bahías y cabos)
  landHeight: number;    // altura media de la tierra sobre el mar
  hillHeight: number;
  mountain: { x: number; z: number; radius: number; height: number };
  lake: { x: number; z: number; radius: number; irregularity: number };
  river: { x: number; z: number; bed: number }[];
}

export const ISLAND: IslandParams = {
  seed: 7,
  radius: ISLAND_RADIUS,
  coastWarp: 150,
  landHeight: 5,
  hillHeight: 34,
  mountain: { x: -95, z: -75, radius: 125, height: 85 },
  lake: { x: 100, z: 105, radius: 30, irregularity: 0.5 },
  river: [
    { x: -78, z: -58, bed: 0 },   // nacimiento (bed se ajusta al terreno natural)
    { x: -66, z: -46, bed: 0 },   // labio de la cascada
    { x: -64.8, z: -44.8, bed: 7.0 }, // pie del acantilado: caída vertical
    { x: -57, z: -37, bed: 7.0 }, // poza
    { x: -38, z: -24, bed: 6.8 },
    { x: -12, z: -18, bed: 6.0 },
    { x: 18, z: -26, bed: 5.2 },
    { x: 50, z: -16, bed: 4.4 },
    { x: 86, z: 0, bed: 3.6 },
    { x: 124, z: 14, bed: 2.8 },
    { x: 165, z: 34, bed: 1.8 },
    { x: 205, z: 52, bed: 0.4 },
    { x: 240, z: 66, bed: -2.5 },
    { x: 275, z: 82, bed: -6 },
  ],
};

const S = ISLAND.seed * 137.1; // desplazamiento de ruido según semilla

export const MOUNTAIN = ISLAND.mountain;
export const LAKE = { ...ISLAND.lake, level: 0 }; // level se calcula abajo
export const RIVER_SURFACE_ABOVE_BED = 1.0;
export const RIVER_CHANNEL_HALF_WIDTH = 3.0;
export const RIVER_VALLEY_HALF_WIDTH = 30;
export const POOL = { x: -58, z: -38, radius: 9, bed: 6.2 };
export const WATERFALL = { lipX: 0, lipZ: 0, lipY: 0, dirX: 0, dirZ: 0, poolY: 0, width: 7 };

/** Ruido "de crestas" en [0,1]: valles suaves y aristas marcadas. */
function ridged(x: number, z: number, octaves: number): number {
  return 1 - Math.abs(2 * fbm(x, z, octaves) - 1);
}

/** Factor de costa: ~0 en el centro de la isla, 1 en la línea de costa, >1 en el mar (coordenadas deformadas). */
export function coastFactor(x: number, z: number): number {
  const w = ISLAND.coastWarp;
  const wx = x + (fbm(x * 0.006 + S, z * 0.006 + S, 3) - 0.5) * w * 2;
  const wz = z + (fbm(x * 0.006 + S + 40, z * 0.006 + S + 40, 3) - 0.5) * w * 2;
  const r = Math.hypot(wx, wz);
  const angle = Math.atan2(wz, wx);
  const edgeNoise = (fbm(Math.cos(angle) * 2.5 + S + 10, Math.sin(angle) * 2.5 + S + 10, 2) - 0.5) * ISLAND.radius * 0.5;
  const radius = ISLAND.radius + edgeNoise;
  return r / (radius * 0.87); // 0.87: punto medio de la rampa de la costa
}

/** Máscara de tierra en [0,1]: 1 tierra firme, 0 mar. Costa deformada por ruido: bahías, cabos, ensenadas. */
export function landMask(x: number, z: number): number {
  const c = coastFactor(x, z) * 0.87;
  return 1 - smoothstep(0.74, 1, c);
}

/** Terreno natural (costa + colinas + montaña), sin río ni laguna. */
export function naturalHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const inside = landMask(x, z);
  const shelf = 1 - smoothstep(ISLAND.radius * 1.05, ISLAND.radius * 1.7, r); // plataforma costera, luego mar profundo

  const base = -14 + (14 + ISLAND.landHeight) * inside - 30 * (1 - shelf);

  // Colinas: mezcla de ruido suave y ruido de crestas, más altas hacia el interior
  const hillMask = (0.4 + 0.6 * smoothstep(50, 160, r)) * inside;
  const soft = fbm(x * 0.013 + 100 + S, z * 0.013 + 100 + S, 4) - 0.3;
  const crest = ridged(x * 0.009 + 200 + S, z * 0.009 + 200 + S, 3) - 0.55;
  const hills = (soft * 0.65 + crest * 0.45) * ISLAND.hillHeight * hillMask;

  const M = ISLAND.mountain;
  const dM = Math.hypot(x - M.x, z - M.z);
  const bump = 1 - smoothstep(0, M.radius, dM);
  const ridges = (ridged(x * 0.03 + 50 + S, z * 0.03 + 50 + S, 3) - 0.5) * 26 * bump;
  const mountain = M.height * bump * bump + ridges;

  const detail = (fbm(x * 0.25 + 300, z * 0.25 + 300, 2) - 0.5) * 0.8 * inside;

  let h = base + hills + mountain * inside + detail;

  // El borde del plano de terreno empalma exactamente con el fondo marino profundo
  const edge = smoothstep(0.8, 0.98, Math.max(Math.abs(x), Math.abs(z)) / (ISLAND_SIZE / 2));
  return h + (DEEP_SEA_FLOOR - h) * edge;
}

// --- Río: spline Catmull-Rom en planta, lecho lineal por tramo ----------------------------

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

export interface RiverSample { x: number; z: number; bed: number; s: number }

function buildRiver(): RiverSample[] {
  const c = ISLAND.river.map((p) => ({ ...p }));
  c[0].bed = naturalHeight(c[0].x, c[0].z) - 2.5;
  c[1].bed = naturalHeight(c[1].x, c[1].z) - 3.0;

  const samples: RiverSample[] = [];
  const perSeg = 12;
  let s = 0;
  for (let i = 0; i < c.length - 1; i++) {
    const p0 = c[Math.max(i - 1, 0)], p1 = c[i], p2 = c[i + 1], p3 = c[Math.min(i + 2, c.length - 1)];
    for (let j = 0; j < perSeg; j++) {
      const t = j / perSeg;
      const x = catmull(p0.x, p1.x, p2.x, p3.x, t);
      const z = catmull(p0.z, p1.z, p2.z, p3.z, t);
      const bed = p1.bed + (p2.bed - p1.bed) * t;
      if (samples.length) {
        const prev = samples[samples.length - 1];
        s += Math.hypot(x - prev.x, z - prev.z);
      }
      samples.push({ x, z, bed, s });
    }
  }
  const last = c[c.length - 1];
  const prev = samples[samples.length - 1];
  samples.push({ x: last.x, z: last.z, bed: last.bed, s: s + Math.hypot(last.x - prev.x, last.z - prev.z) });
  // Aguas abajo de la poza el lecho sigue el terreno natural (cauce poco profundo) y nunca sube.
  const poolS = samples.findIndex((p) => p.bed <= c[3].bed + 0.01);
  for (let i = 1; i < samples.length; i++) {
    const p = samples[i];
    if (i > poolS && poolS >= 0) p.bed = Math.min(p.bed, naturalHeight(p.x, p.z) - 2.2);
    p.bed = Math.min(p.bed, samples[i - 1].bed);
  }
  return samples;
}

export const RIVER: RiverSample[] = buildRiver();
/** Longitud de arco donde el río llega a la poza (a partir de ahí el valle es tendido). */
export const RIVER_POOL_S = RIVER.find((p) => p.bed <= ISLAND.river[3].bed + 0.01)?.s ?? 0;

{
  const lip = ISLAND.river[1], foot = ISLAND.river[2];
  const lipBed = naturalHeight(lip.x, lip.z) - 3.0;
  const dx = foot.x - lip.x, dz = foot.z - lip.z, l = Math.hypot(dx, dz) || 1;
  WATERFALL.lipX = lip.x; WATERFALL.lipZ = lip.z; WATERFALL.lipY = lipBed + RIVER_SURFACE_ABOVE_BED;
  WATERFALL.dirX = dx / l; WATERFALL.dirZ = dz / l;
  WATERFALL.poolY = POOL.bed + 1.6;
}

export function riverDistance(x: number, z: number): { d: number; bed: number; s: number } {
  let best = Infinity, bed = 0, s = 0;
  for (let i = 0; i < RIVER.length - 1; i++) {
    const a = RIVER[i], b = RIVER[i + 1];
    const abx = b.x - a.x, abz = b.z - a.z;
    const len2 = abx * abx + abz * abz || 1e-6;
    let t = ((x - a.x) * abx + (z - a.z) * abz) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = a.x + abx * t, pz = a.z + abz * t;
    const d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
    if (d2 < best) {
      best = d2;
      const cliff = (a.bed - b.bed) / Math.max(b.s - a.s, 0.01) > 1.5;
      const tb = cliff ? smoothstep(0.85, 1, t) : t;
      bed = a.bed + (b.bed - a.bed) * tb;
      s = a.s + (b.s - a.s) * t;
    }
  }
  return { d: Math.sqrt(best), bed, s };
}

// --- Laguna de contorno irregular ---------------------------------------------------------

/** Radio de la laguna en la dirección de un ángulo (contorno irregular). */
export function lakeRadiusAt(angle: number): number {
  const n = fbm(Math.cos(angle) * 1.8 + S + 90, Math.sin(angle) * 1.8 + S + 90, 3) - 0.5;
  return LAKE.radius * (1 + n * 2 * LAKE.irregularity);
}

/** Distancia al centro de la laguna normalizada al radio nominal (así el perfil radial vale para todo el contorno). */
export function lakeNormDistance(x: number, z: number): number {
  const dx = x - LAKE.x, dz = z - LAKE.z;
  const d = Math.hypot(dx, dz);
  return (d * LAKE.radius) / lakeRadiusAt(Math.atan2(dz, dx));
}

LAKE.level = Math.max(6, Math.round(naturalHeight(LAKE.x, LAKE.z) - 1));

/** Contorno de la lámina de agua de la laguna (polígono en XZ). */
export function lakeOutline(points = 96, margin = 1.5): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    const r = lakeRadiusAt(a) * ((LAKE.radius - 2 + margin) / LAKE.radius);
    out.push([LAKE.x + Math.cos(a) * r, LAKE.z + Math.sin(a) * r]);
  }
  return out;
}

/** Aplica río, poza y laguna sobre el terreno natural. */
export function applyWaterFeatures(x: number, z: number, h: number): number {
  const rv = riverDistance(x, z);
  if (rv.d < RIVER_VALLEY_HALF_WIDTH + 10) {
    const bankH = rv.bed + RIVER_SURFACE_ABOVE_BED + 1.6;
    const valley = smoothstep(RIVER_VALLEY_HALF_WIDTH, RIVER_CHANNEL_HALF_WIDTH + 12, rv.d) * smoothstep(-1, 2.5, rv.bed);
    h = h + (Math.max(h, bankH) - h) * valley;
    const channel = smoothstep(RIVER_CHANNEL_HALF_WIDTH + 12, RIVER_CHANNEL_HALF_WIDTH, rv.d); // orillas tendidas
    h = h + (rv.bed - h) * channel;
    // Justo fuera de la lámina de agua el terreno queda siempre por encima de ella (solo junto al cauce)
    if (rv.d < RIVER_CHANNEL_HALF_WIDTH + 6) {
      h = Math.max(h, rv.bed + 1.3 * smoothstep(RIVER_CHANNEL_HALF_WIDTH, RIVER_CHANNEL_HALF_WIDTH + 2.5, rv.d));
    }
    // Aguas abajo de la poza: valle en V tendido en vez de garganta (techo que sube 0.45 m por metro)
    if (rv.s > RIVER_POOL_S + 15 && rv.d < 70) {
      const ceiling = rv.bed + 2.6 + Math.max(0, rv.d - RIVER_CHANNEL_HALF_WIDTH - 6) * 0.45;
      h = Math.min(h, ceiling);
    }
  }

  const dP = Math.hypot(x - POOL.x, z - POOL.z);
  if (dP < POOL.radius + 2) {
    const blend = smoothstep(POOL.radius + 2, POOL.radius - 3, dP);
    h = h + (Math.min(h, POOL.bed) - h) * blend;
  }

  const dn = lakeNormDistance(x, z);
  const R = LAKE.radius;
  if (dn < R + 24) {
    const bed = LAKE.level - 5 + (fbm(x * 0.1, z * 0.1, 2) - 0.5) * 1.5;
    const rim = LAKE.level + 2.2;
    let prof: number;
    if (dn < R - 8) prof = bed;
    else if (dn < R) prof = bed + (rim - bed) * smoothstep(R - 8, R, dn);
    else prof = rim;
    const blend = smoothstep(R + 24, R + 6, dn);
    h = h + (prof - h) * blend;
  }
  return h;
}

/** Nivel local de agua (mar, río, poza o laguna), con transiciones suaves para pintar orillas. */
export function localWaterLevel(x: number, z: number): number {
  let level = 0;
  const rv = riverDistance(x, z);
  const riverLevel = rv.bed + RIVER_SURFACE_ABOVE_BED;
  level = Math.max(level, riverLevel * smoothstep(RIVER_CHANNEL_HALF_WIDTH + 18, RIVER_CHANNEL_HALF_WIDTH + 4, rv.d));
  const dP = Math.hypot(x - POOL.x, z - POOL.z);
  level = Math.max(level, (POOL.bed + 1.6) * smoothstep(POOL.radius + 10, POOL.radius, dP));
  const dn = lakeNormDistance(x, z);
  level = Math.max(level, LAKE.level * smoothstep(LAKE.radius + 16, LAKE.radius + 3, dn));
  return level;
}
