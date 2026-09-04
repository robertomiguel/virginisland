// Generador de islas: forma de la costa, relieve, montaña, barranco con río y laguna.
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
    { x: -66, z: -46, bed: 0 },   // labio del salto
    { x: -64.8, z: -44.8, bed: 7.0 }, // pie del acantilado
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
/**
 * El salto del barranco: la repisa donde el cauce se corta a plomo y la poza a su pie. No cae agua
 * por él —a 57 m de altura y 7 m de ancho no hay forma de que una lámina de agua parezca real, así
 * que el arroyo de la montaña no se dibuja: la garganta baja seca y la poza es un manantial—, pero
 * la geometría sigue haciendo falta: labra el anfiteatro, es lo que cruza el puente y de ahí arranca
 * la lámina del río.
 */
export const WATERFALL = { lipX: 0, lipZ: 0, lipY: 0, dirX: 0, dirZ: 0, poolY: 0, width: 7 };
/** Cuánto se excava el hueco de la cascada por delante del labio (hasta la poza). */
const FALL_RUN = 15;

/**
 * Emplazamiento del castillo: la cima de la montaña recortada en una meseta.
 * `half`/`corner` son el rectángulo redondeado (en coordenadas del castillo, girado `angle`) que
 * queda perfectamente llano; de ahí hacia fuera el terreno vuelve al natural en `blend` metros,
 * lo que deja un escarpe del mismo orden de pendiente que las laderas de la montaña.
 * `level` se calcula abajo: la media del terreno natural bajo la meseta más `fill` de relleno.
 */
export const CASTLE = {
  x: -116, z: -76,
  angle: Math.atan2(108, 72), // la puerta (eje +z local) mira al centro de la isla
  half: 28,      // semilado de la meseta llana
  corner: 8,     // radio de las esquinas del rectángulo
  blend: 32,     // anchura del escarpe hasta el terreno natural
  fill: 11,      // cuánto sube la meseta sobre la media del terreno que ocupa
  enceinte: 16.455, // semilado del recinto amurallado (tres módulos del kit por lado)
  level: 0,      // cota de la explanada (se calcula al cargar)
};

/** Distancia con signo al borde de la meseta (negativa dentro, en metros). */
export function castleDistance(x: number, z: number): number {
  const c = Math.cos(CASTLE.angle), s = Math.sin(CASTLE.angle);
  const dx = x - CASTLE.x, dz = z - CASTLE.z;
  const lx = Math.abs(dx * c - dz * s) - (CASTLE.half - CASTLE.corner);
  const lz = Math.abs(dx * s + dz * c) - (CASTLE.half - CASTLE.corner);
  return Math.hypot(Math.max(lx, 0), Math.max(lz, 0)) + Math.min(Math.max(lx, lz), 0) - CASTLE.corner;
}

// El río se traza sobre el terreno natural: la meseta no existe hasta que RIVER está construido.
let plateauReady = false;

/** Explanada del castillo sobre el terreno natural. El barranco del río recorta el escarpe. */
function applyPlateau(x: number, z: number, h: number): number {
  if (!plateauReady) return h;
  const d = castleDistance(x, z);
  if (d > CASTLE.blend) return h;
  const t = (1 - smoothstep(0, CASTLE.blend, d)) * smoothstep(5, 16, riverDistance(x, z).d);
  return h + (CASTLE.level - h) * t;
}

/**
 * Camino de acceso al castillo: sale de la puerta, rodea la explanada y baja dando la vuelta al
 * monte hasta el llano. Se traza andando: en cada paso se mira la pendiente del terreno y se
 * avanza en la dirección que baja justo lo que pide `grade` —entre la línea de máxima pendiente y
 * la curva de nivel—, de modo que la calzada mantiene siempre la misma inclinación. Donde la
 * ladera es más tendida que el camino, baja de frente; donde es un cortado, tira de curva de nivel
 * y lo rodea, que es como se salva el barranco de la cascada. La calzada se labra en la ladera:
 * desmonte por el lado de arriba y terraplén por el de abajo, que es lo que hace el banco.
 */
export const ROAD = {
  halfWidth: 3.6,  // media anchura de la calzada llana
  shoulder: 5,     // desmonte y terraplén a cada lado hasta empalmar con la ladera
  grade: 0.17,     // pendiente de la calzada
  step: 2.5,       // longitud de cada tramo del trazado
  foot: 12,        // cota donde acaba el camino y sigue el llano
  clearRiver: 14,  // a partir de aquí el trazado se separa del cauce
};

