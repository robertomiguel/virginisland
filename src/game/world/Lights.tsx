'use client';
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { lightning, sunState, sunStrength } from '../weather';
import { SunShadows, shadowsEnabled } from './Shadows';

/** Luces para los objetos con materiales estándar (árboles, rocas, flora; más adelante edificios). */
export function Lights({ sunDir }: { sunDir: THREE.Vector3 }) {
  const sun = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null!);
  useFrame(() => {
    const s = sunStrength();
    if (sun.current) {
      sun.current.intensity = 2.6 * s + 5.0 * lightning.flash;
      sun.current.position.copy(sunState.dir).multiplyScalar(200);
      sun.current.color.copy(sunState.color);
    }
    hemi.current.intensity = (0.9 * (0.45 + 0.55 * s)) * (0.03 + 0.97 * sunState.day) + 2.5 * lightning.flash;
  });
  return (
    <>
      {shadowsEnabled()
        ? <SunShadows />
        : <directionalLight ref={sun} position={[sunDir.x * 200, sunDir.y * 200, sunDir.z * 200]} color="#fff1d6" intensity={2.6} />}
      <hemisphereLight ref={hemi} args={['#cfe3ff', '#57623a', 0.9]} />
    </>
  );
}
