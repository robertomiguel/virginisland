'use client';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CLOUD_COVERAGE, CLOUD_HEIGHT, CLOUD_SHADOW, DEEP_SEA_FLOOR, ISLAND_SIZE, OCEAN_CENTER_DENSITY, OCEAN_HALF_SIZE, OCEAN_SEGMENTS, WIND, lowQuality } from '../config';
import { cloudGLSL, noiseGLSL } from './skyGLSL';
import { cloudMotion, weather } from '../weather';

/*
 * Agua genérica. No sabe nada de "la isla": todo sale de la batimetría (mapa de alturas
 * del fondo); fuera del mapa el fondo es mar profundo. El mar es UNA sola malla continua,
 * con rejilla graduada (densa donde mira la cámara, gruesa hacia el horizonte) para que
 * nunca haya cortes ni costuras, ni con varias islas ni con barcos navegando.
 */

const vertexShader = /* glsl */ `
  uniform float time;
  uniform sampler2D heightmap;
  uniform float mapSize;
  uniform float deepFloor;
  uniform float waterLevel;
  uniform float waveScale;    // 1 = mar, ~0.15 = laguna
  uniform vec3 camPos;
  uniform vec2 windDir;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vDepth;
  varying float vBreak;
  #include <fog_pars_vertex>

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) { return vnoise(p) * 0.5 + vnoise(p * 2.1 + 3.7) * 0.3 + vnoise(p * 4.3 + 9.1) * 0.2; }

  float floorHeight(vec2 xz) {
    vec2 uv = xz / mapSize + 0.5;
    float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
    return mix(deepFloor, texture2D(heightmap, uv).r, inside);
  }

  vec3 gerstner(vec2 d, float steepness, float wavelength, float phase, vec3 p, inout vec3 tangent, inout vec3 binormal) {
    float k = 6.28318 / wavelength;
    float c = sqrt(9.8 / k);
    float f = k * (dot(d, p.xz) - c * time) + phase;
    float a = steepness / k;
    float s = sin(f), co = cos(f);
    tangent  += vec3(-d.x * d.x * steepness * s, d.x * steepness * co, -d.x * d.y * steepness * s);
    binormal += vec3(-d.x * d.y * steepness * s, d.y * steepness * co, -d.y * d.y * steepness * s);
    return vec3(d.x * a * co, a * s, d.y * a * co);
  }

  void main() {
    vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
    float depth = waterLevel - floorHeight(p.xz);

    // Las olas cortas se desvanecen con la distancia (la rejilla es más gruesa lejos)
    float camDist = distance(p.xz, camPos.xz);
    float near = 1.0 - smoothstep(300.0, 600.0, camDist);
    float mid = 1.0 - smoothstep(900.0, 1800.0, camDist);

    // Dirección de avance: hacia donde sube el fondo (perpendicular a la costa). Sin costa cerca, viento.
    float e = 10.0;
    vec2 grad = vec2(floorHeight(p.xz + vec2(e, 0.0)) - floorHeight(p.xz - vec2(e, 0.0)),
                     floorHeight(p.xz + vec2(0.0, e)) - floorHeight(p.xz - vec2(0.0, e)));
    float gradLen = length(grad);
    vec2 shoreDir = normalize(mix(windDir, grad / max(gradLen, 1e-4), smoothstep(0.05, 0.6, gradLen)));

    float shoal = smoothstep(12.0, 2.5, depth) * smoothstep(-0.3, 1.0, depth) * near;
    float open = smoothstep(4.0, 20.0, depth);

    vec2 np = p.xz * 0.012;
    float ampVar = 0.6 + 0.8 * fbm(np + vec2(time * 0.01, 0.0));
    float phase1 = (fbm(np * 2.0 + 17.0) - 0.5) * 6.0;
    float phase2 = (fbm(np * 2.7 + 41.0) - 0.5) * 6.0;
    float jitter = (fbm(np * 1.5 + 73.0) - 0.5) * 0.9;
    vec2 shoreDirJ = normalize(shoreDir + vec2(-shoreDir.y, shoreDir.x) * jitter);
    vec2 windDirJ = normalize(windDir + vec2(-windDir.y, windDir.x) * jitter);

    vec3 tangent = vec3(1.0, 0.0, 0.0);
    vec3 binormal = vec3(0.0, 0.0, 1.0);
    vec3 disp = vec3(0.0);

    disp += gerstner(shoreDirJ, 0.30 * shoal * ampVar * waveScale, 13.0, phase1, p, tangent, binormal);
    disp += gerstner(shoreDir,  0.20 * shoal * ampVar * waveScale, 9.0,  phase2, p, tangent, binormal);

    float swell = open * (0.5 + ampVar * 0.5) * waveScale;
    disp += gerstner(windDirJ, 0.06 * swell * mid, 37.0, phase2, p, tangent, binormal);
    disp += gerstner(normalize(vec2(-0.37, 0.93) + vec2(jitter, 0.0)), 0.05 * swell * mid, 23.0, phase1, p, tangent, binormal);
    disp += gerstner(normalize(vec2(0.55, -0.71)), 0.05 * swell * near, 11.0, phase2 * 0.7, p, tangent, binormal);
    disp += gerstner(normalize(vec2(-0.9, -0.3)),  0.04 * swell * near, 6.5,  phase1 * 0.6, p, tangent, binormal);

    disp.y += (fbm(p.xz * 0.06 + vec2(time * 0.07, -time * 0.05)) - 0.5) * 0.4 * open * waveScale * mid;

    vec3 wp = p + disp;
    vWorldPos = wp;
    vNormal = normalize(cross(binormal, tangent));
    vDepth = depth;
    vBreak = shoal * smoothstep(0.1, 0.45, disp.y);

    vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  uniform float time;
  uniform vec3 sunDir;
  uniform vec3 sunColor;
  uniform vec3 deepColor;
  uniform vec3 shallowColor;
  uniform vec3 skyColor;
  uniform float waveScale;
  uniform float cloudHeight;
  uniform float cloudShadow;
  uniform float sunStrength;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vDepth;
  varying float vBreak;
  #include <fog_pars_fragment>
  ${noiseGLSL}
  ${cloudGLSL}

  void main() {
    vec3 n = normalize(vNormal);
    float r1 = vnoise(vWorldPos.xz * 0.9 + vec2(time * 0.35, time * 0.2));
    float r2 = vnoise(vWorldPos.xz * 0.9 - vec2(time * 0.25, -time * 0.3));
    n = normalize(n + vec3(r1 - 0.5, 0.0, r2 - 0.5) * 0.16);

    vec3 v = normalize(cameraPosition - vWorldPos);
    float fresnel = pow(1.0 - max(dot(n, v), 0.0), 3.0);

    vec3 color = mix(shallowColor, deepColor, smoothstep(0.0, 9.0, vDepth));
    color = mix(color, skyColor, fresnel * 0.7);

    vec2 shadowXZ = vWorldPos.xz + sunDir.xz / max(sunDir.y, 0.05) * (cloudHeight - vWorldPos.y);
    float cloud = smoothstep(0.1, 0.8, cloudDensity(shadowXZ));
    float sunLight = (1.0 - cloudShadow * cloud) * sunStrength;
    color *= (1.0 - 0.35 * cloud) * (0.6 + 0.4 * sunStrength);

    vec3 hv = normalize(sunDir + v);
    float spec = pow(max(dot(n, hv), 0.0), 180.0) * 1.6 + pow(max(dot(n, hv), 0.0), 24.0) * 0.12;
    color += sunColor * spec * sunLight;

    float fn = vnoise(vWorldPos.xz * 1.3 + vec2(time * 0.3, -time * 0.2)) * 0.6
             + vnoise(vWorldPos.xz * 3.5 - vec2(time * 0.5, time * 0.4)) * 0.4;
    float shoreline = (1.0 - smoothstep(0.0, 0.6, vDepth)) * smoothstep(0.35, 0.6, fn) * waveScale;
    float crests = vBreak * smoothstep(0.4, 0.62, fn);
    float foam = clamp(shoreline * 0.8 + crests * 0.7, 0.0, 1.0);
    color = mix(color, vec3(0.93, 0.96, 1.0), foam);

    float alpha = mix(0.5, 1.0, smoothstep(0.0, 6.0, vDepth)); // opaca en profundidad: no se transparenta el fondo
    alpha = max(alpha, foam);

    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

function applyWeather(material: THREE.ShaderMaterial, baseWaveScale: number) {
  const u = material.uniforms;
  u.cloudCoverage.value = weather.params.coverage;
  u.sunStrength.value = weather.params.sun;
  u.waveScale.value = baseWaveScale * weather.params.waves;
}

function useWaterMaterial(heightmap: THREE.DataTexture, sunDir: THREE.Vector3, level: number, waveScale: number) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        transparent: true,
        fog: true,
        side: THREE.DoubleSide,
        uniforms: THREE.UniformsUtils.merge([
          THREE.UniformsLib.fog,
          {
            time: { value: 0 },
            heightmap: { value: null },
            mapSize: { value: ISLAND_SIZE },
            deepFloor: { value: DEEP_SEA_FLOOR },
            waterLevel: { value: level },
            waveScale: { value: waveScale },
            camPos: { value: new THREE.Vector3() },
            cloudTime: { value: 0 },
            windDir: { value: new THREE.Vector2(...WIND.dir).normalize() },
            cloudOffset: { value: new THREE.Vector2() },
            cloudCoverage: { value: CLOUD_COVERAGE },
            cloudHeight: { value: CLOUD_HEIGHT },
            cloudShadow: { value: CLOUD_SHADOW },
            sunStrength: { value: 1 },
            sunDir: { value: sunDir.clone() },
            sunColor: { value: new THREE.Color('#fff4dc') },
            deepColor: { value: new THREE.Color('#0b3d6b') },
            shallowColor: { value: new THREE.Color('#2fa4b8') },
            skyColor: { value: new THREE.Color('#a9cfee') },
          },
        ]),
      }),
    [sunDir, level, waveScale],
  );
  material.uniforms.heightmap.value = heightmap;
  return material;
}

/** Rejilla graduada: u∈[-1,1] → desplazamiento = H·(c·u + (1-c)·u³). Densa en el centro, gruesa lejos. */
function buildGradedGrid(): THREE.BufferGeometry {
  const segs = lowQuality() ? Math.round(OCEAN_SEGMENTS / 3) : OCEAN_SEGMENTS;
  const n = segs + 1;
  const c = OCEAN_CENTER_DENSITY;
  const map = (u: number) => OCEAN_HALF_SIZE * (c * u + (1 - c) * u * u * u);
  const positions = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) {
    const z = map((j / segs) * 2 - 1);
    for (let i = 0; i < n; i++) {
      const k = (j * n + i) * 3;
      positions[k] = map((i / segs) * 2 - 1);
      positions[k + 1] = 0;
      positions[k + 2] = z;
    }
  }
  const indices = new Uint32Array(segs * segs * 6);
  let q = 0;
  for (let j = 0; j < segs; j++) {
    for (let i = 0; i < segs; i++) {
      const a = j * n + i, b = a + 1, cI = a + n, d = cI + 1;
      indices[q++] = a; indices[q++] = cI; indices[q++] = b;
      indices[q++] = b; indices[q++] = cI; indices[q++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeBoundingSphere();
  return geo;
}

const SNAP = 2.5;
const tmpDir = new THREE.Vector3();

/** El mar: una única malla continua que sigue al punto que mira la cámara. */
export function Ocean({ heightmap, sunDir, level = 0 }: { heightmap: THREE.DataTexture; sunDir: THREE.Vector3; level?: number }) {
  const mesh = useRef<THREE.Mesh>(null!);
  const geometry = useMemo(buildGradedGrid, []);
  const material = useWaterMaterial(heightmap, sunDir, level, 1);

  useFrame(({ camera, clock }, dt) => {
    material.uniforms.time.value += Math.min(dt, 0.05);
    material.uniforms.cloudTime.value = cloudMotion.time;
    material.uniforms.cloudOffset.value.set(cloudMotion.offsetX, cloudMotion.offsetZ);
    material.uniforms.camPos.value.copy(camera.position);
    applyWeather(material, 1);

    // Punto donde la mirada corta el plano del agua (acotado), ajustado a la rejilla fina
    camera.getWorldDirection(tmpDir);
    let t = tmpDir.y < -1e-3 ? (level - camera.position.y) / tmpDir.y : 600;
    t = Math.min(Math.max(t, 0), 600);
    const fx = Math.round((camera.position.x + tmpDir.x * t) / SNAP) * SNAP;
    const fz = Math.round((camera.position.z + tmpDir.z * t) / SNAP) * SNAP;
    mesh.current.position.set(fx, level, fz);
  });

  return <mesh ref={mesh} geometry={geometry} material={material} frustumCulled={false} />;
}

/** Lámina de agua estática (laguna, etc.) con la misma apariencia que el mar. */
export function StillWater({
  heightmap, sunDir, level, waveScale = 0.15, outline,
}: { heightmap: THREE.DataTexture; sunDir: THREE.Vector3; level: number; waveScale?: number; outline: [number, number][] }) {
  const material = useWaterMaterial(heightmap, sunDir, level, waveScale);
  const geometry = useMemo(() => {
    // Polígono en XZ (la forma la da el contorno irregular de la cubeta)
    const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z)));
    const geo = new THREE.ShapeGeometry(shape, 1);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, [outline]);
  useFrame(({ camera, clock }, dt) => {
    material.uniforms.time.value += Math.min(dt, 0.05);
    material.uniforms.cloudTime.value = cloudMotion.time;
    material.uniforms.cloudOffset.value.set(cloudMotion.offsetX, cloudMotion.offsetZ);
    material.uniforms.camPos.value.copy(camera.position);
    applyWeather(material, waveScale);
  });
  return <mesh geometry={geometry} position={[0, level, 0]} material={material} />;
}
