'use client';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { POOL, WATERFALL } from '../island';

const G = 9.8;
const EXIT_SPEED = 3.2; // m/s con que el agua sale del labio

/** Cortina de agua: sigue una parábola desde el labio hasta la poza. */
function buildCurtain(): THREE.BufferGeometry {
  const cols = 28, rows = 48;
  const drop = WATERFALL.lipY - WATERFALL.poolY;
  const tTotal = Math.sqrt((2 * drop) / G);
  const dir = new THREE.Vector3(WATERFALL.dirX, 0, WATERFALL.dirZ);
  const perp = new THREE.Vector3(-WATERFALL.dirZ, 0, WATERFALL.dirX);
  const positions = new Float32Array(cols * rows * 3);
  const uvs = new Float32Array(cols * rows * 2);
  const indices: number[] = [];

  for (let j = 0; j < rows; j++) {
    const t = j / (rows - 1);
    const time = tTotal * t;
    const forward = EXIT_SPEED * time + 0.3;
    const y = WATERFALL.lipY - 0.5 * G * time * time - 0.2;
    const halfW = (WATERFALL.width / 2) * (1 + 0.35 * t);
    for (let i = 0; i < cols; i++) {
      const u = (i / (cols - 1)) * 2 - 1;
      const k = j * cols + i;
      positions[k * 3] = WATERFALL.lipX + dir.x * forward + perp.x * u * halfW;
      positions[k * 3 + 1] = y;
      positions[k * 3 + 2] = WATERFALL.lipZ + dir.z * forward + perp.z * u * halfW;
      uvs[k * 2] = (u + 1) / 2;
      uvs[k * 2 + 1] = t;
      if (i < cols - 1 && j < rows - 1) indices.push(k, k + cols, k + 1, k + 1, k + cols, k + cols + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

const noiseGLSL = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
`;

const curtainVert = /* glsl */ `
  uniform float time;
  varying vec2 vUv;
  varying vec3 vWorldPos;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vec3 p = position;
    // Ondulación lateral que crece con la caída
    p.x += sin(time * 3.0 + uv.y * 9.0 + uv.x * 4.0) * 0.12 * uv.y;
    p.z += cos(time * 2.6 + uv.y * 7.0) * 0.12 * uv.y;
    vec4 worldPos = modelMatrix * vec4(p, 1.0);
    vWorldPos = worldPos.xyz;
    vec4 mvPosition = viewMatrix * worldPos;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const curtainFrag = /* glsl */ `
  uniform float time;
  varying vec2 vUv;
  varying vec3 vWorldPos;
  #include <fog_pars_fragment>
  ${noiseGLSL}
  void main() {
    // El agua acelera al caer: el desplazamiento crece con uv.y
    float flow = vUv.y * (3.0 + 5.0 * vUv.y) - time * 2.4;
    float streaks = vnoise(vec2(vUv.x * 10.0, flow)) * 0.55
                  + vnoise(vec2(vUv.x * 26.0 + 3.0, flow * 1.7 + 5.0)) * 0.3
                  + vnoise(vec2(vUv.x * 60.0 + 9.0, flow * 3.0)) * 0.15;
    float body = smoothstep(0.3, 0.72, streaks + vUv.y * 0.15);

    float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
    float top = smoothstep(0.0, 0.06, vUv.y);

    vec3 water = vec3(0.55, 0.78, 0.9);
    vec3 color = mix(water, vec3(1.0), body * 0.85 + vUv.y * 0.15);
    float alpha = (0.3 + 0.7 * body) * edge * top * (0.55 + 0.45 * vUv.y);

    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

const poolFrag = /* glsl */ `
  uniform float time;
  varying vec2 vUv;
  #include <fog_pars_fragment>
  ${noiseGLSL}
  void main() {
    vec2 c = vUv - 0.5;
    float r = length(c) * 2.0;
    float ang = atan(c.y, c.x);
    // Anillos que se expanden desde el punto de impacto
    float rings = vnoise(vec2(ang * 3.0, r * 6.0 - time * 1.6)) * 0.6 + vnoise(vec2(ang * 8.0 + 4.0, r * 14.0 - time * 2.5)) * 0.4;
    float mask = (1.0 - smoothstep(0.15, 1.0, r));
    float foam = smoothstep(0.42, 0.7, rings + mask * 0.35) * mask;
    gl_FragColor = vec4(vec3(0.95, 0.97, 1.0), foam * 0.9);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

const poolVert = /* glsl */ `
  varying vec2 vUv;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const mistVert = /* glsl */ `
  uniform float time;
  attribute float phase;
  attribute float speed;
  attribute float size;
  varying float vLife;
  #include <fog_pars_vertex>
  void main() {
    float life = fract(time * speed + phase);   // 0 → 1
    vLife = life;
    vec3 p = position;
    p.y += life * 7.0;
    p.x += sin(phase * 40.0 + time * 0.8) * life * 1.5;
    p.z += cos(phase * 31.0 + time * 0.7) * life * 1.5;
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = size * (1.0 + life * 2.5) * (240.0 / -mvPosition.z);
    #include <fog_vertex>
  }
`;

const mistFrag = /* glsl */ `
  varying float vLife;
  #include <fog_pars_fragment>
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float soft = 1.0 - smoothstep(0.2, 1.0, d);
    float env = smoothstep(0.0, 0.15, vLife) * (1.0 - smoothstep(0.4, 1.0, vLife));
    gl_FragColor = vec4(vec3(0.95, 0.97, 1.0), soft * env * 0.22);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

function buildMist(count: number): THREE.BufferGeometry {
  const positions = new Float32Array(count * 3);
  const phase = new Float32Array(count);
  const speed = new Float32Array(count);
  const size = new Float32Array(count);
  // punto de impacto: donde la cortina toca la poza
  const drop = WATERFALL.lipY - WATERFALL.poolY;
  const forward = EXIT_SPEED * Math.sqrt((2 * drop) / G) + 0.3;
  const ix = WATERFALL.lipX + WATERFALL.dirX * forward;
  const iz = WATERFALL.lipZ + WATERFALL.dirZ * forward;
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * 5.5;
    positions[i * 3] = ix + Math.cos(a) * r;
    positions[i * 3 + 1] = WATERFALL.poolY + 0.2;
    positions[i * 3 + 2] = iz + Math.sin(a) * r;
    phase[i] = Math.random();
    speed[i] = 0.12 + Math.random() * 0.1;
    size[i] = 40 + Math.random() * 50;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
  geo.setAttribute('speed', new THREE.BufferAttribute(speed, 1));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
  return geo;
}

export function Waterfall() {
  const curtain = useMemo(buildCurtain, []);
  const mist = useMemo(() => buildMist(160), []);
  const mats = useRef<THREE.ShaderMaterial[]>([]);

  const make = (vs: string, fs: string, extra: Partial<THREE.ShaderMaterialParameters> = {}) => {
    const m = new THREE.ShaderMaterial({
      vertexShader: vs,
      fragmentShader: fs,
      transparent: true,
      fog: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { time: { value: 0 } }]),
      ...extra,
    });
    mats.current.push(m);
    return m;
  };
  const curtainMat = useMemo(() => make(curtainVert, curtainFrag), []); // eslint-disable-line react-hooks/exhaustive-deps
  const poolMat = useMemo(() => make(poolVert, poolFrag), []); // eslint-disable-line react-hooks/exhaustive-deps
  const mistMat = useMemo(() => make(mistVert, mistFrag), []); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((_, dt) => {
    for (const m of mats.current) m.uniforms.time.value += Math.min(dt, 0.05);
  });

  return (
    <group>
      <mesh geometry={curtain} material={curtainMat} />
      <mesh material={poolMat} rotation-x={-Math.PI / 2} position={[POOL.x, WATERFALL.poolY + 0.06, POOL.z]}>
        <circleGeometry args={[POOL.radius - 0.5, 48]} />
      </mesh>
      <points geometry={mist} material={mistMat} />
    </group>
  );
}
