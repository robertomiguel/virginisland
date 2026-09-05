import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Mata de pasto: varios matojos del modelo (hierba o musgo de Poly Haven) girados, escalados y
 * repartidos en un corro. Cada mata se fusiona en una sola geometría para instanciarla de una pasada:
 * así una mata es un dibujado, no diez.
 */
export function buildClump(
  seed: number,
  tufts: THREE.BufferGeometry[],
  { count, radius, scale = 1 }: { count: [number, number]; radius: number; scale?: number },
): THREE.BufferGeometry {
  const rnd = (i: number) => { const x = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453; return x - Math.floor(x); };
  const parts: THREE.BufferGeometry[] = [];
  const n = count[0] + Math.floor(rnd(1) * (count[1] - count[0] + 1));
  for (let i = 0; i < n; i++) {
    const g = tufts[Math.floor(rnd(10 + i) * tufts.length) % tufts.length].clone();
    const s = scale * (0.7 + rnd(20 + i) * 0.7);
    const a = rnd(30 + i) * Math.PI * 2;
    const r = radius * Math.sqrt(rnd(40 + i));
    g.scale(s, s * (0.85 + rnd(50 + i) * 0.5), s);
    g.rotateY(a);
    g.translate(Math.cos(a) * r, 0, Math.sin(a) * r);
    parts.push(g);
  }
  return mergeGeometries(parts, false)!;
}

/**
 * Inclina la normal del follaje hacia el cielo.
 *
 * Una brizna es una lámina casi vertical: con el sol alto no le llega nada de frente y sale negra,
 * que es justo lo que no hace el pasto de verdad. Una hoja es translúcida —la luz que entra por una
 * cara sale por la otra— y en conjunto una mata se ilumina como el suelo que la sostiene. Inclinar
 * la normal hacia arriba cuenta eso sin un modelo de dispersión, y se hace DESPUÉS de
 * `normal_fragment_begin` para que valga también en la cara de atrás (con DoubleSide three le da la
 * vuelta a la normal, y si no las dos caras no se iluminan igual).
 */
export function liftNormals(mat: THREE.MeshStandardMaterial, amount: number) {
  const previous = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    previous?.call(mat, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      `#include <normal_fragment_begin>
      normal = normalize(mix(normal, vec3(0.0, 1.0, 0.0), ${amount.toFixed(3)}));`,
    );
  };
}
