// Kit modular de fuerte (Poly Haven modular_fort_01, CC0) y trazado del castillo de la cima.
import { CASTLE } from '../island';

/** Nombres de las piezas y qué son. Medidas en metros (ancho x, alto y, largo z); el origen es la esquina
 *  (mínimo x,z) salvo la torre, que está centrada. Los muros "rectos" corren a lo largo de +z. */
export const FORT_PIECES = {
  // Muralla gruesa (4.2 m de espesor, 8.5 m de alto): base del recinto
  wall_thick_straight_01: { size: [4.2, 8.5, 14.6], desc: 'muro grueso recto 14.6 m' },
  wall_thick_straight_02: { size: [4.2, 8.5, 14.6], desc: 'muro grueso recto 14.6 m (variante desgastada)' },
  wall_thick_corner_01: { size: [5.8, 8.5, 5.8], desc: 'esquina de muro grueso' },
  wall_thick_corner_02: { size: [7.1, 8.5, 5.7], desc: 'esquina de muro grueso (variante)' },
  wall_thick_end_01: { size: [4.2, 7.8, 4.9], desc: 'remate de muro grueso' },
  wall_thick_end_02: { size: [4.2, 8.5, 4.9], desc: 'remate de muro grueso con almenas' },
  wall_thick_thin_transition_01: { size: [4.2, 8.6, 3.6], desc: 'transición grueso → fino' },
  // Muralla fina (2.6 m de espesor): patios interiores, gate
  wall_thin_straight_01: { size: [2.6, 8.6, 14.8], desc: 'muro fino recto 14.8 m' },
  wall_thin_straight_02: { size: [2.6, 8.6, 14.8], desc: 'muro fino recto 14.8 m (variante)' },
  wall_thin_straight_03: { size: [2.6, 7.8, 7.4], desc: 'muro fino recto 7.4 m, bajo' },
  wall_thin_straight_04: { size: [2.6, 8.6, 7.4], desc: 'muro fino recto 7.4 m' },
  wall_thin_corner_01: { size: [4.6, 8.6, 4.6], desc: 'esquina de muro fino' },
  wall_thin_corner_02: { size: [5.3, 8.6, 5.3], desc: 'esquina de muro fino (variante)' },
  wall_thin_corner_03: { size: [6.5, 8.6, 5.0], desc: 'esquina de muro fino (variante)' },
  wall_thin_gate_01: { size: [2.7, 8.6, 7.4], desc: 'puerta en arco' },
  // Adarve (pasarela sobre la muralla) y escalera
  wall_walkway_straight_01: { size: [3.4, 7.7, 14.6], desc: 'adarve recto 14.6 m con revoque' },
  wall_walkway_straight_02: { size: [3.1, 7.5, 14.6], desc: 'adarve recto 14.6 m' },
  wall_walkway_corner_01: { size: [7.7, 7.5, 7.7], desc: 'adarve en esquina' },
  wall_walkway_corner_02: { size: [2.8, 7.1, 2.8], desc: 'adarve en esquina (pequeño)' },
  wall_walkway_end_01: { size: [3.1, 7.5, 4.9], desc: 'remate de adarve' },
  wall_stairs_straight_01: { size: [3.5, 7.5, 14.8], desc: 'escalera al adarve' },
  // Torre
  tower_round: { size: [15.8, 13.5, 15.8], desc: 'torre redonda (centrada)' },
} as const;

export type FortPieceName = keyof typeof FORT_PIECES;
export const FORT_PIECE_NAMES = Object.keys(FORT_PIECES) as FortPieceName[];

// --- Trazado del castillo -------------------------------------------------------------------
/**
 * Recinto cuadrado con torre redonda en cada esquina y la puerta en el centro del frente.
 *
 * Medidas del kit que manda todo: el muro fino mide 7.41 m de módulo y 2.55 m de espesor, con la
 * cara exterior en x=0 del modelo y el módulo corriendo hacia +z; el adarve mide 3.12 m de ancho y
 * su piso está a 7.1 m, igual que la banqueta interior del muro; la torre tiene 7.92 m de radio.
 * `wall_thin_straight_03` es el mismo módulo sin almenas y 0.8 m más bajo: sirve de variante.
 *
 * Las cortinas son tres módulos centrados en cada lado (22.23 m) y las torres van centradas en las
 * esquinas del recinto: como sobresalen 7.92 m, se tragan los 2.6 m que le faltan a cada cortina
 * para llegar a la esquina y no queda ninguna junta a la vista. Ese solape es también lo que
 * permite tirar el adarve de corrido: sus remates quedan dentro de las torres.
 */
