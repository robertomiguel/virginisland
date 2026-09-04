'use client';
import { useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { BRIDGE } from '../island';
import { registerStandardMaterial } from './Shadows';
import { REFLECT_MASK } from './Reflection';

/**
 * Puente de la cascada: el camino del castillo llega al filo del barranco y lo cruza de un vano
 * sobre la poza. Tablero con pretiles y un arco de medio punto por debajo, todo con la misma
 * piedra del kit del fuerte (mismo GLB, misma textura: no cuesta ninguna descarga más).
 * `ABUT` mete el tablero dentro de las dos laderas para que no se vea la junta.
 */
const FORT_URL = '/models/modular_fort_01.glb';
const ABUT = 5;        // cuánto se empotra el tablero en cada estribo
const DECK_H = 0.9;    // canto del tablero
const RAIL_H = 1.0;    // alto del pretil
const RAIL_W = 0.4;    // grueso del pretil
const ARCH_T = 1.5;    // grueso del arco

function useFortStone(): THREE.Material {
  const gltf = useGLTF(FORT_URL);
  return useMemo(() => {
    let mat: THREE.Material | null = null;
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (mat || !m.isMesh) return;
      const cand = Array.isArray(m.material) ? m.material[0] : m.material;
      if (cand?.name.includes('wall')) mat = cand;
    });
    const stone = (mat ?? new THREE.MeshStandardMaterial({ color: '#8a8378' })).clone();
    registerStandardMaterial(stone);
    return stone;
  }, [gltf]);
}

/** Arco de medio punto bajo el tablero, extruido a lo ancho del puente. */
function archGeometry(span: number, width: number): THREE.BufferGeometry {
  const R = span / 2 + 1.2, r = R - ARCH_T;
  const shape = new THREE.Shape();
  shape.absarc(0, 0, R, Math.PI, 0, false);
  shape.lineTo(r, 0);
  shape.absarc(0, 0, r, 0, Math.PI, true);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width * 0.78, bevelEnabled: false });
  geo.translate(0, 0, (-width * 0.78) / 2);
  return geo;
}

export function Bridge() {
  const stone = useFortStone();
  const { span, width } = BRIDGE;
  const geos = useMemo(() => {
    const len = span + 2 * ABUT;
    return {
      deck: new THREE.BoxGeometry(len, DECK_H, width),
      rail: new THREE.BoxGeometry(len, RAIL_H, RAIL_W),
      arch: archGeometry(span, width),
    };
  }, [span, width]);
  if (span <= 0) return null;

  const mx = (BRIDGE.x1 + BRIDGE.x2) / 2, mz = (BRIDGE.z1 + BRIDGE.z2) / 2, my = (BRIDGE.y1 + BRIDGE.y2) / 2;
  const yaw = Math.atan2(-(BRIDGE.z2 - BRIDGE.z1), BRIDGE.x2 - BRIDGE.x1); // el eje X local sigue el vano
  const pitch = Math.atan2(BRIDGE.y2 - BRIDGE.y1, span);
  const railZ = width / 2 - RAIL_W / 2;

  return (
    <group position={[mx, my, mz]} rotation={[0, yaw, 0]}>
      <group rotation={[0, 0, pitch]}>
        <mesh geometry={geos.deck} material={stone} position={[0, -DECK_H / 2, 0]} castShadow receiveShadow layers-mask={REFLECT_MASK} />
        {[railZ, -railZ].map((z) => (
          <mesh key={z} geometry={geos.rail} material={stone} position={[0, RAIL_H / 2, z]} castShadow receiveShadow layers-mask={REFLECT_MASK} />
        ))}
        <mesh geometry={geos.arch} material={stone} position={[0, -DECK_H - span / 2 - 1.2, 0]} castShadow receiveShadow layers-mask={REFLECT_MASK} />
      </group>
    </group>
  );
}

useGLTF.preload(FORT_URL);
