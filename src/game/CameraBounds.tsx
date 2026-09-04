'use client';
import { useFrame, useThree } from '@react-three/fiber';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { WATER_LEVEL } from './config';
import { terrainHeight } from './terrain';

const CAMERA_CLEARANCE = 2.5; // metros que la cámara guarda sobre el suelo o el agua

/**
 * Mantiene el objetivo de la cámara dentro del mundo (radio en metros) y sobre el nivel del mar, y
 * evita que la cámara se meta bajo el terreno: al acercar o al girar por debajo del horizonte, en
 * vez de atravesar la ladera se apoya en ella. Va con prioridad 0, después de que OrbitControls
 * haya recolocado la cámara (lo hace en prioridad negativa) y antes de dibujar.
 */
export function CameraBounds({ radius, minY = 0 }: { radius: number; minY?: number }) {
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const camera = useThree((s) => s.camera);
  useFrame(() => {
    if (!controls) return;
    const t = controls.target;
    const d = Math.hypot(t.x, t.z);
    if (d > radius) {
      t.x *= radius / d;
      t.z *= radius / d;
    }
    if (t.y < minY) t.y = minY;

    const p = camera.position;
    const floor = Math.max(terrainHeight(p.x, p.z), WATER_LEVEL) + CAMERA_CLEARANCE;
    if (p.y < floor) {
      p.y = floor;
      camera.lookAt(t);
      camera.updateMatrixWorld();
    }
  });
  return null;
}
