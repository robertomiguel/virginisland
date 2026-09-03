'use client';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { WIND } from '../config';
import { weather } from '../weather';

const MAX_DROPS = 30000;
const BOX = { x: 140, z: 140 }; // la altura del volumen depende de la cámara (del suelo hasta por encima)
const windDir = new THREE.Vector2(...WIND.dir).normalize();

const vertexShader = /* glsl */ `
  attribute float seed;
  attribute vec2 corner;  // x: -1/1 (lado), y: 0 cabeza / 1 cola
  attribute float idx;    // 0..1, para activar solo una fracción
  uniform float time;
  uniform float intensity;
  uniform float activeFrac;
  uniform float wind;
  uniform vec2 windDir;
  uniform vec3 camPos;
  uniform float top;      // altura del volumen de lluvia (m sobre el nivel del mar)
  varying float vAlpha;
  varying float vSide;
  float fr(float x) { return fract(sin(x) * 43758.5453); }
  void main() {
    if (idx > activeFrac) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vAlpha = 0.0; vSide = 0.0; return; }
    float speed = mix(8.0, 15.0, intensity) * (0.85 + fr(seed * 7.3) * 0.3);
    vec2 drift = windDir * wind * 0.45;
    // Posición fija en el mundo: la gota vive en una rejilla que se repite; la cámara se mueve entre ellas
    float bx = ${BOX.x.toFixed(1)}, bz = ${BOX.z.toFixed(1)};
    float x = camPos.x + mod(fr(seed * 13.1) * bx - camPos.x, bx) - bx * 0.5;
    float z = camPos.z + mod(fr(seed * 29.7) * bz - camPos.z, bz) - bz * 0.5;
    float y = top - mod(fr(seed * 3.7) * top + time * speed, top);
    // deriva acumulada con la caída (desde lo alto del volumen)
    vec2 off = drift * ((top - y) / speed);
    vec3 head = vec3(x + off.x, y, z + off.y);
    vec3 fall = normalize(vec3(drift.x, -speed, drift.y));
    float len = mix(0.5, 2.2, intensity) * (0.7 + fr(seed * 5.1) * 0.6);
    vec3 tail = head - fall * len;
    vec4 mvHead = viewMatrix * vec4(head, 1.0);
    vec4 mvTail = viewMatrix * vec4(tail, 1.0);
    vec4 mv = mix(mvHead, mvTail, corner.y);
    float dist = -mv.z;
    float width = mix(0.010, 0.022, intensity) * (1.0 + dist * 0.015); // de lejos un poco más anchas para no desaparecer
    mv.x += corner.x * width;
    vSide = corner.x;
    vAlpha = mix(0.22, 0.5, intensity) * (1.0 - corner.y * 0.8);
    vAlpha *= smoothstep(-160.0, -6.0, mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const fragmentShader = /* glsl */ `
  varying float vAlpha;
  varying float vSide;
  void main() {
    float edge = 1.0 - vSide * vSide; // borde suave de la tira
    gl_FragColor = vec4(0.72, 0.80, 0.92, vAlpha * edge);
  }
`;

/** Lluvia: tiras finas orientadas a la cámara dentro de una caja que sigue a la cámara. */
export function Rain() {
  const material = useRef<THREE.ShaderMaterial>(null!);
  const geometry = useMemo(() => {
    const n = MAX_DROPS;
    const pos = new Float32Array(n * 4 * 3);
    const seed = new Float32Array(n * 4);
    const corner = new Float32Array(n * 4 * 2);
    const idx = new Float32Array(n * 4);
    const index = new Uint32Array(n * 6);
    for (let i = 0; i < n; i++) {
      const s = Math.random() * 1000;
      const cs = [[-1, 0], [1, 0], [1, 1], [-1, 1]];
      for (let c = 0; c < 4; c++) {
        seed[i * 4 + c] = s;
        idx[i * 4 + c] = i / n;
        corner[(i * 4 + c) * 2] = cs[c][0];
        corner[(i * 4 + c) * 2 + 1] = cs[c][1];
      }
      const b = i * 4;
      index.set([b, b + 1, b + 2, b, b + 2, b + 3], i * 6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    g.setAttribute('corner', new THREE.BufferAttribute(corner, 2));
    g.setAttribute('idx', new THREE.BufferAttribute(idx, 1));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    return g;
  }, []);
  const uniforms = useMemo(() => ({
    time: { value: 0 }, intensity: { value: 0 }, activeFrac: { value: 0 }, wind: { value: 0 },
    windDir: { value: windDir.clone() }, camPos: { value: new THREE.Vector3() }, top: { value: 80 },
  }), []);

  useFrame(({ camera }, dt) => {
    const u = material.current.uniforms;
    u.time.value += Math.min(dt, 0.05);
    const rain = weather.params.rain;
    u.intensity.value = rain;
    u.activeFrac.value = rain < 0.02 ? 0 : 0.15 + 0.85 * rain;
    u.wind.value = weather.params.wind;
    u.camPos.value.copy(camera.position);
    // El volumen va del nivel del mar hasta 30 m por encima de la cámara, en escalones de 20 m para no saltar
    u.top.value = Math.max(60, Math.ceil((camera.position.y + 30) / 20) * 20);
  });

  return (
    <mesh geometry={geometry} frustumCulled={false} renderOrder={20}>
      <shaderMaterial ref={material} vertexShader={vertexShader} fragmentShader={fragmentShader} uniforms={uniforms} transparent depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}
