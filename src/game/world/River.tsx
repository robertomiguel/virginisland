'use client';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { RIVER, RIVER_CHANNEL_HALF_WIDTH, RIVER_SURFACE_ABOVE_BED } from '../island';
import { WATER_LEVEL } from '../config';

/** Cinta de agua que sigue el cauce; la cascada es el tramo casi vertical de la misma cinta. */
function buildRiverGeometry(): THREE.BufferGeometry {
  const half = RIVER_CHANNEL_HALF_WIDTH + 1.2; // se entierra un poco en las orillas
  const n = RIVER.length;
  const positions = new Float32Array(n * 2 * 3);
  const uvs = new Float32Array(n * 2 * 2);
  const slopes = new Float32Array(n * 2);
  const indices: number[] = [];

  for (let i = 0; i < n; i++) {
    const a = RIVER[Math.max(i - 1, 0)];
    const b = RIVER[Math.min(i + 1, n - 1)];
    const p = RIVER[i];
    let tx = b.x - a.x, tz = b.z - a.z;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl; tz /= tl;
    const nx = -tz, nz = tx;
    const y = p.bed + RIVER_SURFACE_ABOVE_BED;
    // pendiente: descenso por metro recorrido
    const ds = Math.max(b.s - a.s, 0.01);
    const slope = (a.bed - b.bed) / ds;

    for (let side = 0; side < 2; side++) {
      const sgn = side === 0 ? -1 : 1;
      const k = i * 2 + side;
      positions[k * 3] = p.x + nx * half * sgn;
      positions[k * 3 + 1] = y;
      positions[k * 3 + 2] = p.z + nz * half * sgn;
      uvs[k * 2] = side;
      uvs[k * 2 + 1] = p.s / 6.0;
      slopes[k] = slope;
    }
    if (i < n - 1) {
      // El tramo casi vertical (la cascada) lo dibuja la cortina de agua, no la cinta
      const segSlope = (RIVER[i].bed - RIVER[i + 1].bed) / Math.max(RIVER[i + 1].s - RIVER[i].s, 0.01);
      // Bajo el nivel del mar la lámina la pone el océano
      const underSea = RIVER[i].bed + RIVER_SURFACE_ABOVE_BED < WATER_LEVEL - 0.6;
      if (segSlope < 1.5 && !underSea) {
        const k = i * 2;
        indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('slope', new THREE.BufferAttribute(slopes, 1));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

const vertexShader = /* glsl */ `
  attribute float slope;
  varying vec2 vUv;
  varying float vSlope;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vSlope = slope;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 mvPosition = viewMatrix * worldPos;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  uniform float time;
  uniform vec3 sunDir;
  uniform vec3 waterColor;
  uniform vec3 skyColor;
  uniform float seaLevel;
  varying vec2 vUv;
  varying float vSlope;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  #include <fog_pars_fragment>

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }

  void main() {
    // Cuanta más pendiente, más rápido fluye y más espuma
    float steep = smoothstep(0.05, 0.6, vSlope);
    float speed = 0.6 + steep * 5.0;
    vec2 flowUv = vec2(vUv.x * 4.0, vUv.y - time * speed);

    float streaks = vnoise(flowUv * vec2(1.0, 0.35)) * 0.6 + vnoise(flowUv * vec2(3.0, 1.0) + 7.0) * 0.4;
    float ripple = vnoise(vWorldPos.xz * 1.5 + vec2(time * 0.4, -time * 0.3));

    vec3 n = normalize(vNormal + vec3(ripple - 0.5, 0.0, streaks - 0.5) * 0.25);
    vec3 v = normalize(cameraPosition - vWorldPos);
    float fresnel = pow(1.0 - max(dot(n, v), 0.0), 3.0);
    vec3 hv = normalize(sunDir + v);
    float spec = pow(max(dot(n, hv), 0.0), 120.0) * 1.2;

    vec3 color = mix(waterColor, skyColor, fresnel * 0.6) + spec;

    // Espuma: bordes del cauce, tramos rápidos y, sobre todo, la cascada
    float edge = smoothstep(0.35, 0.0, abs(vUv.x - 0.5) * 2.0 - 0.55);
    float foam = smoothstep(0.55, 0.8, streaks + steep * 0.5) * (0.25 + steep * 0.75);
    foam += edge * 0.25 * smoothstep(0.4, 0.7, streaks);
    foam += steep * smoothstep(0.3, 0.6, vnoise(flowUv * 6.0)) * 0.6;
    foam = clamp(foam, 0.0, 1.0);
    color = mix(color, vec3(0.95, 0.97, 1.0), foam);

    float alpha = mix(0.8, 1.0, max(foam, steep));
    // Desembocadura: la cinta se funde con el mar al acercarse a su nivel
    alpha *= smoothstep(seaLevel - 0.4, seaLevel + 2.5, vWorldPos.y);
    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export function River({ sunDir }: { sunDir: THREE.Vector3 }) {
  const geometry = useMemo(buildRiverGeometry, []);
  const material = useRef<THREE.ShaderMaterial>(null!);
  const uniforms = useMemo(
    () =>
      THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          time: { value: 0 },
          sunDir: { value: sunDir.clone() },
          waterColor: { value: new THREE.Color('#2fa4b8') }, // mismo tono que el agua somera del mar
          skyColor: { value: new THREE.Color('#a9cfee') },
          seaLevel: { value: WATER_LEVEL },
        },
      ]),
    [sunDir],
  );

  useFrame((_, dt) => {
    material.current.uniforms.time.value += Math.min(dt, 0.05);
  });

  return (
    <mesh geometry={geometry}>
      <shaderMaterial
        ref={material}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        fog
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
