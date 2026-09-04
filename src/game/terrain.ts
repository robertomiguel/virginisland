import { applyRoad, applyWaterFeatures, applyWaterfall, naturalHeight } from './island';

/**
 * Altura final del terreno en (x, z). Función pura y determinista: la usan la malla,
 * los mapas para los shaders y, más adelante, todo lo que tenga que "pisar" el suelo.
 */
export function terrainHeight(x: number, z: number): number {
  // El camino va el último: el límite de terraplén impide que rellene el hueco de la cascada,
  // pero deja que los estribos del puente se apoyen en la ladera.
  return applyRoad(x, z, applyWaterfall(x, z, applyWaterFeatures(x, z, naturalHeight(x, z))));
}

export { localWaterLevel } from './island';
