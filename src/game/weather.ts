// Clima: estados con parámetros y transiciones aleatorias suaves entre vecinos.
export type WeatherKind = 'despejado' | 'pocasNubes' | 'cubierto' | 'llovizna' | 'aguacero' | 'tormenta';

export interface WeatherParams {
  coverage: number;   // cobertura de nubes 0..1
  darkness: number;   // oscuridad de las nubes 0..1
  sun: number;        // intensidad de la luz solar 0..1
  wind: number;       // m/s
  waves: number;      // multiplicador del oleaje
  zenith: [number, number, number];  // color del cielo en el cenit (RGB 0..1)
  horizon: [number, number, number]; // color del cielo en el horizonte
  fog: [number, number, number];     // color RGB 0..1
  fogFar: number;
  rain: number;       // intensidad de lluvia 0..1 (0 nada, 0.25 garúa, 0.8 aguacero, 1 tormenta)
  lightning: number;  // rayos por segundo (0 = sin rayos)
}

export const WEATHER_PRESETS: Record<WeatherKind, WeatherParams> = {
  despejado:  { coverage: 0.0,  darkness: 0.0,  sun: 1.0,  wind: 5,  waves: 0.8, zenith: [0.03, 0.20, 0.68], horizon: [0.52, 0.72, 0.94], fog: [0.62, 0.78, 0.93], fogFar: 2800, rain: 0, lightning: 0 },
  pocasNubes: { coverage: 0.5,  darkness: 0.1,  sun: 0.95, wind: 9,  waves: 1.0, zenith: [0.06, 0.25, 0.72], horizon: [0.56, 0.74, 0.94], fog: [0.64, 0.79, 0.93], fogFar: 2600, rain: 0, lightning: 0 },
  cubierto:   { coverage: 1.0,  darkness: 0.55, sun: 0.5,  wind: 13, waves: 1.25, zenith: [0.45, 0.51, 0.60], horizon: [0.70, 0.74, 0.79], fog: [0.70, 0.74, 0.79], fogFar: 2000, rain: 0, lightning: 0 },
  llovizna:   { coverage: 1.0,  darkness: 0.6,  sun: 0.42, wind: 10, waves: 1.2, zenith: [0.40, 0.45, 0.53], horizon: [0.66, 0.70, 0.75], fog: [0.66, 0.70, 0.75], fogFar: 1400, rain: 0.25, lightning: 0 },
  aguacero:   { coverage: 1.0,  darkness: 0.78,  sun: 0.3,  wind: 14, waves: 1.5, zenith: [0.30, 0.34, 0.41], horizon: [0.56, 0.60, 0.66], fog: [0.56, 0.60, 0.66], fogFar: 900, rain: 0.8, lightning: 0 },
  tormenta:   { coverage: 1.0,  darkness: 0.92, sun: 0.22, wind: 16, waves: 1.9, zenith: [0.20, 0.23, 0.29], horizon: [0.48, 0.52, 0.58], fog: [0.48, 0.52, 0.58], fogFar: 800, rain: 1.0, lightning: 0.14 },
};

const ORDER: WeatherKind[] = ['despejado', 'pocasNubes', 'cubierto', 'llovizna', 'aguacero', 'tormenta'];

export interface WeatherState {
  kind: WeatherKind;
  params: WeatherParams;     // valores actuales (interpolados)
  target: WeatherParams;
  nextChangeAt: number;      // segundos de reloj
  locked: boolean;           // forzado por URL
}

const clone = (p: WeatherParams): WeatherParams => ({ ...p, fog: [...p.fog] as [number, number, number], zenith: [...p.zenith] as [number, number, number], horizon: [...p.horizon] as [number, number, number] });

function initialKind(): { kind: WeatherKind; locked: boolean } {
  if (typeof window !== 'undefined') {
    const q = new URLSearchParams(window.location.search).get('clima') as WeatherKind | null;
    if (q && q in WEATHER_PRESETS) return { kind: q, locked: true };
  }
  return { kind: 'pocasNubes', locked: false };
}

