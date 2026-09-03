'use client';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CLOUD_HEIGHT } from '../config';
import { terrainHeight } from '../terrain';
import { lightning, updateLightning } from '../weather';

const MAX_POINTS = 64;

/** Genera un rayo quebrado desde las nubes hasta el suelo/mar, a cierta distancia de la cámara. */
function makeBolt(cam: THREE.Vector3): number[] {
  const a = Math.random() * Math.PI * 2;
  const dist = 250 + Math.random() * 600;
  const x = cam.x + Math.cos(a) * dist, z = cam.z + Math.sin(a) * dist;
  const ground = Math.max(0, terrainHeight(x, z));
  const top = CLOUD_HEIGHT * (0.85 + Math.random() * 0.1);
  const pts: number[] = [];
  const segs = 14;
  let px = x + (Math.random() - 0.5) * 60, pz = z + (Math.random() - 0.5) * 60;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const y = top + (ground - top) * t;
    const jitter = (1 - t) * 18 + 3;
    if (i > 0) { px += (Math.random() - 0.5) * jitter; pz += (Math.random() - 0.5) * jitter; }
    if (i === segs) { px = x; pz = z; }
    pts.push(px, y, pz);
    if (i > 0) pts.push(px, y, pz); // duplicado para LineSegments
  }
  pts.pop(); pts.pop(); pts.pop();
  return pts;
}

export function Lightning() {
  const line = useRef<THREE.LineSegments>(null!);
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_POINTS * 3), 3));
    g.setDrawRange(0, 0);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    return g;
  }, []);
  const material = useMemo(() => new THREE.LineBasicMaterial({ color: '#dfe8ff', transparent: true, opacity: 1, blending: THREE.AdditiveBlending, fog: false, depthWrite: false }), []);

  useFrame(({ camera, clock }, dt) => {
    const elapsed = clock.getElapsedTime();
    if (updateLightning(elapsed, Math.min(dt, 0.1))) {
      const pts = makeBolt(camera.position);
      lightning.bolt = { points: pts, until: elapsed + 0.18 + Math.random() * 0.15 };
      const pos = geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pts.length; i++) pos.setComponent(Math.floor(i / 3), i % 3, pts[i]);
      pos.needsUpdate = true;
      geometry.setDrawRange(0, pts.length / 3);
    }
    const visible = !!lightning.bolt;
    line.current.visible = visible;
    if (visible) material.opacity = 0.5 + 0.5 * Math.random() * lightning.flash; // parpadeo
  });

  return <lineSegments ref={line} geometry={geometry} material={material} frustumCulled={false} renderOrder={15} visible={false} />;
}
