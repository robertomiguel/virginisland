'use client';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { REFLECT_MASK } from './Reflection';
import { lightning, sunState, sunStrength } from '../weather';

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_Position.z = gl_Position.w; // siempre al fondo
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 zenith;
  uniform vec3 horizon;
  uniform vec3 sunDir;
  uniform float sunStrength;
  uniform float flash;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float up = max(d.y, 0.0);
    // Gradiente: azul intenso desde media altura; solo la franja baja se aclara hacia el horizonte
    float t = pow(up, 0.38);
    vec3 col = mix(horizon, zenith, t);
    // Bajo el horizonte: mismo tono que la niebla lejana, un poco más oscuro
    col = mix(col, horizon * 0.85, smoothstep(0.0, -0.08, d.y));
    // Halo del sol y claridad cerca de él
    float cosA = max(dot(d, sunDir), 0.0);
    vec3 sunTint = vec3(1.0, 0.93, 0.8);
    col += sunTint * (pow(cosA, 900.0) * 1.0 + pow(cosA, 60.0) * 0.25 + pow(cosA, 6.0) * 0.08) * sunStrength;
    col += vec3(0.9, 0.92, 1.0) * flash * (0.35 + 0.35 * (1.0 - up));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export function SkyDome({ sunDir }: { sunDir: THREE.Vector3 }) {
  const mesh = useRef<THREE.Mesh>(null!);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false,
        uniforms: {
          zenith: { value: new THREE.Color() },
          horizon: { value: new THREE.Color() },
          sunDir: { value: sunDir.clone() },
          sunStrength: { value: 1 },
          flash: { value: 0 },
        },
      }),
    [sunDir],
  );

  useFrame(({ camera }) => {
    mesh.current.position.copy(camera.position);
    material.uniforms.zenith.value.copy(sunState.zenith);
    material.uniforms.horizon.value.copy(sunState.horizon);
    material.uniforms.sunDir.value.copy(sunState.dir);
    material.uniforms.sunStrength.value = sunStrength();
    material.uniforms.flash.value = lightning.flash;
  });

  return (
    <mesh ref={mesh} material={material} renderOrder={-10} frustumCulled={false} layers-mask={REFLECT_MASK}>
      <sphereGeometry args={[100, 32, 16]} />
    </mesh>
  );
}
