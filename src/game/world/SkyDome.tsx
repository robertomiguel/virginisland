'use client';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { weather } from '../weather';

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
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float up = max(d.y, 0.0);
    // Gradiente: azul intenso arriba, más claro y saturado hacia media altura, pálido en el horizonte
    float t = pow(up, 0.55);
    vec3 col = mix(horizon, zenith, t);
    // Bajo el horizonte: mismo tono que la niebla lejana, un poco más oscuro
    col = mix(col, horizon * 0.85, smoothstep(0.0, -0.08, d.y));
    // Halo del sol y claridad cerca de él
    float cosA = max(dot(d, sunDir), 0.0);
    vec3 sunTint = vec3(1.0, 0.93, 0.8);
    col += sunTint * (pow(cosA, 900.0) * 1.0 + pow(cosA, 60.0) * 0.25 + pow(cosA, 6.0) * 0.08) * sunStrength;
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
        },
      }),
    [sunDir],
  );

  useFrame(({ camera }) => {
    mesh.current.position.copy(camera.position);
    const p = weather.params;
    material.uniforms.zenith.value.setRGB(p.zenith[0], p.zenith[1], p.zenith[2]);
    material.uniforms.horizon.value.setRGB(p.horizon[0], p.horizon[1], p.horizon[2]);
    material.uniforms.sunStrength.value = p.sun;
  });

  return (
    <mesh ref={mesh} material={material} renderOrder={-10} frustumCulled={false}>
      <sphereGeometry args={[100, 32, 16]} />
    </mesh>
  );
}
