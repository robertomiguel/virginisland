'use client';
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import { lightning, sunState, sunStrength } from '../weather';
import { lowQuality } from '../config';

/*
 * Sombras del sol en cascada (CSM): tres mapas de sombra que siguen a la cámara, fino cerca y
 * grueso lejos, hasta SHADOW_FAR metros. Los materiales estándar (árboles, rocas, flora, pasto)
 * los usa el propio CSM; los shaders propios (terreno, mar, río) muestrean las cascadas con
 * `shadowsGLSL` y los uniforms compartidos de `shadowUniforms`.
 *
 * Los mapas solo se vuelven a dibujar cuando cambia la cámara o el sol (no cada fotograma).
 */

export const CASCADES = 3;
export const SHADOW_FAR = 700;      // hasta dónde llegan las sombras (m)
export const SHADOW_MAP_SIZE = 2048;

/** ?sinsombras en la URL las apaga (para comparar rendimiento). */
export function shadowsEnabled(): boolean {
  return !lowQuality() && !(typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('sinsombras'));
}

/** Uniforms compartidos por todos los shaders propios (mismo objeto → se actualizan solos). */
export const shadowUniforms = {
  // null hasta que existan los mapas: three pone su propia textura de sombra vacía
  csmMap0: { value: null as THREE.Texture | null },
  csmMap1: { value: null as THREE.Texture | null },
  csmMap2: { value: null as THREE.Texture | null },
  csmMatrix: { value: [new THREE.Matrix4(), new THREE.Matrix4(), new THREE.Matrix4()] },
  csmSplit: { value: [0, 0, 0] },        // profundidad (fracción de csmFar) donde empieza cada cascada
  csmTexel: { value: [1, 1, 1] },        // metros por téxel de cada cascada
  csmFar: { value: SHADOW_FAR },
  csmMapSize: { value: SHADOW_MAP_SIZE },
  csmOn: { value: 0 },
  csmLightDir: { value: new THREE.Vector3(0, 1, 0) },
};

/** GLSL: `sunShadow(worldPos, normal)` devuelve 0 a la sombra y 1 al sol. Requiere viewMatrix. */
const shadowsGLSLFull = /* glsl */ `
  uniform sampler2DShadow csmMap0;
  uniform sampler2DShadow csmMap1;
  uniform sampler2DShadow csmMap2;
  uniform mat4 csmMatrix[3];
  uniform float csmSplit[3];
  uniform float csmTexel[3];
  uniform float csmFar;
  uniform float csmMapSize;
  uniform float csmOn;
  uniform vec3 csmLightDir;

  float csmNoise(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
  vec2 csmVogel(int k, float phi) {
    float r = sqrt((float(k) + 0.5) / 5.0);
    float th = float(k) * 2.399963 + phi;
    return vec2(cos(th), sin(th)) * r;
  }
  float csmTap(int i, vec3 c) {
    if (i == 0) return texture(csmMap0, c);
    if (i == 1) return texture(csmMap1, c);
    return texture(csmMap2, c);
  }
  float csmSample(int i, vec3 wp) {
    vec4 c = csmMatrix[i] * vec4(wp, 1.0);
    c.xyz /= c.w;
    if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0) return 1.0;
    float phi = csmNoise(gl_FragCoord.xy) * 6.28318;
    float r = 1.5 / csmMapSize;
    float s = 0.0;
    for (int k = 0; k < 5; k++) s += csmTap(i, vec3(c.xy + csmVogel(k, phi) * r, c.z));
    return s * 0.2;
  }
  float sunShadow(vec3 wp, vec3 n) {
    if (csmOn < 0.5) return 1.0;
    float depth = -(viewMatrix * vec4(wp, 1.0)).z / csmFar;
    if (depth > 1.0) return 1.0;
    int i = depth < csmSplit[1] ? 0 : (depth < csmSplit[2] ? 1 : 2);
    // Desplazamiento por normal y hacia el sol: evita el acné sin despegar la sombra
    vec3 p = wp + n * csmTexel[i] * 1.6 + csmLightDir * csmTexel[i] * 0.8;
    float s = csmSample(i, p);
    // Fundido con la cascada siguiente cerca del corte, para que no se note el cambio de resolución
    if (i < 2) {
      float edge = csmSplit[i + 1];
      float w = smoothstep(edge * 0.85, edge, depth);
      if (w > 0.0) {
        vec3 p2 = wp + n * csmTexel[i + 1] * 1.6 + csmLightDir * csmTexel[i + 1] * 0.8;
        s = mix(s, csmSample(i + 1, p2), w);
      }
    }
    return s;
  }
`;

