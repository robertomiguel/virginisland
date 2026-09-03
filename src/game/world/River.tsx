'use client';
import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { POOL, RIVER, RIVER_CHANNEL_HALF_WIDTH, RIVER_POOL_S, RIVER_SURFACE_ABOVE_BED, WATERFALL } from '../island';
import { CLOUD_COVERAGE, CLOUD_HEIGHT, CLOUD_SHADOW, DEEP_SEA_FLOOR, ISLAND_SIZE, WATER_LEVEL, WIND } from '../config';
import { shoalGLSL, waterClock } from './Water';
import { shadowUniforms, shadowsGLSL } from './Shadows';
import { cloudGLSL, noiseGLSL, rainGLSL } from './skyGLSL';
import { cloudMotion, lightning, sunState, sunStrength, weather } from '../weather';

const RIBBON_HALF = RIVER_CHANNEL_HALF_WIDTH + 1.2; // se entierra un poco en las orillas
const COLS = 7; // vértices a lo ancho: permite orillas suaves y ondulación por vértice

/**
 * Cinta de agua que sigue el cauce. Atributos: uv = (posición a lo ancho 0..1, metros recorridos),
 * slope = descenso por metro, tangent = dirección de la corriente en XZ.
 * El tramo vertical (la cascada) y la poza los dibuja Waterfall.
 */
