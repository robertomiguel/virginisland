'use client';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { POOL, WATERFALL } from '../island';
import { WIND } from '../config';
import { noiseGLSL } from './skyGLSL';
import { sunState, sunStrength } from '../weather';

const G = 9.8;
const EXIT_SPEED = 3.2; // m/s con que el agua sale del labio
const DROP = WATERFALL.lipY - WATERFALL.poolY;
const T_TOTAL = Math.sqrt((2 * DROP) / G); // segundos de caída
const DIR = new THREE.Vector3(WATERFALL.dirX, 0, WATERFALL.dirZ);
const PERP = new THREE.Vector3(-WATERFALL.dirZ, 0, WATERFALL.dirX);
/** Punto donde la cortina toca la poza. */
const IMPACT = new THREE.Vector3(WATERFALL.lipX, WATERFALL.poolY, WATERFALL.lipZ).addScaledVector(DIR, EXIT_SPEED * T_TOTAL + 0.3);

/** Cortina de agua: sigue una parábola desde el labio hasta la poza. */
function buildCurtain(): THREE.BufferGeometry {
  const cols = 32, rows = 56;
  const positions = new Float32Array(cols * rows * 3);
  const uvs = new Float32Array(cols * rows * 2);
  const indices: number[] = [];

  for (let j = 0; j < rows; j++) {
    const t = j / (rows - 1);
    const time = T_TOTAL * t;
    const forward = EXIT_SPEED * time + 0.3;
    const y = WATERFALL.lipY - 0.5 * G * time * time - 0.2;
    const halfW = (WATERFALL.width / 2) * (1 + 0.35 * t);
    for (let i = 0; i < cols; i++) {
      const u = (i / (cols - 1)) * 2 - 1;
      const k = j * cols + i;
      positions[k * 3] = WATERFALL.lipX + DIR.x * forward + PERP.x * u * halfW;
      positions[k * 3 + 1] = y;
      positions[k * 3 + 2] = WATERFALL.lipZ + DIR.z * forward + PERP.z * u * halfW;
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

const lightingGLSL = /* glsl */ `
  uniform vec3 sunDir;
  uniform vec3 sunColor;
  uniform float sunLight;
  uniform float dayLight;
  // Espuma: difusa, con algo de luz que la atraviesa cuando el sol queda detrás
  vec3 foamLight(vec3 n, vec3 v) {
    float diff = 0.55 + 0.45 * max(dot(n, sunDir), 0.0);
    float back = pow(max(dot(-v, sunDir), 0.0), 6.0) * 0.35;
    vec3 c = vec3(0.93, 0.96, 1.0) * (0.45 + 0.55 * diff * sunLight) + sunColor * back * sunLight;
    return c * mix(0.012, 1.0, dayLight);
  }
`;

const curtainVert = /* glsl */ `
  uniform float time;
  uniform float layer;   // 0 capa trasera densa, 1 capa delantera fina
  uniform vec3 fallDir;
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vec3 p = position;
    float fall = uv.y * uv.y; // la caída real crece con el cuadrado del tiempo
    // Ondulación lateral y de espesor que crece con la caída
    vec3 perp = vec3(-fallDir.z, 0.0, fallDir.x);
    float w1 = sin(time * 2.4 + uv.y * 8.0 + uv.x * 5.0 + layer * 1.7);
    float w2 = cos(time * 1.9 + uv.y * 6.0 - uv.x * 3.0 + layer * 0.9);
    p += perp * w1 * (0.05 + 0.25 * fall);
    p += fallDir * (w2 * (0.04 + 0.2 * fall) + layer * (0.35 + 0.3 * fall));
    vec4 worldPos = modelMatrix * vec4(p, 1.0);
    vWorldPos = worldPos.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 mvPosition = viewMatrix * worldPos;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const curtainFrag = /* glsl */ `
  uniform float time;
  uniform float layer;
  uniform float tTotal;
  uniform vec3 skyColor;
  uniform vec3 bodyColor;
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  #include <fog_pars_fragment>
  ${noiseGLSL}
  ${lightingGLSL}
  void main() {
    // Cada "paquete" de agua conserva su dibujo mientras cae: se muestrea por el instante en que
    // salió del labio. Así las vetas se estiran solas al acelerar (misma Δt, más metros abajo).
    float emit = vUv.y * tTotal - time;
    float seed = layer * 13.0;
    // Columnas gruesas y finas a lo ancho, que cambian despacio
    float ropes = vnoise(vec2(vUv.x * 5.0 + seed, emit * 0.12)) * 0.6
                + vnoise(vec2(vUv.x * 11.0 + seed * 3.0, emit * 0.25 + 2.0)) * 0.4;
    // Vetas finas que bajan con el agua
    float streaks = vnoise(vec2(vUv.x * 14.0 + seed, emit * 2.2)) * 0.5
                  + vnoise(vec2(vUv.x * 32.0 + seed, emit * 3.6 + 9.0)) * 0.3
                  + vnoise(vec2(vUv.x * 70.0 + seed, emit * 6.0 + 4.0)) * 0.2;
    // Aireación: el agua sale cristalina y se vuelve blanca al caer
    float aer = smoothstep(0.02, 0.45, vUv.y);
    float density = ropes * 0.55 + streaks * 0.45 + aer * 0.12 - layer * 0.12;
    float body = smoothstep(0.38, 0.8, density);

    // Bordes irregulares: la cortina se deshilacha en los lados
    float side = abs(vUv.x - 0.5) * 2.0;
    float edge = 1.0 - smoothstep(0.55 + ropes * 0.35, 1.0, side);
    float top = smoothstep(0.0, 0.05, vUv.y);
    float bottom = 1.0 - smoothstep(0.94, 1.0, vUv.y); // se funde con la espuma de la poza

    vec3 v = normalize(cameraPosition - vWorldPos);
    vec3 n = normalize(vNormal);
    if (dot(n, v) < 0.0) n = -n;
    // Agua clara del labio: cuerpo oscuro con reflejo del cielo
    float fresnel = 0.03 + 0.97 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
    vec3 clear = mix(bodyColor, skyColor, fresnel) * mix(0.012, 1.0, dayLight);
    vec3 hv = normalize(sunDir + v);
    clear += sunColor * pow(max(dot(n, hv), 0.0), 120.0) * sunLight * mix(0.012, 1.0, dayLight);

    float white = clamp(aer * (0.35 + 0.65 * body) + body * 0.2, 0.0, 1.0);
    vec3 color = mix(clear, foamLight(n, v), white);

    float alpha = (0.18 + 0.82 * body) * mix(0.6, 1.0, aer) * edge * top * bottom;
    alpha *= mix(1.0, 0.55, layer);
    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

const poolVert = /* glsl */ `
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

const poolFrag = /* glsl */ `
  uniform float time;
  uniform vec3 impact;
  uniform vec3 fallDir;
  uniform float halfWidth;
  uniform float poolRadius;
  uniform vec3 poolCenter;
  varying vec3 vWorldPos;
  #include <fog_pars_fragment>
  ${noiseGLSL}
  ${lightingGLSL}
  void main() {
    vec2 d = vWorldPos.xz - impact.xz;
    vec2 D = normalize(fallDir.xz);
    vec2 P = vec2(-D.y, D.x);
    float along = dot(d, D);   // >0 aguas abajo del impacto
    float across = dot(d, P);
    // Distancia a la línea de impacto (un segmento del ancho de la cortina)
    float dist = length(vec2(max(abs(across) - halfWidth, 0.0), max(-along, 0.0) * 1.5 + max(along - 1.0, 0.0) * 0.8));
    // Hervidero en el impacto, que se aleja en anillos y se arrastra aguas abajo
    float churn = vnoise(vWorldPos.xz * 1.4 + vec2(time * 1.7, -time * 1.3)) * 0.5
                + vnoise(vWorldPos.xz * 3.2 - vec2(time * 2.3, time * 1.1)) * 0.5;
    float r = length(d);
    float rings = vnoise(vec2(atan(d.y, d.x) * 4.0, r * 1.8 - time * 2.2));
    float core = exp(-dist * 0.8);
    float foam = smoothstep(0.3, 0.8, core * 1.2 + (churn - 0.5) * 0.7 + (rings - 0.5) * 0.35 * (1.0 - core));
    foam *= 1.0 - smoothstep(poolRadius - 3.0, poolRadius + 0.5, distance(vWorldPos.xz, poolCenter.xz));
    vec3 v = normalize(cameraPosition - vWorldPos);
    gl_FragColor = vec4(foamLight(vec3(0.0, 1.0, 0.0), v), foam * 0.95);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

const mistVert = /* glsl */ `
  uniform float time;
  uniform float pxPerMeter;
  uniform vec2 wind;
  attribute float phase;
  attribute float speed;
  attribute float size;
  varying float vLife;
  varying float vSeed;
  #include <fog_pars_vertex>
  void main() {
    float life = fract(time * speed + phase);   // 0 → 1
    vLife = life;
    vSeed = phase;
    vec3 p = position;
    p.y += life * 5.0;
    p.x += sin(phase * 40.0 + time * 0.8) * life * 1.2 + wind.x * life * 3.0;
    p.z += cos(phase * 31.0 + time * 0.7) * life * 1.2 + wind.y * life * 3.0;
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    // Tamaño en metros (crece al dispersarse) proyectado a píxeles
    gl_PointSize = size * (1.0 + life * 1.8) * pxPerMeter / max(-mvPosition.z, 1.0);
    #include <fog_vertex>
  }
`;

const mistFrag = /* glsl */ `
  varying float vLife;
  varying float vSeed;
  #include <fog_pars_fragment>
  ${noiseGLSL}
  ${lightingGLSL}
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    // Bocanada de vapor: disco suave con ruido para que no parezca una bola
    float puff = vnoise(gl_PointCoord * 4.0 + vSeed * 50.0) * 0.6 + vnoise(gl_PointCoord * 9.0 + vSeed * 90.0) * 0.4;
    float soft = (1.0 - smoothstep(0.25, 1.0, d)) * smoothstep(0.3, 0.7, puff + 0.15);
    float env = smoothstep(0.0, 0.2, vLife) * (1.0 - smoothstep(0.35, 1.0, vLife));
    gl_FragColor = vec4(foamLight(vec3(0.0, 1.0, 0.0), vec3(0.0, 0.0, 1.0)), soft * env * 0.22);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

const sprayVert = /* glsl */ `
  uniform float time;
  uniform float pxPerMeter;
  attribute float phase;
  attribute float speed;
  attribute vec3 velocity;
  varying float vLife;
  #include <fog_pars_vertex>
  void main() {
    float period = 1.0 / speed;
    float t = mod(time + phase * period, period);   // segundos desde que saltó
    vLife = t / period;
    // Gota balística: sale del impacto y cae
    vec3 p = position + velocity * t - vec3(0.0, 4.9 * t * t, 0.0);
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = 0.14 * pxPerMeter / max(-mvPosition.z, 1.0);
    #include <fog_vertex>
  }
`;

const sprayFrag = /* glsl */ `
  varying float vLife;
  #include <fog_pars_fragment>
  ${lightingGLSL}
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float soft = 1.0 - smoothstep(0.3, 1.0, d);
    float env = 1.0 - smoothstep(0.6, 1.0, vLife);
    gl_FragColor = vec4(foamLight(vec3(0.0, 1.0, 0.0), vec3(0.0, 0.0, 1.0)) * 1.1, soft * env * 0.6);
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
  for (let i = 0; i < count; i++) {
    // Nacen a lo largo de la línea de impacto, algo dispersas
    const u = (Math.random() * 2 - 1) * (WATERFALL.width / 2 + 1.5);
    const f = (Math.random() - 0.3) * 3.0;
    positions[i * 3] = IMPACT.x + PERP.x * u + DIR.x * f;
    positions[i * 3 + 1] = WATERFALL.poolY + 0.3;
    positions[i * 3 + 2] = IMPACT.z + PERP.z * u + DIR.z * f;
    phase[i] = Math.random();
    speed[i] = 0.16 + Math.random() * 0.12;
    size[i] = 1.6 + Math.random() * 1.6; // metros
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
  geo.setAttribute('speed', new THREE.BufferAttribute(speed, 1));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
  return geo;
}

function buildSpray(count: number): THREE.BufferGeometry {
  const positions = new Float32Array(count * 3);
  const phase = new Float32Array(count);
  const speed = new Float32Array(count);
  const velocity = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const u = (Math.random() * 2 - 1) * (WATERFALL.width / 2);
    positions[i * 3] = IMPACT.x + PERP.x * u;
    positions[i * 3 + 1] = WATERFALL.poolY + 0.1;
    positions[i * 3 + 2] = IMPACT.z + PERP.z * u;
    const a = Math.random() * Math.PI * 2;
    const h = 0.6 + Math.random() * 2.2;
    velocity[i * 3] = Math.cos(a) * h + DIR.x * 1.2;
    velocity[i * 3 + 1] = 2.5 + Math.random() * 3.5;
    velocity[i * 3 + 2] = Math.sin(a) * h + DIR.z * 1.2;
    phase[i] = Math.random();
    speed[i] = 0.9 + Math.random() * 0.4; // 1/periodo
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
  geo.setAttribute('speed', new THREE.BufferAttribute(speed, 1));
  geo.setAttribute('velocity', new THREE.BufferAttribute(velocity, 3));
  return geo;
}

export function Waterfall() {
  const curtain = useMemo(buildCurtain, []);
  const mist = useMemo(() => buildMist(90), []);
  const spray = useMemo(() => buildSpray(220), []);
  const mats = useRef<THREE.ShaderMaterial[]>([]);

  const make = (vs: string, fs: string, extra: Record<string, THREE.IUniform> = {}) => {
    const m = new THREE.ShaderMaterial({
      vertexShader: vs,
      fragmentShader: fs,
      transparent: true,
      fog: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          time: { value: 0 },
          dayLight: { value: 1 },
          sunLight: { value: 1 },
          sunDir: { value: sunState.dir.clone() },
          sunColor: { value: new THREE.Color('#fff4dc') },
          pxPerMeter: { value: 800 },
        },
        extra,
      ]),
    });
    mats.current.push(m);
    return m;
  };
  /* eslint-disable react-hooks/exhaustive-deps */
  const curtainBack = useMemo(() => make(curtainVert, curtainFrag, {
    layer: { value: 0 }, tTotal: { value: T_TOTAL }, fallDir: { value: DIR.clone() },
    skyColor: { value: new THREE.Color('#a9cfee') }, bodyColor: { value: new THREE.Color('#0f3a3c') },
  }), []);
  const curtainFront = useMemo(() => make(curtainVert, curtainFrag, {
    layer: { value: 1 }, tTotal: { value: T_TOTAL }, fallDir: { value: DIR.clone() },
    skyColor: { value: new THREE.Color('#a9cfee') }, bodyColor: { value: new THREE.Color('#0f3a3c') },
  }), []);
  const poolMat = useMemo(() => make(poolVert, poolFrag, {
    impact: { value: IMPACT.clone() }, fallDir: { value: DIR.clone() }, halfWidth: { value: WATERFALL.width / 2 },
    poolRadius: { value: POOL.radius }, poolCenter: { value: new THREE.Vector3(POOL.x, 0, POOL.z) },
  }), []);
  const mistMat = useMemo(() => make(mistVert, mistFrag, {
    wind: { value: new THREE.Vector2(...WIND.dir).normalize() },
  }), []);
  const sprayMat = useMemo(() => make(sprayVert, sprayFrag), []);
  /* eslint-enable react-hooks/exhaustive-deps */

  useFrame(({ camera, size, viewport }, dt) => {
    const cam = camera as THREE.PerspectiveCamera;
    const pxPerMeter = (size.height * viewport.dpr) / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
    for (const m of mats.current) {
      const u = m.uniforms;
      u.time.value += Math.min(dt, 0.05);
      u.dayLight.value = sunState.day;
      u.sunLight.value = sunStrength();
      u.sunDir.value.copy(sunState.dir);
      u.pxPerMeter.value = pxPerMeter;
    }
  });

  return (
    <group>
      <mesh geometry={curtain} material={curtainBack} renderOrder={2} />
      <mesh geometry={curtain} material={curtainFront} renderOrder={3} />
      <mesh material={poolMat} rotation-x={-Math.PI / 2} position={[POOL.x, WATERFALL.poolY + 0.06, POOL.z]} renderOrder={2}>
        <circleGeometry args={[POOL.radius, 48]} />
      </mesh>
      <points geometry={spray} material={sprayMat} renderOrder={4} frustumCulled={false} />
      <points geometry={mist} material={mistMat} renderOrder={5} frustumCulled={false} />
    </group>
  );
}