/** Sin sombras (?low, ?sinsombras) no se declaran los muestreadores: three no puede enlazar uno vacío. */
export function shadowsGLSL(): string {
  return shadowsEnabled() ? shadowsGLSLFull : /* glsl */ `float sunShadow(vec3 wp, vec3 n) { return 1.0; }`;
}

// --- Materiales estándar: hay que enseñarles las cascadas (si no, los tres soles los iluminan por triplicado)
const registry = { csm: null as CSM | null, pending: new Set<THREE.Material>(), done: new WeakSet<THREE.Material>() };

function applyCsm(mat: THREE.Material) {
  const csm = registry.csm!;
  const ownPrev = Object.prototype.hasOwnProperty.call(mat, 'onBeforeCompile') ? mat.onBeforeCompile : null;
  csm.setupMaterial(mat);
  if (ownPrev) {
    // Encadena con el vaivén del viento u otras modificaciones del shader
    const csmCb = mat.onBeforeCompile;
    mat.onBeforeCompile = (shader, renderer) => { csmCb.call(mat, shader, renderer); ownPrev.call(mat, shader, renderer); };
  }
  mat.needsUpdate = true;
  registry.done.add(mat);
}

/** Registra un material estándar para que reciba las sombras en cascada. Idempotente. */
export function registerStandardMaterial(mat: THREE.Material) {
  if (!shadowsEnabled() || registry.done.has(mat)) return;
  if (!(mat as THREE.MeshStandardMaterial).isMeshStandardMaterial && !(mat as THREE.MeshLambertMaterial).isMeshLambertMaterial) return;
  if (registry.csm) applyCsm(mat);
  else registry.pending.add(mat);
}

// Mapa de sombra "vacío" propio: el de three no enlaza bien con sampler2DShadow en Chrome/Metal
const dummyRT = new THREE.WebGLRenderTarget(4, 4);
dummyRT.depthTexture = new THREE.DepthTexture(4, 4, THREE.UnsignedIntType);
dummyRT.depthTexture.compareFunction = THREE.LessEqualCompare;
let dummyReady = false;

const tmpDir = new THREE.Vector3();
const lastCamPos = new THREE.Vector3();
const lastCamQuat = new THREE.Quaternion();
const lastSun = new THREE.Vector3();

