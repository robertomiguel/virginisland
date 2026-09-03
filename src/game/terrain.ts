import { applyWaterFeatures, naturalHeight } from './island';

/**
 * Altura final del terreno en (x, z). Función pura y determinista: la usan la malla,
 * los mapas para los shaders y, más adelante, todo lo que tenga que "pisar" el suelo.
 */
export function terrainHeight(x: number, z: number): number {
  return applyWaterFeatures(x, z, naturalHeight(x, z));
}

export { localWaterLevel } from './island';
