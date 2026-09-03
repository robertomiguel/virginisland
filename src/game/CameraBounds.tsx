'use client';
import { useFrame, useThree } from '@react-three/fiber';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';

/** Mantiene el objetivo de la cámara dentro del mundo (radio en metros) y sobre el nivel del mar. */
export function CameraBounds({ radius, minY = 0 }: { radius: number; minY?: number }) {
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  useFrame(() => {
    if (!controls) return;
    const t = controls.target;
    const d = Math.hypot(t.x, t.z);
    if (d > radius) {
      t.x *= radius / d;
      t.z *= radius / d;
    }
    if (t.y < minY) t.y = minY;
  });
  return null;
}
