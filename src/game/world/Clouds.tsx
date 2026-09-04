'use client';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { REFLECT_MASK } from './Reflection';
import { CLOUD_COVERAGE, CLOUD_HEIGHT, WIND } from '../config';
import { cloudGLSL, noiseGLSL } from './skyGLSL';
import { cloudMotion, sunState, weather } from '../weather';

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
  uniform vec4 fade;        // (tan mín, tan lleno, distancia de inicio, distancia de fin) del desvanecido
  uniform float cloudDark;
  uniform float dayLight;
  varying vec3 vWorldPos;
  #include <fog_pars_fragment>
  ${noiseGLSL}
  ${cloudGLSL}
  void main() {
    float d = cloudDensity(vWorldPos.xz);
    if (d < 0.003) discard;
    // Sombreado con el grosor continuo (no con la cobertura, que se satura en cielo cubierto)
    float raw = cloudRaw(vWorldPos.xz);
    vec2 toSun = normalize(sunDir.xz + vec2(1e-4)) * 110.0;
    float rawSun = cloudRaw(vWorldPos.xz + toSun);
    float lit = clamp(0.5 + (raw - rawSun) * 4.5, 0.0, 1.0);
    float thick = smoothstep(0.32, 0.72, raw);
    vec3 bright = mix(vec3(1.0, 0.99, 0.97), vec3(0.66, 0.68, 0.72), cloudDark);
    vec3 shade = mix(vec3(0.62, 0.67, 0.78), vec3(0.20, 0.22, 0.27), cloudDark);
    vec3 color = mix(shade, bright, lit * (1.0 - thick * 0.65) + 0.08);
    // Bolsas oscuras a dos escalas (volumen de cielo de tormenta), más marcadas cuanto más cubierto
    vec2 q = (vWorldPos.xz + cloudOffset * 0.8) * 0.0011;
    float lumps = fbm5(q * 2.6 + 57.0) * 0.6 + fbm5(q * 7.0 + 91.0) * 0.4;
    float dark = smoothstep(0.42, 0.7, lumps) * (0.35 + 0.65 * cloudDark) * smoothstep(0.5, 1.0, cloudCoverage);
    color *= 1.0 - 0.5 * dark;
    color *= mix(0.02, 1.0, dayLight);
    // Bordes suaves y desvanecido hacia el horizonte. Se apaga por ÁNGULO, no por distancia:
    // caminando, una capa plana a 650 m se comprime contra el horizonte y forma una pared blanca
    // por detrás y por debajo de la arboleda. La capa se disuelve en la calima por debajo de unos
    // 8° sobre el horizonte (menos con cielo cubierto: ahí es gris y sí tiene que llegar abajo).
    // El corte por distancia solo evita que la recorte el plano lejano de la cámara.
    float dist = max(distance(vWorldPos.xz, camPos.xz), 1.0);
    float up = vWorldPos.y - camPos.y;
    float elev = up / dist;                            // tangente del ángulo sobre el horizonte
    float below = smoothstep(0.0, 300.0, up);          // solo con la cámara bien por debajo de la capa
    float lo = mix(fade.x, fade.x * 0.4, cloudCoverage);
    float horizon = mix(1.0, smoothstep(lo, lo + fade.y, elev), below) * (1.0 - smoothstep(fade.z, fade.w, dist));
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
            dayLight: { value: 1 },
            sunDir: { value: sunDir.clone() },
            camPos: { value: new THREE.Vector3() },
            fade: { value: new THREE.Vector4(0.14, 0.14, 2750, 3900) },
          },
        ]),
      }),
    [sunDir],
  );

  useFrame(({ camera, clock }) => {
    material.uniforms.cloudTime.value = cloudMotion.time;
    material.uniforms.cloudOffset.value.set(cloudMotion.offsetX, cloudMotion.offsetZ);
    material.uniforms.camPos.value.copy(camera.position);
    const far = (camera as THREE.PerspectiveCamera).far;
    material.uniforms.fade.value.set(0.14, 0.14, far * 0.55, far * 0.8);
    material.uniforms.cloudCoverage.value = weather.params.coverage;
    material.uniforms.cloudDark.value = weather.params.darkness;
    material.uniforms.dayLight.value = sunState.day;
    material.uniforms.sunDir.value.copy(sunState.dir);
    // La capa sigue a la cámara; el ruido se evalúa en coordenadas de mundo, así que no "nada"
    mesh.current.position.set(camera.position.x, CLOUD_HEIGHT, camera.position.z);
  });

  return (
    <mesh ref={mesh} rotation-x={-Math.PI / 2} material={material} frustumCulled={false} renderOrder={5} layers-mask={REFLECT_MASK}>
      <planeGeometry args={[14000, 14000, 1, 1]} />
    </mesh>
  );
}
