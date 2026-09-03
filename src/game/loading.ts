'use client';
// Estado de carga compartido entre la escena (que lo escribe) y la pantalla de carga (que lo lee).
export const loading = { phase: 'Preparando', stage: 0, done: false };

export const LOAD_PHASES = ['Generando terreno y mar', 'Río, cascada y laguna', 'Plantando árboles', 'Flora baja', 'Rocas', 'Pasto y flores', 'Listo'];

export function setPhase(stage: number) {
  loading.stage = stage;
  loading.phase = LOAD_PHASES[Math.min(stage, LOAD_PHASES.length - 1)];
  if (stage >= LOAD_PHASES.length - 1) loading.done = true;
}