function buildRiverGeometry(): THREE.BufferGeometry {
  const n = RIVER.length;
  const positions = new Float32Array(n * COLS * 3);
  const uvs = new Float32Array(n * COLS * 2);
  const slopes = new Float32Array(n * COLS);
  const tangents = new Float32Array(n * COLS * 2);
  const indices: number[] = [];

  const inPool = (i: number) => Math.hypot(RIVER[i].x - POOL.x, RIVER[i].z - POOL.z) < POOL.radius - 0.5;

  for (let i = 0; i < n; i++) {
    const a = RIVER[Math.max(i - 1, 0)];
    const b = RIVER[Math.min(i + 1, n - 1)];
    const p = RIVER[i];
    let tx = b.x - a.x, tz = b.z - a.z;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl; tz /= tl;
    const nx = -tz, nz = tx;
    const y = p.bed + RIVER_SURFACE_ABOVE_BED;
    const ds = Math.max(b.s - a.s, 0.01);
    const slope = (a.bed - b.bed) / ds;

    for (let c = 0; c < COLS; c++) {
      const u = c / (COLS - 1);
      const sgn = u * 2 - 1;
      const k = i * COLS + c;
      positions[k * 3] = p.x + nx * RIBBON_HALF * sgn;
      positions[k * 3 + 1] = y;
      positions[k * 3 + 2] = p.z + nz * RIBBON_HALF * sgn;
      uvs[k * 2] = u;
      uvs[k * 2 + 1] = p.s;
      slopes[k] = slope;
      tangents[k * 2] = tx;
      tangents[k * 2 + 1] = tz;
    }
    if (i < n - 1) {
      const segSlope = (RIVER[i].bed - RIVER[i + 1].bed) / Math.max(RIVER[i + 1].s - RIVER[i].s, 0.01);
      const underSea = RIVER[i].bed + RIVER_SURFACE_ABOVE_BED < WATER_LEVEL - 0.6; // ahí la lámina la pone el mar
      const pool = inPool(i) && inPool(i + 1); // ahí la lámina la pone el disco de la poza
      if (segSlope < 1.5 && !underSea && !pool) {
        for (let c = 0; c < COLS - 1; c++) {
          const k = i * COLS + c;
          indices.push(k, k + 1, k + COLS, k + 1, k + COLS + 1, k + COLS);
        }
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('slope', new THREE.BufferAttribute(slopes, 1));
  geo.setAttribute('tangent2', new THREE.BufferAttribute(tangents, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Disco de agua de la poza al pie de la cascada, con los mismos atributos que la cinta. */
function buildPoolGeometry(): THREE.BufferGeometry {
  const geo = new THREE.CircleGeometry(POOL.radius + 0.5, 48);
  geo.rotateX(-Math.PI / 2);
  geo.translate(POOL.x, WATERFALL.poolY, POOL.z);
  const count = geo.attributes.position.count;
  const uvs = new Float32Array(count * 2);
  const slopes = new Float32Array(count);
  const tangents = new Float32Array(count * 2);
  const pos = geo.attributes.position;
  const R = POOL.radius + 0.5;
  for (let i = 0; i < count; i++) {
    // uv.x radial: el centro es 0.5 y el borde 1.0, así la orilla se funde como en la cinta
    const r = Math.hypot(pos.getX(i) - POOL.x, pos.getZ(i) - POOL.z) / R;
    uvs[i * 2] = 0.5 + 0.5 * Math.min(r, 1);
    uvs[i * 2 + 1] = RIVER_POOL_S;
    tangents[i * 2] = WATERFALL.dirX;
    tangents[i * 2 + 1] = WATERFALL.dirZ;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('slope', new THREE.BufferAttribute(slopes, 1));
  geo.setAttribute('tangent2', new THREE.BufferAttribute(tangents, 2));
  return geo;
}

const vertexShader = /* glsl */ `
  uniform float seaLevel;
  uniform float waveScale;
  attribute float slope;
  attribute vec2 tangent2;
  varying vec2 vUv;
  varying float vSlope;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec3 vTangent;
  varying float vBaseY;   // altura de la lámina sin olas
  #include <fog_pars_vertex>
  ${noiseGLSL}
  ${shoalGLSL}
  void main() {
    vUv = uv;
    vSlope = slope;
    vBaseY = position.y;
    vTangent = normalize(vec3(tangent2.x, 0.0, tangent2.y));
    float steep = smoothstep(0.03, 0.5, slope);
    // Ondulación de la lámina: pequeña en remanso, marcada en los rápidos
    float speed = 0.8 + steep * 4.0;
    float bob = vnoise(vec2(uv.x * 3.0, uv.y * 0.5 - time * speed * 0.5)) - 0.5;
    vec3 p = position;
    p.y += bob * (0.04 + steep * 0.12);

    // Desembocadura: las olas de orilla del mar entran en el cauce contra la corriente y se apagan río arriba
    float mouth = 1.0 - smoothstep(seaLevel + 0.4, seaLevel + 3.5, position.y);
    vec3 tangent = vec3(1.0, 0.0, 0.0);
    vec3 binormal = vec3(0.0, 0.0, 1.0);
    if (mouth > 0.001) {
      float near = 1.0 - smoothstep(300.0, 600.0, distance(position.xz, cameraPosition.xz));
      // Donde el mar ya cubre el cauce, la ola es la misma que la suya (misma dirección, fase y reloj);
      // río arriba avanza contra la corriente.
      float overlap = 1.0 - smoothstep(seaLevel + 0.2, seaLevel + 1.2, position.y);
      vec2 dir = normalize(mix(-tangent2, shoreDirection(position.xz), overlap));
      vec3 disp = shoalWaves(position, dir, mouth * near * waveScale * 0.15, tangent, binormal);
      p += disp;
    }
    vec4 worldPos = modelMatrix * vec4(p, 1.0);
    vWorldPos = worldPos.xyz;
    vec3 waveN = cross(binormal, tangent) - vec3(0.0, 1.0, 0.0);
    vNormal = normalize(mat3(modelMatrix) * normal + waveN);
    vec4 mvPosition = viewMatrix * worldPos;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  uniform float time;
  uniform vec3 sunDir;
  uniform vec3 sunColor;
  uniform vec3 bodyColor;     // color del agua vista a través (lecho oscuro y verdoso)
  uniform vec3 shallowColor;  // tono somero, como el del mar en la orilla
  uniform vec3 skyColor;
  uniform float seaLevel;
  uniform float dayLight;
  uniform float sunStrength;
  uniform float cloudHeight;
  uniform float cloudShadow;
  uniform float rain;
  uniform float flash;
  uniform float poolS;        // metros de cauce donde está la poza: aguas abajo arrastra espuma
  uniform float ribbonWidth;  // ancho de la cinta en metros
  varying vec2 vUv;
  varying float vSlope;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec3 vTangent;
  varying float vBaseY;
  #include <fog_pars_fragment>
  ${noiseGLSL}
  ${cloudGLSL}
  ${rainGLSL}
  ${shadowsGLSL()}

  // Altura de la superficie en el espacio del flujo q = (metros a lo ancho, metros recorridos).
  // Tres capas arrastradas por la corriente, alargadas en el sentido del flujo.
  float surface(vec2 q, float t) {
    float h = vnoise(q * vec2(0.9, 0.30) - vec2(0.0, t)) * 0.5;
    h += vnoise(q * vec2(2.2, 0.8) + vec2(3.1, -t * 1.3)) * 0.3;
    h += vnoise(q * vec2(5.0, 2.4) + vec2(7.0, -t * 1.7)) * 0.2;
    return h;
  }

  void main() {
    float steep = smoothstep(0.03, 0.5, vSlope);
    float speed = 0.8 + steep * 4.0;
    vec2 q = vec2(vUv.x * ribbonWidth, vUv.y);
    float t = time * speed;

    // Normal por diferencias finitas de la altura del rizado (en el marco tangente del cauce)
    float e = 0.12;
    float h0 = surface(q, t);
    float hu = surface(q + vec2(e, 0.0), t);
    float hs = surface(q + vec2(0.0, e), t);
    float amp = 0.18 + steep * 0.3;
    vec3 N = normalize(vNormal);
    vec3 T = normalize(vTangent - N * dot(vTangent, N));
    vec3 B = cross(N, T);
    vec3 n = normalize(N - T * ((hs - h0) / e) * amp - B * ((hu - h0) / e) * amp);

    vec3 v = normalize(cameraPosition - vWorldPos);
    float camDist = distance(cameraPosition, vWorldPos);

    // Lluvia: anillos de impacto como en la laguna
    float rainNear = rain * (1.0 - smoothstep(200.0, 500.0, camDist));
    float ringSpec = 0.0, ringGlow = 0.0;
    if (rainNear > 0.01) {
      float sizeMul = 1.0 + camDist / 45.0;
      vec3 rp = rainRipples(vWorldPos.xz, time, rainNear, sizeMul);
      vec3 pn = normalize(vec3(rp.x, 1.0, rp.y));
      n = normalize(n + vec3(rp.x, 0.0, rp.y) * 1.2);
      ringSpec = pow(max(dot(pn, normalize(sunDir + v)), 0.0), 220.0) * 2.0;
      ringGlow = rp.z;
    }

    // Reflejo del cielo según el ángulo (Schlick) sobre el agua vista a través
    float NdV = max(dot(n, v), 0.0);
    float fresnel = 0.03 + 0.97 * pow(1.0 - NdV, 5.0);
    // Cerca de la desembocadura el agua se aclara al tono somero del mar
    float mouth = 1.0 - smoothstep(seaLevel + 0.5, seaLevel + 6.0, vWorldPos.y);
    vec3 body = mix(bodyColor, shallowColor, 0.12 + 0.6 * mouth);
    vec3 color = mix(body, skyColor, fresnel);
    color = mix(color, vec3(0.9, 0.95, 1.0) * mix(0.25, 1.0, dayLight), ringGlow * 0.85);

    // Sombra de nubes y sol, igual que el mar
    vec2 shadowXZ = vWorldPos.xz + sunDir.xz / max(sunDir.y, 0.05) * (cloudHeight - vWorldPos.y);
    float cloud = smoothstep(0.1, 0.8, cloudDensity(shadowXZ));
    float sunLight = (1.0 - cloudShadow * cloud) * sunStrength * sunShadow(vWorldPos, n);
    color *= (1.0 - 0.35 * cloud) * (0.6 + 0.4 * sunStrength);

    vec3 hv = normalize(sunDir + v);
    float spec = pow(max(dot(n, hv), 0.0), 160.0) * 1.5 + pow(max(dot(n, hv), 0.0), 20.0) * 0.12;
    color += sunColor * (spec + ringSpec) * sunLight;

    // Espuma: vetas arrastradas por la corriente
    float streak = vnoise(q * vec2(1.6, 0.4) - vec2(0.0, t * 1.1)) * 0.55
                 + vnoise(q * vec2(4.0, 1.1) + vec2(5.0, -t * 1.5)) * 0.45;
    float bank = smoothstep(0.62, 0.95, abs(vUv.x - 0.5) * 2.0);
    // Rápidos: cuanta más pendiente, más agua blanca, con huecos oscuros entre vetas
    float rapids = steep * smoothstep(0.42 - steep * 0.15, 0.68, streak);
    // Aguas abajo de la poza: la espuma de la cascada se va disolviendo
    float carried = exp(-max(vUv.y - poolS, 0.0) / 12.0) * step(poolS - 0.5, vUv.y);
    float poolFoam = carried * smoothstep(0.6, 0.85, streak + bank * 0.15) * 0.6;
    // Orillas: hilos finos de espuma pegados a la orilla
    float bankFoam = bank * 0.35 * smoothstep(0.55, 0.8, vnoise(q * vec2(3.0, 0.5) - vec2(0.0, t * 0.8)));
    // Salpicaduras de lluvia
    float sMul = 1.0 + camDist / 45.0;
    vec2 sp = vWorldPos.xz * 2.5 / sMul;
    float sh = vnoise(floor(sp) + floor(time * 6.0) * 7.0);
    float sd = length(fract(sp) - 0.5);
    float splash = step(1.0 - rainNear * 0.12, sh) * (1.0 - smoothstep(0.08, 0.16, sd)) * rainNear;
    float foam = clamp(rapids + poolFoam + bankFoam + splash * 0.5, 0.0, 1.0);
    // La espuma es difusa: la ilumina el sol y la sombra de las nubes
    vec3 foamColor = vec3(0.93, 0.96, 1.0) * (0.5 + 0.5 * sunLight * (0.6 + 0.4 * max(dot(n, sunDir), 0.0)));
    color = mix(color, foamColor, foam);

    color *= mix(0.012, 1.0, dayLight);
    color += vec3(0.8, 0.85, 1.0) * flash * 0.5;

    // Transparencia: el lecho se ve a través en los remansos; el reflejo rasante y la espuma lo tapan
    float alpha = mix(0.72, 0.95, fresnel);
    alpha = max(alpha, foam);
    // Orillas suaves: la cinta se funde con la ribera en vez de cortarla
    alpha *= 1.0 - smoothstep(0.78, 1.0, abs(vUv.x - 0.5) * 2.0);
    // Desembocadura: la cinta cede el sitio al mar en cuanto el lecho baja de su nivel
    alpha *= smoothstep(seaLevel + 0.1, seaLevel + 1.0, vBaseY);
    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export function River({ sunDir, heightmap }: { sunDir: THREE.Vector3; heightmap: THREE.DataTexture }) {
  const geometry = useMemo(buildRiverGeometry, []);
  const pool = useMemo(buildPoolGeometry, []);
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
            sunDir: { value: sunDir.clone() },
            sunColor: { value: new THREE.Color('#fff4dc') },
            bodyColor: { value: new THREE.Color('#0f3a3c') },
            shallowColor: { value: new THREE.Color('#2fa4b8') },
            skyColor: { value: new THREE.Color('#a9cfee') },
            seaLevel: { value: WATER_LEVEL },
            dayLight: { value: 1 },
            sunStrength: { value: 1 },
            cloudTime: { value: 0 },
            cloudOffset: { value: new THREE.Vector2() },
            cloudCoverage: { value: CLOUD_COVERAGE },
            cloudHeight: { value: CLOUD_HEIGHT },
            cloudShadow: { value: CLOUD_SHADOW },
            rain: { value: 0 },
            flash: { value: 0 },
            poolS: { value: RIVER_POOL_S },
            ribbonWidth: { value: RIBBON_HALF * 2 },
            waveScale: { value: 1 },
            heightmap: { value: null },
            mapSize: { value: ISLAND_SIZE },
            deepFloor: { value: DEEP_SEA_FLOOR },
            windDir: { value: new THREE.Vector2(...WIND.dir).normalize() },
          },
        ]),
      }),
    [sunDir],
  );

  material.uniforms.heightmap.value = heightmap;
  Object.assign(material.uniforms, shadowUniforms);

  useFrame(() => {
    const u = material.uniforms;
    u.time.value = waterClock.t; // mismo reloj que el mar: la ola que entra por la desembocadura es la misma
    u.waveScale.value = weather.params.waves;
    u.sunDir.value.copy(sunState.dir);
    u.dayLight.value = sunState.day;
    u.sunStrength.value = sunStrength();
    u.cloudTime.value = cloudMotion.time;
    u.cloudOffset.value.set(cloudMotion.offsetX, cloudMotion.offsetZ);
    u.cloudCoverage.value = weather.params.coverage;
    u.rain.value = weather.params.rain;
    u.flash.value = lightning.flash;
  });

  return (
    <group>
      <mesh geometry={geometry} material={material} renderOrder={1} />
      <mesh geometry={pool} material={material} renderOrder={1} />
    </group>
  );
}
