'use client';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CLOUD_COVERAGE, CLOUD_HEIGHT, CLOUD_SHADOW, DEEP_SEA_FLOOR, ISLAND_SIZE, OCEAN_CENTER_DENSITY, OCEAN_HALF_SIZE, OCEAN_SEGMENTS, WIND, lowQuality } from '../config';
import { cloudGLSL, noiseGLSL, rainGLSL } from './skyGLSL';
import { cloudMotion, lightning, sunState, sunStrength, weather } from '../weather';
import { PATCH, oceanSimHolder } from './oceanSim';
import { shadowUniforms, shadowsGLSL } from './Shadows';
import { reflections, type ReflectionSlot } from './Reflection';

/*
 * Agua genérica. No sabe nada de "la isla": todo sale de la batimetría (mapa de alturas
 * del fondo); fuera del mapa el fondo es mar profundo. El mar es UNA sola malla continua,
 * con rejilla graduada (densa donde mira la cámara, gruesa hacia el horizonte) para que
 * nunca haya cortes ni costuras, ni con varias islas ni con barcos navegando.
 */

/** Reloj común de las láminas de agua: el mar y el río deben mover la misma ola en la desembocadura. */
export const waterClock = { t: 0 };

/**
 * Olas de orilla (Gerstner) dirigidas por la batimetría. Requiere uniforms: time, heightmap, mapSize,
 * deepFloor, windDir, y que noiseGLSL vaya antes. Lo comparten el mar y la desembocadura del río.
 */
export const shoalGLSL = /* glsl */ `
  uniform float time;
  uniform sampler2D heightmap;
  uniform float mapSize;
  uniform float deepFloor;
  uniform vec2 windDir;

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

  // Dirección de avance de las olas de orilla: hacia donde sube el fondo (perpendicular a la costa). Sin costa cerca, viento.
  vec2 shoreDirection(vec2 xz) {
    float e = 10.0;
    vec2 grad = vec2(floorHeight(xz + vec2(e, 0.0)) - floorHeight(xz - vec2(e, 0.0)),
                     floorHeight(xz + vec2(0.0, e)) - floorHeight(xz - vec2(0.0, e)));
    float gradLen = length(grad);
    return normalize(mix(windDir, grad / max(gradLen, 1e-4), smoothstep(0.05, 0.6, gradLen)));
  }

  // Dos trenes de olas que avanzan en dir con amplitud relativa amount (ya incluye orilla y clima)
  vec3 shoalWaves(vec3 p, vec2 dir, float amount, inout vec3 tangent, inout vec3 binormal) {
    vec2 np = p.xz * 0.012;
    float ampVar = 0.6 + 0.8 * fbm(np + vec2(time * 0.01, 0.0));
    float phase1 = (fbm(np * 2.0 + 17.0) - 0.5) * 6.0;
    float phase2 = (fbm(np * 2.7 + 41.0) - 0.5) * 6.0;
    float jitter = (fbm(np * 1.5 + 73.0) - 0.5) * 0.9;
    vec2 dirJ = normalize(dir + vec2(-dir.y, dir.x) * jitter);
    vec3 disp = gerstner(dirJ, 0.30 * amount * ampVar, 13.0, phase1, p, tangent, binormal);
    disp += gerstner(dir,  0.20 * amount * ampVar, 9.0,  phase2, p, tangent, binormal);
    return disp;
  }
`;