const MOD = 7.41;          // módulo de muro fino
const WALL_T = 2.55;       // espesor del muro fino
const WALK_W = 3.12;       // ancho del adarve
const WALK_LEN = 14.56;    // módulo del adarve (no coincide con el del muro: se tira de corrido)
const HALF = CASTLE.enceinte; // semilado del recinto, medido en la cara exterior de la muralla
const SUNK = 0.15;         // cuánto se hunden las piezas para que no se vea la junta con el suelo

export interface Placement { name: FortPieceName; x: number; z: number; rotY: number; key: string }

/** Los cuatro lados: normal exterior (nx,nz), giro de las piezas y principio del tramo de cortina. */
const SIDES = [
  { id: 'frente', nx: 0, nz: 1, rot: Math.PI / 2, sx: -1.5 * MOD, sz: HALF, dx: 1, dz: 0 },
  { id: 'fondo', nx: 0, nz: -1, rot: -Math.PI / 2, sx: 1.5 * MOD, sz: -HALF, dx: -1, dz: 0 },
  { id: 'derecha', nx: 1, nz: 0, rot: Math.PI, sx: HALF, sz: 1.5 * MOD, dx: 0, dz: -1 },
  { id: 'izquierda', nx: -1, nz: 0, rot: 0, sx: -HALF, sz: -1.5 * MOD, dx: 0, dz: 1 },
] as const;

/** Piezas del castillo en coordenadas del recinto (+z es la puerta), antes de girarlo y llevarlo al monte. */
function castlePieces(): Placement[] {
  const out: Placement[] = [];
  const add = (name: FortPieceName, x: number, z: number, rotY: number, key: string) => out.push({ name, x, z, rotY, key });

  for (const s of SIDES) {
    for (let i = 0; i < 3; i++) {
      // Puerta en el módulo central del frente; una cortina más baja aquí y allá rompe la uniformidad.
      const gate = s.id === 'frente' && i === 1;
      const low = !gate && (s.id === 'fondo' ? i === 0 : s.id === 'derecha' && i === 2);
      const name: FortPieceName = gate ? 'wall_thin_gate_01' : low ? 'wall_thin_straight_03' : 'wall_thin_straight_04';
      add(name, s.sx + s.dx * MOD * i, s.sz + s.dz * MOD * i, s.rot, `${s.id}-muro-${i}`);
    }
    // Adarve por dentro de las tres cortinas que no tienen puerta (detrás de la puerta taparía el arco).
    if (s.id !== 'frente') {
      for (let i = 0; i < 2; i++) {
        const name: FortPieceName = i === 0 ? 'wall_walkway_straight_02' : 'wall_walkway_straight_01';
        add(name, s.sx - s.nx * WALL_T + s.dx * WALK_LEN * i, s.sz - s.nz * WALL_T + s.dz * WALK_LEN * i, s.rot, `${s.id}-adarve-${i}`);
      }
    }
  }

  // Torres en las cuatro esquinas: tapan los extremos de las cortinas y del adarve.
  let t = 0;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    add('tower_round', sx * HALF, sz * HALF, (t * Math.PI) / 2, `torre-${t}`); t++;
  }

  // Escalera al adarve: pegada al adarve del lado izquierdo y subiendo hacia +z. Arranca justo
  // delante del adarve del fondo, que si no le taparía el primer peldaño.
  add('wall_stairs_straight_01', -HALF + WALL_T + WALK_W, -HALF + WALL_T + WALK_W + 3.3, 0, 'escalera');
  return out;
}

/** Las mismas piezas ya colocadas en el mundo, sobre la explanada de la cima. */
export function castleLayout(): (Placement & { y: number })[] {
  const c = Math.cos(CASTLE.angle), s = Math.sin(CASTLE.angle);
  return castlePieces().map((p) => ({
    ...p,
    x: CASTLE.x + p.x * c + p.z * s,
    z: CASTLE.z - p.x * s + p.z * c,
    y: CASTLE.level - SUNK,
    rotY: p.rotY + CASTLE.angle,
  }));
}