const init = initialKind();
export const weather: WeatherState = {
  kind: init.kind,
  params: clone(WEATHER_PRESETS[init.kind]),
  target: clone(WEATHER_PRESETS[init.kind]),
  nextChangeAt: 60 + Math.random() * 90,
  locked: init.locked,
};

/** Transiciones aleatorias: apagadas por defecto; se activan desde el panel. */
export const autoWeather = { enabled: false };

/** Duración de la transición en curso: 25 s en automático, 5 s al elegir un preset, 1 s con los deslizadores. */
export const transition = { seconds: 25 };

/** Elige un estado vecino al azar (con algo de preferencia por el buen tiempo). */
function pickNext(current: WeatherKind): WeatherKind {
  const i = ORDER.indexOf(current);
  const candidates: WeatherKind[] = [];
  if (i > 0) candidates.push(ORDER[i - 1], ORDER[i - 1]); // volver hacia el buen tiempo pesa doble
  if (i < ORDER.length - 1) candidates.push(ORDER[i + 1]);
  return candidates[Math.floor(Math.random() * candidates.length)];
}

export function setWeather(kind: WeatherKind, seconds = 25) {
  weather.kind = kind;
  weather.target = clone(WEATHER_PRESETS[kind]);
  transition.seconds = seconds;
}

/** Reloj propio en segundos (el de R3F no es fiable con frameloop="never"). */
export const weatherClock = { t: 0 };

/** Avanza el clima: interpola hacia el objetivo y, si el modo automático está activo, programa cambios aleatorios. */
export function updateWeather(_elapsed: number, dt: number) {
  weatherClock.t += dt;
  const elapsed = weatherClock.t;
  if (autoWeather.enabled && !manual.enabled && elapsed > weather.nextChangeAt) {
    setWeather(pickNext(weather.kind), 25);
    // Duración del nuevo estado: las tormentas son más cortas
    const base = weather.kind === 'tormenta' ? 70 : weather.kind === 'aguacero' ? 80 : 120;
    weather.nextChangeAt = elapsed + base + Math.random() * base;
  }
  const k = Math.min(1, dt / transition.seconds);
  const p = weather.params, t = weather.target;
  p.coverage += (t.coverage - p.coverage) * k;
  p.darkness += (t.darkness - p.darkness) * k;
  p.sun += (t.sun - p.sun) * k;
  p.wind += (t.wind - p.wind) * k;
  p.waves += (t.waves - p.waves) * k;
  p.fogFar += (t.fogFar - p.fogFar) * k;
  p.rain += (t.rain - p.rain) * k;
  p.lightning += (t.lightning - p.lightning) * k;
  for (let i = 0; i < 3; i++) {
    p.fog[i] += (t.fog[i] - p.fog[i]) * k;
    p.zenith[i] += (t.zenith[i] - p.zenith[i]) * k;
    p.horizon[i] += (t.horizon[i] - p.horizon[i]) * k;
  }
}

/** Movimiento de las nubes: deriva integrada fotograma a fotograma (sin saltos al cambiar el viento). */
export const cloudMotion = { offsetX: 0, offsetZ: 0, time: 0 };
export const CLOUD_DRIFT_FACTOR = 0.18; // fracción del viento en superficie con la que derivan las nubes

export function updateCloudMotion(dt: number, windDirX: number, windDirZ: number) {
  const v = weather.params.wind * CLOUD_DRIFT_FACTOR;
  cloudMotion.offsetX += windDirX * v * dt;
  cloudMotion.offsetZ += windDirZ * v * dt;
  cloudMotion.time += dt;
}

// --- Rayos ----------------------------------------------------------------------------------
export interface Bolt { points: number[]; until: number }
export const lightning = { flash: 0, bolt: null as Bolt | null, nextAt: 0 };

/** Avanza el destello y decide si cae un rayo. Devuelve true cuando hay que generar un rayo nuevo. */
export function updateLightning(_elapsed: number, dt: number): boolean {
  const elapsed = weatherClock.t;
  lightning.flash *= Math.exp(-dt * 9);
  if (lightning.bolt && elapsed > lightning.bolt.until) lightning.bolt = null;
  const rate = weather.params.lightning;
  if (rate <= 0.005) return false;
  if (elapsed < lightning.nextAt) return false;
  lightning.nextAt = elapsed + 0.3 + (-Math.log(1 - Math.random()) / rate); // intervalos de Poisson
  lightning.flash = 1;
  return true;
}