/** Sol con sombras en cascada. Sustituye a la luz direccional simple. */
export function SunShadows() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const lastUpdate = useRef(-1e9);
  const csmRef = useRef<CSM | null>(null);

  // Se crea en un efecto (añade luces a la escena) y se destruye al desmontar: en desarrollo React
  // monta dos veces y con useMemo quedaban seis soles.
  useEffect(() => {
    const csm = new CSM({
      camera,
      parent: scene,
      cascades: CASCADES,
      maxFar: SHADOW_FAR,
      mode: 'practical',
      shadowMapSize: SHADOW_MAP_SIZE,
      lightDirection: sunState.dir.clone().negate(),
      lightIntensity: 2.6,
      lightNear: 1,
      lightFar: 2500,
      lightMargin: 400, // los que proyectan pueden estar lejos fuera de la vista (la montaña)
      shadowBias: -0.00015,
    });
    csm.fade = true;
    gl.shadowMap.autoUpdate = false;
    for (const l of csm.lights) { l.shadow.normalBias = 0.6; l.shadow.radius = 1.5; l.color.copy(sunState.color); }
    csm.updateFrustums();
    csmRef.current = csm;
    registry.csm = csm;
    for (const m of registry.pending) applyCsm(m);
    registry.pending.clear();
    lastUpdate.current = -1e9;
    return () => {
      registry.csm = null;
      csmRef.current = null;
      csm.remove();
      csm.dispose();
      gl.shadowMap.autoUpdate = true;
      shadowUniforms.csmOn.value = 0;
    };
  }, [camera, scene, gl]);

  useFrame(({ camera, clock }) => {
    if (!dummyReady) {
      // Primer uso: se crea la textura de profundidad vacía para que nadie muestree un mapa nulo
      const prev = gl.getRenderTarget();
      gl.setRenderTarget(dummyRT);
      gl.clear();
      gl.setRenderTarget(prev);
      dummyReady = true;
      for (const m of [shadowUniforms.csmMap0, shadowUniforms.csmMap1, shadowUniforms.csmMap2]) if (!m.value) m.value = dummyRT.depthTexture;
    }
    const csm = csmRef.current;
    if (!csm) return;
    const u = shadowUniforms;

    // Las texturas se crean en la primera pasada de three; el destino de render luego ya no cambia.
    const maps = [u.csmMap0, u.csmMap1, u.csmMap2];
    for (let i = 0; i < CASCADES; i++) {
      const map = csm.lights[i].shadow.map?.depthTexture;
      if (map) maps[i].value = map;
    }

    const s = sunStrength();
    const intensity = 2.6 * s + 5.0 * lightning.flash;
    // Dirección del sol (con un mínimo de altura para que las sombras no se alarguen al infinito)
    tmpDir.copy(sunState.dir);
    tmpDir.y = Math.max(tmpDir.y, 0.06);
    tmpDir.normalize();
    csm.lightDirection.copy(tmpDir).negate();
    for (const l of csm.lights) { l.intensity = intensity; l.color.copy(sunState.color); }

    u.csmOn.value = s > 0.001 ? 1 : 0;
    u.csmLightDir.value.copy(tmpDir);

    const t = clock.getElapsedTime();
    // Se redibuja si la cámara se movió o giró, si cambió la luz solar o si no se ha actualizado en > 1s
    const moved = camera.position.distanceToSquared(lastCamPos) > 1e-4 || camera.quaternion.angleTo(lastCamQuat) > 1e-4;
    const sunMoved = tmpDir.distanceToSquared(lastSun) > 1e-5;
    const stale = t - lastUpdate.current > 1.0;
    const needsInit = !csm.lights[0].shadow.map;
    const shouldUpdate = (moved || sunMoved || stale || lightning.flash > 0 || needsInit) && s > 0.001;

    if (shouldUpdate) {
      camera.updateMatrixWorld();
      csm.update();
      for (const l of csm.lights) {
        l.updateMatrixWorld();
        l.target.updateMatrixWorld();
        // Misma cuenta que hará three al dibujar la cascada: así la matriz de los uniforms es la
        // del mapa que se va a dibujar en este mismo fotograma y la sombra no se desplaza al
        // mover la cámara (el mapa es el mismo destino de render, no una copia del anterior).
        l.shadow.updateMatrices(l);
      }
      // Las cascadas las dibuja three dentro de su propio render (shadowMap.autoUpdate = false):
      // llamar a gl.shadowMap.render() aquí fuera revienta, porque el estado de render del
      // renderer es nulo entre fotogramas.
      gl.shadowMap.needsUpdate = true;

      for (let i = 0; i < CASCADES; i++) {
        const l = csm.lights[i];
        u.csmMatrix.value[i].copy(l.shadow.matrix);
        const cam = l.shadow.camera;
        u.csmTexel.value[i] = (cam.right - cam.left) / SHADOW_MAP_SIZE;
        u.csmSplit.value[i] = i === 0 ? 0 : csm.breaks[i - 1];
      }

      lastUpdate.current = t;
      lastCamPos.copy(camera.position);
      lastCamQuat.copy(camera.quaternion);
      lastSun.copy(tmpDir);
    }
  }, -6); // antes que el reflejo (-5): los mapas tienen que existir cuando se dibuje

  return null;
}
