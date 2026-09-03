// Unidades de mundo: 1 unidad = 1 metro.
export const ISLAND_SIZE = 720;       // lado del plano de terreno
export const ISLAND_RADIUS = 265;     // radio medio de la isla (el borde es irregular)
export const TERRAIN_SEGMENTS = 600;  // resolución de la malla de terreno (~1.2 m por vértice)
export const HEIGHTMAP_SIZE = 512;    // resolución del mapa de alturas/niveles de agua para los shaders
export const WATER_LEVEL = 0;         // nivel del mar

export const DEEP_SEA_FLOOR = -44;   // fondo marino lejos de cualquier isla
export const OCEAN_HALF_SIZE = 4000;  // semilado de la única malla de mar (rejilla graduada que sigue a la cámara)
export const OCEAN_SEGMENTS = 600;    // ~2.5 m por vértice en el centro, más grueso hacia el horizonte
export const OCEAN_CENTER_DENSITY = 0.19; // fracción lineal de la rejilla graduada (controla el espaciado central)

export const SUN_DIRECTION: [number, number, number] = [0.55, 0.6, 0.4]; // se normaliza en la escena

export const WORLD_RADIUS = 450;          // hasta dónde puede desplazarse el objetivo de la cámara
export const CAMERA_MAX_DISTANCE = 750;   // zoom-out máximo: nunca se ve el final del mundo

export const TARGET_FPS = 30;         // límite de fotogramas para no calentar el portátil
export const MAX_DPR = 1.5;           // tope de densidad de píxeles en pantallas retina

/** Modo de baja calidad (?low en la URL) para pruebas y equipos lentos. */
export function lowQuality(): boolean {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('low');
}

// Cielo y viento
export const WIND = { dir: [0.83, 0.41] as [number, number], speed: 9 }; // dirección en XZ (se normaliza) y m/s
export const CLOUD_HEIGHT = 650;       // altura de la capa de nubes
export const CLOUD_COVERAGE = 0.45;    // 0 = despejado, 1 = cubierto
export const CLOUD_SHADOW = 0.5;       // oscurecimiento máximo bajo una nube

/** ?cam=x,y,z y ?mira=x,y,z colocan la cámara y su objetivo (útil para revisar un rincón concreto). */
export function urlVec(name: string): [number, number, number] | null {
  if (typeof window === 'undefined') return null;
  const v = new URLSearchParams(window.location.search).get(name)?.split(',').map(Number);
  return v && v.length === 3 && v.every((n) => Number.isFinite(n)) ? (v as [number, number, number]) : null;
}