// --- Hora del día y sol ---------------------------------------------------------------------
import * as THREE from 'three';

/** Hora del día (0-24); `?hora=17.5` en la URL la fija al cargar. auto: el reloj avanza solo. */
export const daytime = { hour: 10, auto: false, hoursPerMinute: 2 };
if (typeof window !== 'undefined') {
  const h = Number(new URLSearchParams(window.location.search).get('hora'));
  if (Number.isFinite(h) && h > 0) daytime.hour = h % 24;
}

export const sunState = {
  dir: new THREE.Vector3(0.55, 0.6, 0.4).normalize(),
  stars: 0,         // visibilidad de las estrellas 0..1
  elevation: 0.6,   // seno de la altura del sol (-1..1)
  day: 1,           // 0 noche, 1 pleno día
  color: new THREE.Color(1, 0.95, 0.85),
  zenith: new THREE.Color(),
  horizon: new THREE.Color(),
  fog: new THREE.Color(),
};

// Valores lineales: en pantalla (sRGB) el cenit nocturno queda casi negro y el horizonte apenas azulado
const NIGHT_ZENITH = new THREE.Color(0.0006, 0.0012, 0.004);
const NIGHT_HORIZON = new THREE.Color(0.003, 0.005, 0.011);
const DUSK = new THREE.Color(0.95, 0.55, 0.3);
const tmpA = new THREE.Color();

export function updateDaytime(dt: number) {
  if (daytime.auto) daytime.hour = (daytime.hour + (dt / 60) * daytime.hoursPerMinute) % 24;
  const h = daytime.hour;
  const theta = ((h - 6.5) / 14) * Math.PI; // 6:30 amanecer, 13:30 cénit, 20:30 ocaso
  const east = new THREE.Vector3(1, 0, 0.45).normalize();
  const dir = east.clone().multiplyScalar(Math.cos(theta)).add(new THREE.Vector3(0, Math.sin(theta) * 0.9, 0));
  if (dir.length() < 1e-3) dir.set(0, 1, 0);
  sunState.dir.copy(dir.normalize());
  const e = sunState.dir.y;
  sunState.elevation = e;
  const day = smooth(-0.02, 0.22, e); // noche hasta que el sol asoma
  sunState.day = day;
  const dusk = (1 - smooth(0.08, 0.38, e)) * smooth(-0.12, 0.02, e); // sol bajo: alba y crepúsculo
  sunState.color.setRGB(1, 0.95, 0.85).lerp(DUSK, dusk * 0.7);
  sunState.stars = (1 - smooth(-0.12, 0.02, e)) * (1 - smooth(0.35, 0.9, weather.params.coverage));

  const p = weather.params;
  tmpA.setRGB(p.zenith[0], p.zenith[1], p.zenith[2]);
  sunState.zenith.copy(NIGHT_ZENITH).lerp(tmpA, day);
  tmpA.setRGB(p.horizon[0], p.horizon[1], p.horizon[2]);
  sunState.horizon.copy(NIGHT_HORIZON).lerp(tmpA, day).lerp(DUSK, dusk * 0.55 * (1 - p.coverage * 0.6));
  tmpA.setRGB(p.fog[0], p.fog[1], p.fog[2]);
  sunState.fog.copy(NIGHT_HORIZON).lerp(tmpA, day).lerp(DUSK, dusk * 0.3);
}

function smooth(a: number, b: number, x: number) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

/** Intensidad efectiva del sol: clima × altura del sol. */
export function sunStrength(): number { return weather.params.sun * sunState.day; }

// --- Control manual -------------------------------------------------------------------------
export const manual = { enabled: false };

export function setManualParams(partial: Partial<WeatherParams>) {
  manual.enabled = true;
  Object.assign(weather.target, partial);
  transition.seconds = 1;
}

export function setAutoWeather() {
  manual.enabled = false;
  autoWeather.enabled = true;
  weather.nextChangeAt = weatherClock.t + 20 + Math.random() * 40; // primer cambio en 20-60 s
}