const vertexShader = /* glsl */ `
  uniform float waterLevel;
  uniform float waveScale;    // 1 = mar, menos para laguna
  uniform float openFloor;    // mínimo de 'mar abierto' (la laguna es poco profunda pero tiene viento)
  uniform vec3 camPos;
  uniform sampler2D oceanDisp; // desplazamiento espectral (dx, dy, dz) repetible
  uniform float patchSize;
  uniform float fftScale;      // 1 mar, menos en laguna
  varying vec2 vPatchUv;
  varying float vOpen;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vDepth;
  varying float vConfined;
  #include <fog_pars_vertex>
  ${noiseGLSL}
  ${shoalGLSL}

  void main() {
    vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
    float depth = waterLevel - floorHeight(p.xz);

    // Las olas cortas se desvanecen con la distancia (la rejilla es más gruesa lejos)
    float camDist = distance(p.xz, camPos.xz);
    float near = 1.0 - smoothstep(300.0, 600.0, camDist);
    float mid = 1.0 - smoothstep(900.0, 1800.0, camDist);

    vec2 shoreDir = shoreDirection(p.xz);
    float shoal = smoothstep(12.0, 2.5, depth) * smoothstep(-0.3, 1.0, depth) * near;
    // Agua encajonada (estuario, cauce, caleta estrecha): tierra en casi todas las direcciones a menos de 30 m
    // → las olas apenas entran. Solo se evalúa donde hay olas de orilla.
    float confined = 0.0;
    if (shoal > 0.001) {
      float land = 0.0;
      for (int i = 0; i < 8; i++) {
        float a = float(i) * 0.785398;
        vec2 d = vec2(cos(a), sin(a));
        float h = max(max(floorHeight(p.xz + d * 9.0), floorHeight(p.xz + d * 19.0)), floorHeight(p.xz + d * 30.0));
        land += step(waterLevel + 0.3, h);
      }
      confined = smoothstep(4.5, 6.5, land);
      shoal *= 1.0 - 0.9 * confined;
    }
    vConfined = confined;
    float open = max(smoothstep(4.0, 20.0, depth), openFloor * smoothstep(0.3, 2.0, depth));

    vec3 tangent = vec3(1.0, 0.0, 0.0);
    vec3 binormal = vec3(0.0, 0.0, 1.0);
    vec3 disp = shoalWaves(p, shoreDir, shoal * waveScale, tangent, binormal);

    // Mar abierto: océano espectral (FFT) según el viento; se atenúa hacia la orilla y con la distancia
    vec2 puv = p.xz / patchSize;
    vec3 fft = texture2D(oceanDisp, puv).xyz;
    float fftAmp = open * fftScale * waveScale * mix(0.35, 1.0, mid);
    disp += fft * fftAmp;
    vPatchUv = puv;
    vOpen = fftAmp;

    vec3 wp = p + disp;
    vWorldPos = wp;
    vNormal = normalize(cross(binormal, tangent));
    vDepth = depth;

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
  uniform float flash;
  uniform float dayLight;
  uniform float rain;
  uniform float rainRipple;    // 1: lluvia con anillos (laguna); 0: sin anillos (mar)
  uniform sampler2D oceanNorm; // (-dh/dx, -dh/dz, espuma, h)
  uniform sampler2D reflMap;   // reflejo planar (isla, bosque, cielo)
  uniform mat4 reflMatrix;
  uniform float reflOn;
  uniform float reflDistort; // cuánto deforma el rizado al reflejo
  uniform float reflMix;     // 0 color plano del cielo, 1 reflejo espejado completo
  uniform float reflBlur;    // nivel de mipmap: desenfoque del reflejo
  varying vec2 vPatchUv;
  varying float vOpen;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vDepth;
  varying float vConfined;
  #include <fog_pars_fragment>
  ${noiseGLSL}
  ${cloudGLSL}
  ${rainGLSL}
  ${shadowsGLSL()}

  void main() {
    vec3 n = normalize(vNormal);
    // Normales espectrales por píxel (detalle fino de las olas) y espuma por plegado de crestas
    vec4 on = texture2D(oceanNorm, vPatchUv);
    n = normalize(n + vec3(on.x, 0.0, on.y) * vOpen * 1.2);
    float whitecap = on.z * smoothstep(0.3, 1.0, vOpen);
    float r1 = vnoise(vWorldPos.xz * 0.9 + vec2(time * 0.35, time * 0.2));
    float r2 = vnoise(vWorldPos.xz * 0.9 - vec2(time * 0.25, -time * 0.3));
    n = normalize(n + vec3(r1 - 0.5, 0.0, r2 - 0.5) * 0.10);
    vec3 v = normalize(cameraPosition - vWorldPos);
    // Lluvia sobre la laguna: anillos de impacto con brillo, como en los charcos
    float rainNear = rain * rainRipple * (1.0 - smoothstep(250.0, 600.0, distance(cameraPosition, vWorldPos)));
    float ringSpec = 0.0;
    float ringGlow = 0.0;
    if (rainNear > 0.01) {
      float camDist = distance(cameraPosition, vWorldPos);
      float sizeMul = 1.0 + camDist / 45.0; // anillos más grandes cuanto más lejos, para que se vean
      vec3 rp = rainRipples(vWorldPos.xz, time, rainNear, sizeMul);
      vec3 pn = normalize(vec3(rp.x, 1.0, rp.y));
      n = normalize(n + vec3(rp.x, 0.0, rp.y) * 1.5);
      ringSpec = pow(max(dot(pn, normalize(sunDir + v)), 0.0), 220.0) * 2.0;
      ringGlow = rp.z; // frente del anillo dibujado como línea clara, visible con cualquier luz
    }

    float fresnel = pow(1.0 - max(dot(n, v), 0.0), 3.0);
    float night = mix(0.012, 1.0, dayLight);

    vec2 shadowXZ = vWorldPos.xz + sunDir.xz / max(sunDir.y, 0.05) * (cloudHeight - vWorldPos.y);
    float cloud = smoothstep(0.1, 0.8, cloudDensity(shadowXZ));
    // Sol: nubes y sombras del relieve/bosque (cascadas)
    float sunLight = (1.0 - cloudShadow * cloud) * sunStrength * sunShadow(vWorldPos, n);
    float ambient = (1.0 - 0.35 * cloud) * (0.6 + 0.4 * sunStrength) * night;

    vec3 water = mix(shallowColor, deepColor, smoothstep(0.0, 9.0, vDepth)) * ambient;
    // Reflejo: la isla, el bosque y el cielo espejados; sin textura, el color plano del cielo
    vec3 refl = skyColor * ambient;
    if (reflOn > 0.5) {
      vec4 rc = reflMatrix * vec4(vWorldPos, 1.0);
      vec2 ruv = rc.xy / rc.w + n.xz * reflDistort;
      vec3 tex = texture2D(reflMap, clamp(ruv, 0.001, 0.999), reflBlur).rgb;
      // Las nubes al sol superan 1.0 (HDR): se comprimen para que el reflejo no queme; lejos, donde la
      // textura ya no resuelve nada, se vuelve al color plano del cielo
      tex = tex / (1.0 + tex * 0.6) * 0.9;
      float farMix = smoothstep(350.0, 1200.0, distance(cameraPosition, vWorldPos));
      // reflMix: cuánto del reflejo real entra (el mar solo una parte, para que no quede plástico)
      refl = mix(refl, tex, reflMix * (1.0 - farMix));
    }
    vec3 color = mix(water, refl, fresnel * 0.7);
    color = mix(color, vec3(0.9, 0.95, 1.0) * mix(0.25, 1.0, dayLight), ringGlow * 0.85);

    vec3 hv = normalize(sunDir + v);
    float spec = pow(max(dot(n, hv), 0.0), 180.0) * 1.6 + pow(max(dot(n, hv), 0.0), 24.0) * 0.12;
    color += sunColor * (spec + ringSpec) * sunLight * night;

    float fn = vnoise(vWorldPos.xz * 1.3 + vec2(time * 0.3, -time * 0.2)) * 0.6
             + vnoise(vWorldPos.xz * 3.5 - vec2(time * 0.5, time * 0.4)) * 0.4;
    // En agua encajonada (estuario, caleta) no hay rompiente: solo un hilo de espuma junto a la orilla
    float shoreline = (1.0 - smoothstep(0.0, mix(0.6, 0.2, vConfined), vDepth)) * smoothstep(0.35, 0.6, fn) * waveScale * (1.0 - 0.6 * vConfined);
    // Salpicaduras redondas donde caen gotas (celdas con un punto central)
    float sMul = 1.0 + distance(cameraPosition, vWorldPos) / 45.0;
    vec2 sp = vWorldPos.xz * 2.5 / sMul;
    vec2 sc = floor(sp);
    float sh = vnoise(sc + floor(time * 6.0) * 7.0);
    float sd = length(fract(sp) - 0.5);
    float splash = step(1.0 - rainNear * 0.12, sh) * (1.0 - smoothstep(0.08, 0.16, sd)) * rainNear;
    float foam = clamp(shoreline * 0.8 + splash * 0.5 + whitecap * 0.85, 0.0, 1.0);
    // La espuma es difusa: la ilumina el sol (o su ausencia) y la sombra
    vec3 foamColor = vec3(0.93, 0.96, 1.0) * night * (0.55 + 0.45 * sunLight);
    color = mix(color, foamColor, foam);

    color += vec3(0.8, 0.85, 1.0) * flash * 0.5;
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
  const sim = oceanSimHolder.sim;
  if (sim) { u.oceanDisp.value = sim.displacement; u.oceanNorm.value = sim.normals; }
  u.cloudCoverage.value = weather.params.coverage;
  u.sunStrength.value = sunStrength();
  u.dayLight.value = sunState.day;
  u.rain.value = weather.params.rain;
  u.sunDir.value.copy(sunState.dir);
  u.flash.value = lightning.flash;
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
            openFloor: { value: 0 },
            oceanDisp: { value: null },
            oceanNorm: { value: null },
            patchSize: { value: PATCH },
            fftScale: { value: 1 },
            rainRipple: { value: 0 },
            reflMap: { value: null },
            reflMatrix: { value: new THREE.Matrix4() },
            reflOn: { value: 0 },
            reflDistort: { value: 0.05 },
            reflMix: { value: 0.35 },
            reflBlur: { value: 1.0 },
            camPos: { value: new THREE.Vector3() },
            cloudTime: { value: 0 },
            windDir: { value: new THREE.Vector2(...WIND.dir).normalize() },
            cloudOffset: { value: new THREE.Vector2() },
            cloudCoverage: { value: CLOUD_COVERAGE },
            cloudHeight: { value: CLOUD_HEIGHT },
            cloudShadow: { value: CLOUD_SHADOW },
            sunStrength: { value: 1 },
            flash: { value: 0 },
            dayLight: { value: 1 },
            rain: { value: 0 },
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
  Object.assign(material.uniforms, shadowUniforms);
  return material;
}

function applyReflection(material: THREE.ShaderMaterial, slot: ReflectionSlot) {
  const u = material.uniforms;
  u.reflOn.value = slot.on && slot.texture ? 1 : 0;
  u.reflMap.value = slot.texture;
  u.reflMatrix.value.copy(slot.matrix);
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

  useFrame(({ camera }, dt) => {
    waterClock.t += Math.min(dt, 0.05);
    material.uniforms.time.value = waterClock.t;
    material.uniforms.cloudTime.value = cloudMotion.time;
    material.uniforms.cloudOffset.value.set(cloudMotion.offsetX, cloudMotion.offsetZ);
    material.uniforms.camPos.value.copy(camera.position);
    applyWeather(material, 1);
    applyReflection(material, reflections.sea);

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
  heightmap, sunDir, level, waveScale = 0.45, outline,
}: { heightmap: THREE.DataTexture; sunDir: THREE.Vector3; level: number; waveScale?: number; outline: [number, number][] }) {
  const material = useWaterMaterial(heightmap, sunDir, level, waveScale);
  material.uniforms.openFloor.value = 0.8;
  material.uniforms.fftScale.value = 0.35; // laguna: rizado de viento espectral, sin mar de fondo
  material.uniforms.rainRipple.value = 1;
  material.uniforms.reflDistort.value = 0.03;
  material.uniforms.reflMix.value = 0.7; // laguna quieta: espejo casi completo
  material.uniforms.reflBlur.value = 2.0;
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
    applyReflection(material, reflections.lake);
  });
  return <mesh geometry={geometry} position={[0, level, 0]} material={material} />;
}
