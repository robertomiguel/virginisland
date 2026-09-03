'use client';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { REFLECT_MASK } from './Reflection';
import { sunState, sunStrength } from '../weather';

/** Disco solar con halo: un sprite aditivo que se mantiene "en el infinito" en la dirección del sol. */
export function Sun({ sunDir, distance = 4200 }: { sunDir: THREE.Vector3; distance?: number }) {
  const sprite = useRef<THREE.Sprite>(null!);
  const mat = useRef<THREE.SpriteMaterial>(null!);

  const texture = useMemo(() => {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0.0, 'rgba(255,255,250,1)');
    g.addColorStop(0.08, 'rgba(255,250,230,1)');
    g.addColorStop(0.13, 'rgba(255,235,190,0.6)');
    g.addColorStop(0.3, 'rgba(255,220,170,0.18)');
    g.addColorStop(1.0, 'rgba(255,210,160,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);

  useFrame(({ camera }) => {
    sprite.current.position.copy(camera.position).addScaledVector(sunState.dir, distance);
    mat.current.opacity = Math.max(0, (sunStrength() - 0.2) / 0.8) * (sunState.dir.y > -0.03 ? 1 : 0);
    mat.current.color.copy(sunState.color);
  });

  return (
    <sprite ref={sprite} scale={[560, 560, 1]} renderOrder={-1} layers-mask={REFLECT_MASK}>
      <spriteMaterial ref={mat} map={texture} transparent blending={THREE.AdditiveBlending} depthWrite={false} fog={false} toneMapped={false} />
    </sprite>
  );
}