export interface RoadPoint { x: number; z: number; y: number; s: number; deck?: boolean }
/** El puente sobre la poza de la cascada, si el trazado ha necesitado uno. */
export const BRIDGE = { x1: 0, z1: 0, x2: 0, z2: 0, y1: 0, y2: 0, width: 4.6, span: 0 };
export const ROAD_PATH: RoadPoint[] = [];
let roadReady = false;
let roadRange = 0; // hasta dónde llega el trazado desde el castillo: fuera de ahí ni se mira

/** Terreno con río, laguna y el hueco de la cascada, pero sin camino: sobre esto se traza. */
function groundHeight(x: number, z: number): number {
  return applyWaterfall(x, z, applyWaterFeatures(x, z, naturalHeight(x, z)));
}

/**
 * Holgura al cauce para el trazado. La distancia en planta no basta: al pie de la cascada el
 * camino pasa a 4 m del labio pero 18 m por debajo, y ahí no estorba nadie. Sólo cuenta el cauce
 * que esté más o menos a la misma cota que la calzada.
 */
function riverClearance(x: number, z: number, y: number): number {
  const rv = riverDistance(x, z);
  return Math.abs(rv.bed - y) > 8 ? 999 : rv.d;
}

/** Distancia en planta a la línea del salto (del labio a la poza): el puente no la pisa. */
function fallDistance(x: number, z: number): number {
  const ax = x - WATERFALL.lipX, az = z - WATERFALL.lipZ;
  const l = Math.hypot(POOL.x - WATERFALL.lipX, POOL.z - WATERFALL.lipZ) || 1;
  const ux = (POOL.x - WATERFALL.lipX) / l, uz = (POOL.z - WATERFALL.lipZ) / l;
  const t = Math.min(l, Math.max(0, ax * ux + az * uz));
  return Math.hypot(ax - ux * t, az - uz * t);
}

