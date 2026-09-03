'use client';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { REFLECT_MASK } from './Reflection';
import { sunState } from '../weather';

const COUNT = 2600;

const vertexShader = /* glsl */ `
  attribute float size;
  attribute float phase;
  uniform float time;
  uniform float visibility;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float twinkle = 0.75 + 0.25 * sin(time * (1.5 + phase * 2.0) + phase * 20.0);
    gl_PointSize = size * twinkle;
    vAlpha = visibility * (0.5 + 0.5 * twinkle) * smoothstep(0.0, 0.12, position.y / 100.0);
    gl_Position = projectionMatrix * mv;
    gl_Position.z = gl_Position.w * 0.9999; // al fondo, delante de la cúpula
  }
`;
const fragmentShader = /* glsl */ `
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = (1.0 - smoothstep(0.3, 1.0, d)) * vAlpha;
    gl_FragColor = vec4(0.9, 0.93, 1.0, a);
  }
`;

/** Estrellas: puntos fijos en la cúpula, visibles de noche y sin nubes. */
export function Stars() {
  const points = useRef<THREE.Points>(null!);
  const geometry = useMemo(() => {
    const pos = new Float32Array(COUNT * 3);
    const size = new Float32Array(COUNT);
    const phase = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      // distribución uniforme sobre el hemisferio superior (con un poco por debajo del horizonte)
      const u = Math.random(), v = Math.random();
      const th = 2 * Math.PI * u, ph = Math.acos(1 - 1.15 * v);
      const r = 98;
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = r * Math.cos(ph);
      pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
      const mag = Math.random();
      size[i] = 1.2 + mag * mag * 3.2;
      phase[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('size', new THREE.BufferAttribute(size, 1));
    g.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    return g;
  }, []);
  const uniforms = useMemo(() => ({ time: { value: 0 }, visibility: { value: 0 } }), []);

  useFrame(({ camera }, dt) => {
    points.current.position.copy(camera.position);
    uniforms.time.value += Math.min(dt, 0.05);
    uniforms.visibility.value = sunState.stars;
    points.current.visible = sunState.stars > 0.01;
  });

  return (
    <points ref={points} geometry={geometry} frustumCulled={false} renderOrder={-9} layers-mask={REFLECT_MASK}>
      <shaderMaterial vertexShader={vertexShader} fragmentShader={fragmentShader} uniforms={uniforms} transparent depthWrite={false} depthTest={false} blending={THREE.AdditiveBlending} />
    </points>
  );
}
