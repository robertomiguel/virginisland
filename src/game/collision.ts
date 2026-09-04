// Cuerpos sólidos del mundo: lo que no se puede atravesar caminando por la isla.
//
// Todo lo colocado es determinista (árboles, rocas, troncos, el castillo, el barco), así que los
// cuerpos se sacan de las mismas listas que dibuja la escena y se meten en una rejilla para poder
// preguntar sólo por los que están al lado. Cada cuerpo es un cilindro o una caja girada con una
// cota de pie y otra de techo:
//  - si el techo queda al alcance del paso, se sube encima (peldaños, rocas bajas, adarve, rampa);
//  - si no, empuja al jugador hacia fuera, que es lo que hace que se pueda rozar una pared;
//  - si el pie queda por encima de la cabeza, no estorba (se pasa por debajo).
import { SHIP } from './config';
import { BRIDGE } from './island';
import { LOG_KINDS, ROCK_KINDS, generateLogs, generateRocks, generateTrees } from './vegetation';
import { FORT_PIECES, castleLayout } from './world/castle';

export const PLAYER_RADIUS = 0.4; // radio del jugador en planta
export const STEP_UP = 0.8;       // desnivel que se sube sin saltar
const GATE_OPENING = 3.0;         // ancho del vano del arco de la puerta, medido en el modelo

export interface Body {
  x: number; z: number;
  rot: number;            // giro en Y; irrelevante en los cilindros
  hx: number; hz: number; // semiejes de la caja (en los cilindros, el radio en ambos)
  round: boolean;
  base: number;           // cota del pie
  top: number;            // cota del techo (en el extremo -z local si es rampa)
  topTo?: number;         // rampa: cota del techo en el extremo +z local
}

const CELL = 12;

class Grid {
  private cells = new Map<number, Body[]>();
  private key(cx: number, cz: number) { return (cx + 4096) * 8192 + (cz + 4096); }
  add(b: Body) {
    // Un cuerpo puede pisar varias celdas: se mete en todas las que toca su envolvente.
    const r = Math.hypot(b.hx, b.hz) + PLAYER_RADIUS;
    for (let cx = Math.floor((b.x - r) / CELL); cx <= Math.floor((b.x + r) / CELL); cx++) {
      for (let cz = Math.floor((b.z - r) / CELL); cz <= Math.floor((b.z + r) / CELL); cz++) {
        const k = this.key(cx, cz);
        const list = this.cells.get(k);
        if (list) list.push(b); else this.cells.set(k, [b]);
      }
    }
  }
  near(x: number, z: number): Body[] {
    return this.cells.get(this.key(Math.floor(x / CELL), Math.floor(z / CELL))) ?? [];
  }
}

let grid: Grid | null = null;

/** Cilindro: árboles, rocas y torres. */
function cyl(x: number, z: number, r: number, base: number, top: number): Body {
  return { x, z, rot: 0, hx: r, hz: r, round: true, base, top };
}
/** Caja girada: troncos, muros, adarve, cubierta del barco. */
function box(x: number, z: number, rot: number, hx: number, hz: number, base: number, top: number, topTo?: number): Body {
  return { x, z, rot, hx, hz, round: false, base, top, topTo };
}

/** Muros, torres, adarve y escalera del castillo, con el arco de la puerta abierto. */
function castleBodies(): Body[] {
  const out: Body[] = [];
  for (const p of castleLayout()) {
    const [w, hgt, len] = FORT_PIECES[p.name].size;
    if (p.name === 'tower_round') {
      out.push(cyl(p.x, p.z, w / 2, p.y, p.y + hgt));
      continue;
    }
    // Las piezas tienen el origen en la esquina (mínimo x,z): el centro cae media pieza adentro.
    const c = Math.cos(p.rotY), s = Math.sin(p.rotY);
    const at = (lx: number, lz: number) => ({ x: p.x + lx * c + lz * s, z: p.z - lx * s + lz * c });
    const ramp = p.name === 'wall_stairs_straight_01';
    // El piso del adarve está a 7.1 m (lo de más arriba es el bordillo); la escalera muere en él.
    const walk = p.name.startsWith('wall_walkway') ? 7.1 : hgt;
    if (p.name === 'wall_thin_gate_01') {
      // Puerta: las dos jambas macizas, y entre ellas el vano libre para pasar.
      const jamb = (len - GATE_OPENING) / 2;
      for (const lz of [jamb / 2, len - jamb / 2]) {
        const c0 = at(w / 2, lz);
        out.push(box(c0.x, c0.z, p.rotY, w / 2, jamb / 2, p.y, p.y + hgt));
      }
      continue;
    }
    const c0 = at(w / 2, len / 2);
    out.push(box(c0.x, c0.z, p.rotY, w / 2, len / 2,
      p.y, p.y + (ramp ? 0.3 : walk), ramp ? p.y + 7.1 : undefined));
  }
  return out;
}