/** Radio, mirando desde el castillo por el azimut `a`, al que la ladera está a la cota `y`. */
function contourRadius(a: number, y: number): number {
  let lo = 10, hi = 150; // alrededor de la meseta la ladera solo baja al alejarse: basta con bisecar
  for (let i = 0; i < 26; i++) {
    const m = (lo + hi) / 2;
    if (groundHeight(CASTLE.x + Math.cos(a) * m, CASTLE.z + Math.sin(a) * m) > y) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}


/**
 * Distancia al eje del camino y cota de la calzada. `h` es la cota del terreno ahí: cuando dos
 * revueltas se pisan, entre dos tramos igual de cerca gana el que va a la altura del terreno, y así
 * cada revuelta labra su propio banco en vez de dejar un escalón donde cambia el tramo más próximo.
 */
export function roadDistance(x: number, z: number, h = 0): { d: number; y: number } {
  let best = Infinity, y = 0, d = Infinity;
  for (let i = 0; i < ROAD_PATH.length - 1; i++) {
    const a = ROAD_PATH[i], b = ROAD_PATH[i + 1];
    if (b.deck) continue; // el vano del puente va por el aire: ahí no se toca el terreno
    const abx = b.x - a.x, abz = b.z - a.z;
    const len2 = abx * abx + abz * abz || 1e-6;
    let t = ((x - a.x) * abx + (z - a.z) * abz) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = a.x + abx * t, pz = a.z + abz * t;
    const seg = a.y + (b.y - a.y) * t;
    const d2 = Math.hypot(x - px, z - pz) + Math.abs(seg - h) * 0.35;
    if (d2 < best) { best = d2; y = seg; d = Math.hypot(x - px, z - pz); }
  }
  return { d, y };
}

/** Labra el camino en la ladera. Va después del río: la calzada manda sobre la forma del valle. */
export function applyRoad(x: number, z: number, h: number): number {
  if (!roadReady) return h;
  if (Math.abs(x - CASTLE.x) > roadRange || Math.abs(z - CASTLE.z) > roadRange) return h;
  const rd = roadDistance(x, z, h);
  const edge = ROAD.halfWidth + ROAD.shoulder;
  if (rd.d > edge) return h;
  const delta = rd.y - h;
  // Se labra un banco en la ladera, no un terraplén ni una trinchera: donde el terreno se despeña
  // (el borde del barranco) el camino no lo rellena, se queda al filo.
  const lim = delta > 0 ? smoothstep(10, 6, delta) : smoothstep(13, 9, -delta);
  return h + delta * lim * smoothstep(edge, ROAD.halfWidth, rd.d);
}

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

  let h = applyPlateau(x, z, base + hills + mountain * inside + detail);

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

{
  // Cota de la meseta: media del terreno natural que ocupa, más el relleno. Se desmocha la cima
  // y se rellenan las vaguadas del contorno, así que el corte y el terraplén quedan repartidos.
  let sum = 0, n = 0;
  for (let x = -CASTLE.half; x <= CASTLE.half; x += 2) {
    for (let z = -CASTLE.half; z <= CASTLE.half; z += 2) {
      const c = Math.cos(CASTLE.angle), s2 = Math.sin(CASTLE.angle);
      const wx = CASTLE.x + x * c + z * s2, wz = CASTLE.z - x * s2 + z * c;
      if (castleDistance(wx, wz) > 0) continue;
      sum += naturalHeight(wx, wz); n++;
    }
  }
  CASTLE.level = Math.round(sum / n + CASTLE.fill);
  plateauReady = true;
}

{
  // Trazado del camino. Arranca en la puerta, da media vuelta a la explanada por el borde y desde
  // ahí baja pegado a la curva de nivel que le toca a cada cota. Gira siempre en el mismo sentido
  // (alejándose del barranco del río) y se corta al llegar al pie del monte o si el cauce se acerca.
  const gateA = Math.atan2(Math.cos(CASTLE.angle), Math.sin(CASTLE.angle));
  const point = (a: number, r: number, y: number) => ({ x: CASTLE.x + Math.cos(a) * r, z: CASTLE.z + Math.sin(a) * r, y, s: 0 });

  ROAD_PATH.push({ x: CASTLE.x + Math.sin(CASTLE.angle) * CASTLE.enceinte, z: CASTLE.z + Math.cos(CASTLE.angle) * CASTLE.enceinte, y: CASTLE.level, s: 0 });
  const TURN0 = Math.PI / 3.2; // lo que rodea la explanada antes de empezar a bajar
  for (let k = 1; k <= 6; k++) {
    const a = gateA - (k / 6) * TURN0;
    ROAD_PATH.push(point(a, contourRadius(a, CASTLE.level - 0.1) - 1.5, CASTLE.level));
  }

  // Bajada. En cada tramo se prueban varios rumbos alrededor del que se llevaba y se elige el que
  // deja el siguiente punto a la cota que pide la pendiente. Así la calzada se apoya siempre en el
  // terreno —no hay que rellenar ni desmontar de más— y donde la ladera es un cortado el rumbo que
  // gana es el que va a media ladera, que es como el camino rodea el monte.
  let a = gateA - TURN0;
  const r0 = contourRadius(a, CASTLE.level - 0.1) - 1.5;
  const state = {
    x: CASTLE.x + Math.cos(a) * r0, z: CASTLE.z + Math.sin(a) * r0, y: CASTLE.level,
    hx: Math.cos(a - Math.PI / 2), hz: Math.sin(a - Math.PI / 2), // sale rodeando la explanada
  };

  function march(startSpan = Math.PI / 6, maxSteps = 500): 'cortado' | 'fin' {
    for (let i = 0; i < maxSteps && state.y > ROAD.foot; i++) {
      const want = state.y - ROAD.step * ROAD.grade;
      type Cand = { score: number; hx: number; hz: number; x: number; z: number; y: number };
      const probe = (span: number): Cand | null => {
        let best: Cand | null = null;
        for (let k = -9; k <= 9; k++) {
          const ang = (k / 9) * span;
          const nx = state.hx * Math.cos(ang) + state.hz * Math.sin(ang);
          const nz = -state.hx * Math.sin(ang) + state.hz * Math.cos(ang);
          const cx = state.x + nx * ROAD.step, cz = state.z + nz * ROAD.step;
          if (Math.hypot(cx - CASTLE.x, cz - CASTLE.z) > 170) continue;
          const g = groundHeight(cx, cz);
          const rio = riverClearance(cx, cz, g);
          if (rio < 5) continue;
          // El tramo tiene que apoyarse en el terreno de punta a punta: si en medio hay una vaguada
          // el camino quedaría en el aire (el terraplén tiene un límite), así que ese rumbo no vale.
          let hundido = false;
          for (const t of [0.25, 0.5, 0.75]) {
            const mx = state.x + (cx - state.x) * t, mz = state.z + (cz - state.z) * t;
            if (groundHeight(mx, mz) < state.y + (g - state.y) * t - 6) { hundido = true; break; }
          }
          if (hundido) continue;
          // castiga girar por girar y arrimarse al cauce, para que se separe él solo
          const score = Math.abs(g - want) + Math.abs(k) * 0.06 + Math.max(0, ROAD.clearRiver - rio) * 0.3;
          if (!best || score < best.score) best = { score, hx: nx, hz: nz, x: cx, z: cz, y: g };
        }
        return best;
      };
      // Primero con un giro suave; si en ese abanico no hay nada a la cota que toca (un cortado por
      // delante), se abre la horquilla y el camino da la revuelta.
      // El primer tramo de cada tirada puede elegir rumbo libremente (al salir del puente hay que
      // volverse hacia donde baja la ladera); a partir de ahí, giros de camino.
      let best = probe(i === 0 ? startSpan : Math.PI / 6);
      if (!best || Math.abs(best.y - want) > 1) best = probe(i === 0 ? startSpan : (Math.PI * 5) / 12) ?? best;
      if (!best) return 'cortado';
      if (want - best.y > 3.5 || best.y > state.y + 0.2) return 'cortado';
      state.hx = best.hx; state.hz = best.hz; state.x = best.x; state.z = best.z; state.y = best.y;
      ROAD_PATH.push({ x: state.x, z: state.z, y: state.y, s: 0 });
    }
    return 'fin';
  }

  /**
   * Al llegar al cortado del barranco se busca dónde volar: un punto al otro lado, a la misma cota
   * que la calzada, con el fondo bien hundido por debajo. Es el puente sobre la poza de la cascada.
   */
  /** ¿El otro lado es una repisa donde apoyar el estribo y seguir, o un pináculo suelto? */
  function isShelf(x: number, z: number, y: number): boolean {
    let apoyos = 0;
    for (let a = 0; a < 16; a++) {
      const t = (a / 16) * Math.PI * 2;
      const g = groundHeight(x + Math.cos(t) * 6, z + Math.sin(t) * 6);
      if (Math.abs(g - y) < 3.5) apoyos++;
    }
    return apoyos >= 3;
  }

  function findBridge(giro = 22): boolean {
    type Vano = { score: number; x: number; z: number; y: number; agua: number };
    const buscar = (claraMin: number): Vano | null => {
      let best: Vano | null = null;
      // El abanico es ancho: el estribo puede quedar a un costado del camino y el puente salir en
      // esquina; para el ramal del mirador se mira en redondo.
      for (let k = -giro; k <= giro; k++) {
        const ang = (k * 5 * Math.PI) / 180;
        const nx = state.hx * Math.cos(ang) + state.hz * Math.sin(ang);
        const nz = -state.hx * Math.sin(ang) + state.hz * Math.cos(ang);
        for (let d = 14; d <= 42; d += 1) {
          const cx = state.x + nx * d, cz = state.z + nz * d;
          const g = groundHeight(cx, cz);
          if (Math.abs(g - state.y) > 3.5) continue;          // el tablero admite poca rasante
          if (riverClearance(cx, cz, g) < 8) continue;        // hay que poder seguir al otro lado
          // Tiene que haber vacío de verdad debajo, si no es un rodeo y no un puente; y cuanto más
          // despejada quede la cortina de agua, mejor.
          let hueco = 1e9, agua = 1e9;
          for (let t = 0; t <= 1.001; t += 0.05) {
            const mx = state.x + nx * d * t, mz = state.z + nz * d * t;
            agua = Math.min(agua, fallDistance(mx, mz));
            if (t >= 0.2 && t <= 0.8) hueco = Math.min(hueco, state.y - groundHeight(mx, mz));
          }
          if (hueco < 9 || agua < claraMin) continue;
          if (!isShelf(cx, cz, g)) continue;
          const score = d + Math.abs(g - state.y) * 3 + Math.abs(k) * 1.5 - Math.min(agua, 14) * 2;
          if (!best || score < best.score) best = { score, x: cx, z: cz, y: g, agua };
        }
      }
      return best;
    };
    // Primero se busca un vano que deje libre la cortina de agua; si el paso no da para tanto, se
    // cruza por donde se pueda: el barranco sólo se estrecha aquí.
    const best = buscar(9) ?? buscar(0);
    if (!best) return false;
    BRIDGE.x1 = state.x; BRIDGE.z1 = state.z; BRIDGE.x2 = best.x; BRIDGE.z2 = best.z;
    BRIDGE.y1 = state.y; BRIDGE.y2 = best.y;
    BRIDGE.span = Math.hypot(best.x - state.x, best.z - state.z);
    const l = BRIDGE.span || 1;
    state.hx = (best.x - state.x) / l; state.hz = (best.z - state.z) / l;
    state.x = best.x; state.z = best.z; state.y = best.y;
    ROAD_PATH.push({ x: state.x, z: state.z, y: state.y, s: 0, deck: true });
    return true;
  }

  // El camino baja hasta el llano: donde la ladera se corta, primero se busca puente y, si no lo
  // hay, se da la revuelta y se sigue zigzagueando por la misma ladera.
  // El camino baja hasta el llano: donde la ladera se corta, se da la revuelta y se sigue
  // zigzagueando por la misma ladera.
  let estado = march();
  for (let vuelta = 0; vuelta < 8 && estado === 'cortado'; vuelta++) {
    state.hx = -state.hx; state.hz = -state.hz;
    estado = march(Math.PI / 2.5);
  }

  // Ramal del mirador: desde el punto del camino más próximo al salto, un puente cruza el barranco
  // hasta la repisa de enfrente, justo delante de la cascada. El camino principal no pasa por ahí:
  // es una vuelta para verla de frente, así que el enlace no se labra (ya es calzada).
  {
    let mejor = -1, dist = Infinity;
    for (let i = 4; i < ROAD_PATH.length; i++) {
      const p = ROAD_PATH[i];
      const d = Math.hypot(p.x - WATERFALL.lipX, p.z - WATERFALL.lipZ);
      if (p.y > 30 && d < dist) { dist = d; mejor = i; }
    }
    if (mejor >= 0 && dist < 45) {
      const p = ROAD_PATH[mejor];
      state.x = p.x; state.z = p.z; state.y = p.y;
      state.hx = (WATERFALL.lipX - p.x) / dist; state.hz = (WATERFALL.lipZ - p.z) / dist;
      ROAD_PATH.push({ x: p.x, z: p.z, y: p.y, s: 0, deck: true });
      if (findBridge(36)) march(Math.PI * 0.9, 8);
    }
  }

  for (let i = 1; i < ROAD_PATH.length; i++) {
    const a0 = ROAD_PATH[i - 1], b0 = ROAD_PATH[i];
    b0.s = a0.s + Math.hypot(b0.x - a0.x, b0.z - a0.z);
    roadRange = Math.max(roadRange, Math.abs(b0.x - CASTLE.x), Math.abs(b0.z - CASTLE.z));
  }
  roadRange += ROAD.halfWidth + ROAD.shoulder + 2;
  roadReady = true;
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

/**
 * Anfiteatro del salto. El cauce tiene ahí varios puntos del trazado casi en el mismo sitio y con
 * lechos muy distintos (es la caída), así que quedarse con el más cercano da una pared astillada:
 * picos de roca que atraviesan la cortina de agua. Aquí manda la distancia al labio medida en la
 * dirección de la caída, y sólo se excava, nunca se rellena. Se aplica el último, después del
 * camino, para que nada vuelva a taparlo.
 */
export function applyWaterfall(x: number, z: number, h: number): number {
  const ax = x - WATERFALL.lipX, az = z - WATERFALL.lipZ;
  const along = ax * WATERFALL.dirX + az * WATERFALL.dirZ;      // hacia dónde cae el agua
  const side = Math.abs(-ax * WATERFALL.dirZ + az * WATERFALL.dirX);
  const half = WATERFALL.width / 2 + 1.5;
  if (along > 0 && along < FALL_RUN && side < half + 9) {
    const lipBed = WATERFALL.lipY - RIVER_SURFACE_ABOVE_BED;
    const floor = POOL.bed + 0.5;
    const face = smoothstep(0, 1.6, along);                      // la pared cae a plomo
    const target = lipBed + (floor - lipBed) * face;
    const t = smoothstep(half + 9, half, side) * smoothstep(FALL_RUN, FALL_RUN - 4, along);
    h = h + (Math.min(h, target) - h) * t;
  }
  return h;
}

/** Nivel local de agua (mar, río, poza o laguna), con transiciones suaves para pintar orillas. */
export function localWaterLevel(x: number, z: number): number {
  let level = 0;
  const rv = riverDistance(x, z);
  // Aguas arriba de la poza la garganta baja seca: el río nace en el manantial del pie del salto.
  if (rv.s >= RIVER_POOL_S) {
    const riverLevel = rv.bed + RIVER_SURFACE_ABOVE_BED;
    level = Math.max(level, riverLevel * smoothstep(RIVER_CHANNEL_HALF_WIDTH + 18, RIVER_CHANNEL_HALF_WIDTH + 4, rv.d));
  }
  const dP = Math.hypot(x - POOL.x, z - POOL.z);
  level = Math.max(level, (POOL.bed + 1.6) * smoothstep(POOL.radius + 10, POOL.radius, dP));
  const dn = lakeNormDistance(x, z);
  level = Math.max(level, LAKE.level * smoothstep(LAKE.radius + 16, LAKE.radius + 3, dn));
  return level;
}
