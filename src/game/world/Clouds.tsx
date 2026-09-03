'use client';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CLOUD_COVERAGE, CLOUD_HEIGHT, WIND } from '../config';
import { cloudGLSL, noiseGLSL } from './skyGLSL';
import { cloudMotion, weather } from '../weather';

const vertexShader = /* glsl */ `
  varying vec3 vWorldPos;
  #include <fog_pars_vertex>
  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vec4 mvPosition = viewMatrix * worldPos;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 sunDir;
  uniform vec3 camPos;
  uniform float cloudDark;
  varying vec3 vWorldPos;
  #include <fog_pars_fragment>
  ${noiseGLSL}
  ${cloudGLSL}
  void main() {
    float d = cloudDensity(vWorldPos.xz);
    if (d < 0.003) discard;
    // Iluminación: la nube es más clara hacia el sol y más gris donde es gruesa
    vec2 toSun = normalize(sunDir.xz + vec2(1e-4)) * 90.0;
    float dSun = cloudDensity(vWorldPos.xz + toSun);
    float lit = clamp(0.5 + (d - dSun) * 1.6, 0.0, 1.0);
    float thick = smoothstep(0.2, 1.0, d);
    vec3 bright = mix(vec3(1.0, 0.99, 0.97), vec3(0.55, 0.57, 0.62), cloudDark);
    vec3 shade = mix(vec3(0.62, 0.67, 0.78), vec3(0.22, 0.24, 0.29), cloudDark);
    vec3 color = mix(shade, bright, lit * (1.0 - thick * 0.45) + 0.15);
    // Bordes suaves y desvanecido hacia el horizonte
    float horizon = 1.0 - smoothstep(3500.0, 6000.0, distance(vWorldPos.xz, camPos.xz));
    float alpha = smoothstep(0.0, 0.5, d) * mix(0.95, 1.0, cloudDark) * horizon;
    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export function Clouds({ sunDir }: { sunDir: THREE.Vector3 }) {
  const mesh = useRef<THREE.Mesh>(null!);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        fog: true,
        side: THREE.DoubleSide,
        uniforms: THREE.UniformsUtils.merge([
          THREE.UniformsLib.fog,
          {
            cloudTime: { value: 0 },
            windDir: { value: new THREE.Vector2(...WIND.dir).normalize() },
            cloudOffset: { value: new THREE.Vector2() },
            cloudCoverage: { value: CLOUD_COVERAGE },
            cloudDark: { value: 0 },
            sunDir: { value: sunDir.clone() },
            camPos: { value: new THREE.Vector3() },
          },
        ]),
      }),
    [sunDir],
  );

  useFrame(({ camera, clock }) => {
    material.uniforms.cloudTime.value = cloudMotion.time;
    material.uniforms.cloudOffset.value.set(cloudMotion.offsetX, cloudMotion.offsetZ);
    material.uniforms.camPos.value.copy(camera.position);
    material.uniforms.cloudCoverage.value = weather.params.coverage;
    material.uniforms.cloudDark.value = weather.params.darkness;
    // La capa sigue a la cámara; el ruido se evalúa en coordenadas de mundo, así que no "nada"
    mesh.current.position.set(camera.position.x, CLOUD_HEIGHT, camera.position.z);
  });

  return (
    <mesh ref={mesh} rotation-x={-Math.PI / 2} material={material} frustumCulled={false} renderOrder={5}>
      <planeGeometry args={[14000, 14000, 1, 1]} />
    </mesh>
  );
}