function build(): Grid {
  const g = new Grid();

  for (const t of generateTrees()) {
    g.add(cyl(t.x, t.z, Math.max(t.r ?? 0, 0.25), t.y, t.y + 20)); // el tronco corta a cualquier altura
  }
  for (const r of generateRocks()) {
    g.add(cyl(r.x, r.z, (r.r ?? 0) * 0.85, r.y, r.y + ROCK_KINDS[r.kind].height * r.scale));
  }
  for (const l of generateLogs()) {
    const k = LOG_KINDS[l.kind];
    // El modelo del tronco es largo en x, así que la caja va al revés que en las piezas del fuerte.
    g.add(box(l.x, l.z, l.rot, k.half * l.scale, k.thick * l.scale, l.y, l.y + 2 * k.thick * l.scale));
  }
  for (const b of castleBodies()) g.add(b);

  // Puente: el tablero se pisa y los pretiles no dejan caerse. El pie va justo bajo el tablero,
  // así que desde el fondo del barranco se pasa por debajo sin tropezar con nada.
  if (BRIDGE.span > 0) {
    const mx = (BRIDGE.x1 + BRIDGE.x2) / 2, mz = (BRIDGE.z1 + BRIDGE.z2) / 2;
    // El tablero se modela como rampa a lo largo del vano (eje z local), que es como sabe
    // interpolar `topAt`: así se pisa igual de bien por el estribo alto que por el bajo.
    const yaw = Math.atan2(BRIDGE.x2 - BRIDGE.x1, BRIDGE.z2 - BRIDGE.z1);
    const rail = BRIDGE.width / 2 - 0.2;
    g.add(box(mx, mz, yaw, BRIDGE.width / 2, BRIDGE.span / 2 + 3, BRIDGE.y1 - 1.2, BRIDGE.y1, BRIDGE.y2));
    // Los pretiles no pasan de los estribos: si se alargaran, cortarían el camino al salir del puente.
    for (const side of [rail, -rail]) {
      g.add(box(mx + side * Math.cos(yaw), mz - side * Math.sin(yaw), yaw, 0.2, BRIDGE.span / 2 - 1,
        Math.min(BRIDGE.y1, BRIDGE.y2), BRIDGE.y1 + 1, BRIDGE.y2 + 1));
    }
  }

  // Casco del barco: caja tumbada a lo largo de la eslora, con la borda por techo.
  const [hullA, hullB] = SHIP.hull;
  g.add(box(SHIP.x + Math.cos(SHIP.heading) * SHIP.hullOffset, SHIP.z - Math.sin(SHIP.heading) * SHIP.hullOffset,
    SHIP.heading, hullA, hullB, -4, 3.2));

  return g;
}

function bodies(x: number, z: number): Body[] {
  if (!grid) grid = build();
  return grid.near(x, z);
}

/** Cota del techo del cuerpo bajo un punto (interpola si es rampa). */
function topAt(b: Body, lz: number): number {
  if (b.topTo === undefined) return b.top;
  const t = Math.min(1, Math.max(0, (lz + b.hz) / (2 * b.hz)));
  return b.top + (b.topTo - b.top) * t;
}

export interface Hit { x: number; z: number; floor: number }

/**
 * Resuelve la posición de un jugador que quiere estar en (x,z) con los pies a la cota `feet`:
 * lo saca de los cuerpos que no puede pisar y devuelve la cota del suelo sólido bajo él
 * (-Infinity si sólo hay terreno).
 */
export function collide(x: number, z: number, feet: number): Hit {
  const head = feet + 1.8;
  let px = x, pz = z, floor = -Infinity;
  for (let pass = 0; pass < 2; pass++) {
    for (const b of bodies(px, pz)) {
      if (b.base > head) continue; // se pasa por debajo
      const dx = px - b.x, dz = pz - b.z;
      const c = Math.cos(b.rot), s = Math.sin(b.rot);
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      const ex = b.hx + PLAYER_RADIUS, ez = b.hz + PLAYER_RADIUS;

      if (b.round) {
        const d = Math.hypot(dx, dz);
        if (d > ex) continue;
        const top = b.top;
        if (top <= feet + STEP_UP) { if (top > floor) floor = top; continue; }
        const k = d > 1e-4 ? ex / d : 1;
        px = b.x + dx * k; pz = b.z + dz * k;
      } else {
        if (Math.abs(lx) > ex || Math.abs(lz) > ez) continue;
        const top = topAt(b, lz);
        if (top <= feet + STEP_UP) { if (top > floor) floor = top; continue; }
        // Sale por la cara más cercana: es lo que deja rozar una pared en vez de quedarse clavado.
        const ox = ex - Math.abs(lx), oz = ez - Math.abs(lz);
        const nlx = ox < oz ? Math.sign(lx || 1) * ex : lx;
        const nlz = ox < oz ? lz : Math.sign(lz || 1) * ez;
        px = b.x + nlx * c + nlz * s;
        pz = b.z - nlx * s + nlz * c;
      }
    }
  }
  return { x: px, z: pz, floor };
}
