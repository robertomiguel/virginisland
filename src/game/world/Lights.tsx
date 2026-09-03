'use client';
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { weather } from '../weather';

/** Luces para los objetos con materiales estándar (árboles, y más adelante edificios). */
export function Lights({ sunDir }: { sunDir: THREE.Vector3 }) {
  const sun = useRef<THREE.DirectionalLight>(null!);
  const hemi = useRef<THREE.HemisphereLight>(null!);
  useFrame(() => {
    const s = weather.params.sun;
    sun.current.intensity = 2.6 * s;
    hemi.current.intensity = 0.9 * (0.45 + 0.55 * s);
  });
  return (
    <>
      <directionalLight ref={sun} position={[sunDir.x * 200, sunDir.y * 200, sunDir.z * 200]} color="#fff1d6" intensity={2.6} />
      <hemisphereLight ref={hemi} args={['#cfe3ff', '#57623a', 0.9]} />
    </>
  );
}
