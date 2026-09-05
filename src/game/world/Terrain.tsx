'use client';
import { useMemo } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { HEIGHTMAP_SIZE, ISLAND_SIZE, TERRAIN_SEGMENTS, lowQuality } from '../config';
import { localWaterLevel, terrainHeight } from '../terrain';
import type { Placed } from '../vegetation';
import { CLOUD_COVERAGE, CLOUD_HEIGHT, CLOUD_SHADOW, WIND } from '../config';
import { cloudGLSL, noiseGLSL, rainGLSL } from './skyGLSL';
import { shadowUniforms, shadowsGLSL } from './Shadows';
import { REFLECT_MASK } from './Reflection';
import { cloudMotion, lightning, sunState, sunStrength, weather } from '../weather';

function buildTerrainGeometry(): THREE.BufferGeometry {
  const segs = lowQuality() ? Math.round(TERRAIN_SEGMENTS / 4) : TERRAIN_SEGMENTS;
  const geo = new THREE.PlaneGeometry(ISLAND_SIZE, ISLAND_SIZE, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Mapa RGBA (half float) que cubre el plano de terreno:
 *  R = altura del terreno, G = nivel local del agua (mar, río o laguna), B = densidad de copas (bosque).
 * Lo usan el agua (profundidad/orilla) y el terreno (arena, fondo sumergido, suelo de bosque).
 */
export function buildHeightmap(trees: Placed[] = []): THREE.DataTexture {
  const n = HEIGHTMAP_SIZE;
  const data = new Uint16Array(n * n * 4);
  const canopy = new Float32Array(n * n);
  const px = ISLAND_SIZE / (n - 1);
  for (const t of trees) {
    const radius = (t.kind === 0 ? 7.5 : 5.5) * t.scale;
    const ci = (t.x / ISLAND_SIZE + 0.5) * (n - 1), cj = (t.z / ISLAND_SIZE + 0.5) * (n - 1);
    const rp = radius / px;
    for (let j = Math.max(0, Math.floor(cj - rp)); j <= Math.min(n - 1, Math.ceil(cj + rp)); j++) {
      for (let i = Math.max(0, Math.floor(ci - rp)); i <= Math.min(n - 1, Math.ceil(ci + rp)); i++) {
        const d = Math.hypot(i - ci, j - cj) / rp;
        if (d < 1) canopy[j * n + i] += (1 - d * d) * 0.7;
      }
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1) - 0.5) * ISLAND_SIZE;
      const z = (j / (n - 1) - 0.5) * ISLAND_SIZE;
      const k = (j * n + i) * 4;
      data[k] = THREE.DataUtils.toHalfFloat(terrainHeight(x, z));
      data[k + 1] = THREE.DataUtils.toHalfFloat(localWaterLevel(x, z));
      data[k + 2] = THREE.DataUtils.toHalfFloat(Math.min(1, canopy[j * n + i]));
      data[k + 3] = THREE.DataUtils.toHalfFloat(1);
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

const TEXTURE_FILES = [
  '/textures/aerial_beach_01_diff.jpg',
  '/textures/aerial_beach_01_nor.jpg',
  '/textures/aerial_grass_rock_diff.jpg',
  '/textures/aerial_grass_rock_nor.jpg',
  '/textures/rock_face_diff.jpg',
  '/textures/rock_face_nor.jpg',
  '/textures/forest_floor_diff.jpg',
  '/textures/forest_floor_nor.jpg',
  '/textures/forrest_ground_01_diff.jpg',
  '/textures/forrest_ground_01_nor.jpg',
];

const vertexShader = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  #include <fog_pars_vertex>
  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 mvPosition = viewMatrix * worldPos;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D sandMap, sandNor, grassMap, grassNor, rockMap, rockNor, floorMap, floorNor, wildMap, wildNor;
  uniform sampler2D heightmap;
  uniform float islandSize;
  uniform vec3 sunDir;
  uniform vec3 sunColor;
  uniform vec3 skyColor;
  uniform vec3 groundColor;
  uniform float cloudHeight;
  uniform float cloudShadow;
  uniform float sunStrength;
  uniform float flash;
  uniform float wet;
  uniform float dayLight;
  uniform float rainTime;
  uniform vec3 skyReflect;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  #include <fog_pars_fragment>
  ${noiseGLSL}
  ${cloudGLSL}
  ${rainGLSL}
  ${shadowsGLSL()}

  // Dos escalas mezcladas y una rotación para romper el mosaico de la textura
  vec3 sampleTop(sampler2D map, float scale) {
    vec2 uv = vWorldPos.xz * scale;
    vec2 uv2 = mat2(0.8, -0.6, 0.6, 0.8) * vWorldPos.xz * scale * 0.23;
    return mix(texture2D(map, uv).rgb, texture2D(map, uv2).rgb, 0.5);
  }
  /**
   * Lo mismo para un mapa de normales, pero SUMANDO las pendientes en vez de promediar los dos
   * téxeles: dos normales de sitios distintos apuntan a lados distintos y su media tiende a la
   * normal plana, que es lo que dejaba el suelo sin relieve. Devuelve la normal ya descodificada.
   */
  vec3 sampleTopNor(sampler2D map, float scale) {
    vec2 uv = vWorldPos.xz * scale;
    vec2 uv2 = mat2(0.8, -0.6, 0.6, 0.8) * vWorldPos.xz * scale * 0.23;
    vec3 a = texture2D(map, uv).rgb * 2.0 - 1.0;
    vec3 b = texture2D(map, uv2).rgb * 2.0 - 1.0;
    return normalize(vec3(a.xy + b.xy * 0.5, a.z * b.z));
  }
  vec3 sampleTri(sampler2D map, float scale, vec3 n) {
    vec3 w = pow(abs(n), vec3(4.0));
    w /= (w.x + w.y + w.z);
    vec3 x = texture2D(map, vWorldPos.zy * scale).rgb;
    vec3 y = texture2D(map, vWorldPos.xz * scale).rgb;
    vec3 z = texture2D(map, vWorldPos.xy * scale).rgb;
    return x * w.x + y * w.y + z * w.z;
  }

  void main() {
    vec3 n = normalize(vNormal);
    float h = vWorldPos.y;
    vec4 hm = texture2D(heightmap, vWorldPos.xz / islandSize + 0.5);
    float waterLevel = hm.g;
    float forest = hm.b; // densidad de copas 0..1
    float slope = 1.0 - n.y;

    // Ruido multi-octava para que las fronteras entre materiales sean orgánicas (no siguen la rejilla)
    float bn = (vnoise(vWorldPos.xz * 0.07) - 0.5) * 3.2
             + (vnoise(vWorldPos.xz * 0.3 + 11.0) - 0.5) * 1.4
             + (vnoise(vWorldPos.xz * 1.1 + 23.0) - 0.5) * 0.5;

    float sandScale = 1.0 / 6.0, grassScale = 1.0 / 7.0, rockScale = 1.0 / 11.0, floorScale = 1.0 / 5.0, wildScale = 1.0 / 6.0;
    vec3 sandC = sampleTop(sandMap, sandScale);
    vec3 rockC = sampleTri(rockMap, rockScale, n);
    // Hierba: mezcla de pradera y monte bajo (hierba seca, ramitas) en parches grandes → nada de césped uniforme
    float wildMix = smoothstep(0.35, 0.7, vnoise(vWorldPos.xz * 0.045 + 3.0) * 0.7 + vnoise(vWorldPos.xz * 0.2 + 9.0) * 0.3);
    vec3 grassC = mix(sampleTop(grassMap, grassScale), sampleTop(wildMap, wildScale), wildMix);
    // Bajo las copas: hojarasca, tierra y raíces
    float litter = smoothstep(0.18, 0.6, forest + bn * 0.08 + (vnoise(vWorldPos.xz * 0.12 + 21.0) - 0.5) * 0.25);
    vec3 floorC = sampleTop(floorMap, floorScale);
    grassC = mix(grassC, floorC, litter);

    float sandW = (1.0 - smoothstep(waterLevel + 0.6, waterLevel + 4.5, h + bn)) * (1.0 - smoothstep(0.18, 0.4, slope + bn * 0.05));
    float rockW = max(smoothstep(0.26, 0.5, slope + bn * 0.06), smoothstep(46.0, 62.0, h + bn * 3.0));
    float grassW = clamp(1.0 - sandW - rockW, 0.0, 1.0);

    // Mezcla por relieve: el material "más alto" según su propia textura gana en la frontera
    float k = 0.35;
    float sB = sandW + (dot(sandC, vec3(0.333)) - 0.5) * k;
    float gB = grassW + (dot(grassC, vec3(0.333)) - 0.5) * k;
    float rB = rockW + (dot(rockC, vec3(0.333)) - 0.5) * k;
    float m = max(sB, max(gB, rB)) - 0.22;
    sandW = max(sB - m, 0.0); grassW = max(gB - m, 0.0); rockW = max(rB - m, 0.0);
    float total = sandW + grassW + rockW;
    sandW /= total; grassW /= total; rockW /= total;

    vec3 albedo = sandC * sandW + grassC * grassW + rockC * rockW;
    float blendNoise = bn * 0.4;

    // Variación de color a gran escala (parches más secos / más verdes)
    float macro = vnoise(vWorldPos.xz * 0.02 + 5.0);
    albedo *= mix(vec3(0.85, 0.82, 0.7), vec3(1.05, 1.1, 0.95), macro);

    // Nieve en la cumbre (solo en zonas poco inclinadas)
    float snow = smoothstep(72.0, 84.0, h + blendNoise * 4.0) * (1.0 - smoothstep(0.3, 0.55, slope));
    albedo = mix(albedo, vec3(0.93, 0.95, 0.98), snow);

    vec3 grassN = mix(mix(sampleTopNor(grassNor, grassScale), sampleTopNor(wildNor, wildScale), wildMix), sampleTopNor(floorNor, floorScale), litter);
    vec3 nt = sampleTopNor(sandNor, sandScale) * sandW
            + grassN * grassW
            + (sampleTri(rockNor, rockScale, n) * 2.0 - 1.0) * rockW;
    vec3 shadedN = normalize(n + vec3(nt.x, 0.0, -nt.y) * 1.1 * (1.0 - snow));
    // Oclusión de las hondonadas de la textura: lo que el mapa de normales hunde, se oscurece.
    float cavity = 1.0 - 0.35 * clamp(length(nt.xy) * 1.6, 0.0, 1.0) * (1.0 - snow);

    float diff = max(dot(shadedN, sunDir), 0.0);
    // Sombra de las nubes: se proyecta desde la capa de nubes siguiendo la dirección del sol
    vec2 shadowXZ = vWorldPos.xz + sunDir.xz / max(sunDir.y, 0.05) * (cloudHeight - vWorldPos.y);
    float cloud = cloudDensity(shadowXZ);
    // Sombras del relieve y del bosque (mapas en cascada) además de las nubes
    float sunLight = (1.0 - cloudShadow * smoothstep(0.1, 0.8, cloud)) * sunStrength * sunShadow(vWorldPos, n);
    vec3 hemi = mix(groundColor, skyColor, shadedN.y * 0.5 + 0.5);
    // Sombra difusa de las copas: el sotobosque es más oscuro
    float canopyShade = 1.0 - 0.25 * smoothstep(0.1, 0.9, forest);
    // Suelo mojado: más oscuro, saturado y con brillo especular
    albedo *= 1.0 - 0.45 * wet;
    vec3 color = albedo * cavity * (sunColor * diff * sunLight * canopyShade + hemi * (1.0 - 0.25 * cloud) * (0.55 + 0.45 * sunStrength) * (0.7 + 0.3 * canopyShade) * mix(0.015, 1.0, dayLight));
    vec3 v = normalize(cameraPosition - vWorldPos);
    vec3 hv = normalize(sunDir + v);
    color += sunColor * pow(max(dot(shadedN, hv), 0.0), 40.0) * 0.35 * wet * sunLight;

    // Charcos en zonas llanas: reflejan el cielo y reciben las ondas de la lluvia
    float puddle = wet * (1.0 - smoothstep(0.02, 0.10, slope)) * smoothstep(0.52, 0.72, vnoise(vWorldPos.xz * 0.22 + 41.0)) * (1.0 - sandW) * (1.0 - rockW);
    if (puddle > 0.01) {
      float rainNear = wet * (1.0 - smoothstep(120.0, 300.0, distance(cameraPosition, vWorldPos)));
      vec3 rp = rainRipples(vWorldPos.xz, rainTime, rainNear, 1.0 + distance(cameraPosition, vWorldPos) / 45.0);
      vec3 pn = normalize(vec3(rp.x, 1.0, rp.y) + n * 0.2);
      float fres = pow(1.0 - max(dot(pn, v), 0.0), 3.0);
      vec3 hp = normalize(sunDir + v);
      float pspec = pow(max(dot(pn, hp), 0.0), 220.0) * 2.0 * sunLight;
      vec3 puddleColor = mix(albedo * 0.35, skyReflect * mix(0.15, 1.0, dayLight), 0.35 + 0.55 * fres) + sunColor * pspec + vec3(0.9, 0.95, 1.0) * rp.z * 0.7 * mix(0.15, 1.0, dayLight);
      color = mix(color, puddleColor, puddle * 0.85);
    }
    // Relámpago: luz blanca desde arriba
    color += albedo * flash * (1.2 + 0.8 * max(shadedN.y, 0.0));

    // Fondo sumergido (mar, río o laguna): más oscuro y azulado
    float under = 1.0 - smoothstep(waterLevel - 3.0, waterLevel + 0.15, h);
    color = mix(color, color * vec3(0.35, 0.5, 0.55), under * 0.75);

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export function Terrain({ sunDir, heightmap }: { sunDir: THREE.Vector3; heightmap: THREE.DataTexture }) {
  const geometry = useMemo(buildTerrainGeometry, []);
  const [sandMap, sandNor, grassMap, grassNor, rockMap, rockNor, floorMap, floorNor, wildMap, wildNor] = useLoader(THREE.TextureLoader, TEXTURE_FILES);

  const material = useMemo(() => {
    const maps = [sandMap, sandNor, grassMap, grassNor, rockMap, rockNor, floorMap, floorNor, wildMap, wildNor];
    for (const t of maps) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
    }
    sandMap.colorSpace = grassMap.colorSpace = rockMap.colorSpace = floorMap.colorSpace = wildMap.colorSpace = THREE.SRGBColorSpace;
    return new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          sandMap: { value: null }, sandNor: { value: null },
          grassMap: { value: null }, grassNor: { value: null },
          rockMap: { value: null }, rockNor: { value: null },
          floorMap: { value: null }, floorNor: { value: null },
          wildMap: { value: null }, wildNor: { value: null },
          heightmap: { value: null },
          islandSize: { value: ISLAND_SIZE },
          cloudTime: { value: 0 },
          windDir: { value: new THREE.Vector2(...WIND.dir).normalize() },
          cloudOffset: { value: new THREE.Vector2() },
          cloudCoverage: { value: CLOUD_COVERAGE },
          cloudHeight: { value: CLOUD_HEIGHT },
          cloudShadow: { value: CLOUD_SHADOW },
          sunStrength: { value: 1 },
          flash: { value: 0 },
          wet: { value: 0 },
          dayLight: { value: 1 },
          rainTime: { value: 0 },
          skyReflect: { value: new THREE.Color('#9fbfdc') },
          sunDir: { value: sunDir.clone() },
          sunColor: { value: new THREE.Color('#fff2d6').multiplyScalar(1.6) },
          skyColor: { value: new THREE.Color('#9ec3e6').multiplyScalar(0.55) },
          groundColor: { value: new THREE.Color('#5a5340').multiplyScalar(0.35) },
        },
      ]),
    });
  }, [sandMap, sandNor, grassMap, grassNor, rockMap, rockNor, floorMap, floorNor, wildMap, wildNor, sunDir]);

  // UniformsUtils.merge clona valores; asignamos las texturas después.
  material.uniforms.sandMap.value = sandMap;
  material.uniforms.sandNor.value = sandNor;
  material.uniforms.grassMap.value = grassMap;
  material.uniforms.grassNor.value = grassNor;
  material.uniforms.rockMap.value = rockMap;
  material.uniforms.rockNor.value = rockNor;
  material.uniforms.floorMap.value = floorMap;
  material.uniforms.floorNor.value = floorNor;
  material.uniforms.wildMap.value = wildMap;
  material.uniforms.wildNor.value = wildNor;
  material.uniforms.heightmap.value = heightmap;
  Object.assign(material.uniforms, shadowUniforms);

  useFrame(({ clock }, dt) => {
    material.uniforms.rainTime.value += Math.min(dt, 0.05);
    material.uniforms.skyReflect.value.copy(sunState.horizon);
    material.uniforms.cloudTime.value = cloudMotion.time;
    material.uniforms.cloudOffset.value.set(cloudMotion.offsetX, cloudMotion.offsetZ);
    material.uniforms.cloudCoverage.value = weather.params.coverage;
    material.uniforms.sunStrength.value = sunStrength();
    material.uniforms.dayLight.value = sunState.day;
    material.uniforms.sunDir.value.copy(sunState.dir);
    material.uniforms.sunColor.value.copy(sunState.color).multiplyScalar(1.6);
    material.uniforms.flash.value = lightning.flash;
    material.uniforms.wet.value = Math.min(1, weather.params.rain * 1.4);
  });

  return <mesh geometry={geometry} material={material} castShadow layers-mask={REFLECT_MASK} />;
}
