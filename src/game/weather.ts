// Clima: estados con parámetros y transiciones aleatorias suaves entre vecinos.
export type WeatherKind = 'despejado' | 'pocasNubes' | 'cubierto' | 'tormenta';

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
}

export const WEATHER_PRESETS: Record<WeatherKind, WeatherParams> = {
  despejado:  { coverage: 0.04, darkness: 0.0,  sun: 1.0,  wind: 5,  waves: 0.8, zenith: [0.09, 0.33, 0.78], horizon: [0.66, 0.82, 0.95], fog: [0.70, 0.83, 0.94], fogFar: 2800 },
  pocasNubes: { coverage: 0.42, darkness: 0.1,  sun: 0.95, wind: 9,  waves: 1.0, zenith: [0.14, 0.38, 0.80], horizon: [0.70, 0.84, 0.95], fog: [0.72, 0.84, 0.94], fogFar: 2600 },
  cubierto:   { coverage: 0.9,  darkness: 0.45, sun: 0.5,  wind: 13, waves: 1.25, zenith: [0.45, 0.51, 0.60], horizon: [0.70, 0.74, 0.79], fog: [0.70, 0.74, 0.79], fogFar: 2000 },
  tormenta:   { coverage: 1.0,  darkness: 0.85, sun: 0.22, wind: 16, waves: 1.9, zenith: [0.20, 0.23, 0.29], horizon: [0.48, 0.52, 0.58], fog: [0.48, 0.52, 0.58], fogFar: 1300 },
};

const ORDER: WeatherKind[] = ['despejado', 'pocasNubes', 'cubierto', 'tormenta'];

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

const TRANSITION_SECONDS = 25;

/** Elige un estado vecino al azar (con algo de preferencia por el buen tiempo). */
function pickNext(current: WeatherKind): WeatherKind {
  const i = ORDER.indexOf(current);
  const candidates: WeatherKind[] = [];
  if (i > 0) candidates.push(ORDER[i - 1], ORDER[i - 1]); // volver hacia el buen tiempo pesa doble
  if (i < ORDER.length - 1) candidates.push(ORDER[i + 1]);
  return candidates[Math.floor(Math.random() * candidates.length)];
}

export function setWeather(kind: WeatherKind) {
  weather.kind = kind;
  weather.target = clone(WEATHER_PRESETS[kind]);
}

/** Avanza el clima: interpola hacia el objetivo y programa cambios aleatorios. */
export function updateWeather(elapsed: number, dt: number) {
  if (!weather.locked && elapsed > weather.nextChangeAt) {
    setWeather(pickNext(weather.kind));
    // Duración del nuevo estado: las tormentas son más cortas
    const base = weather.kind === 'tormenta' ? 60 : 120;
    weather.nextChangeAt = elapsed + base + Math.random() * base;
  }
  const k = Math.min(1, dt / TRANSITION_SECONDS);
  const p = weather.params, t = weather.target;
  p.coverage += (t.coverage - p.coverage) * k;
  p.darkness += (t.darkness - p.darkness) * k;
  p.sun += (t.sun - p.sun) * k;
  p.wind += (t.wind - p.wind) * k;
  p.waves += (t.waves - p.waves) * k;
  p.fogFar += (t.fogFar - p.fogFar) * k;
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
