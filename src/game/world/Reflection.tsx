'use client';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { lowQuality } from '../config';

/*
 * Reflejo planar: la escena se dibuja desde una cámara espejada bajo la lámina de agua, en una
 * textura que luego muestrean los shaders del mar y la laguna. Solo se reflejan los objetos con
 * la capa REFLECT_LAYER (terreno, bosque, rocas, cielo); nunca el agua ni la vegetación menuda.
 */

export const REFLECT_LAYER = 2;
/** Máscara de capas para los objetos que salen en el reflejo (capa 0 normal + capa de reflejo). */
export const REFLECT_MASK = (1 << 0) | (1 << REFLECT_LAYER);

export interface ReflectionSlot {
  texture: THREE.Texture | null;
  matrix: THREE.Matrix4;
  on: number;
}
function makeSlot(): ReflectionSlot { return { texture: null, matrix: new THREE.Matrix4(), on: 0 }; }

export const reflections = { sea: makeSlot(), lake: makeSlot() };

/** ?sinreflejos en la URL los apaga (para comparar rendimiento). */
export function reflectionsEnabled(): boolean {
  return !lowQuality() && !(typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('sinreflejos'));
}

const normal = new THREE.Vector3(0, 1, 0);
const planePoint = new THREE.Vector3();
const view = new THREE.Vector3();
const target = new THREE.Vector3();
const lookAt = new THREE.Vector3();
const plane = new THREE.Plane();
const clip = new THREE.Vector4();
const q = new THREE.Vector4();

/**
 * Dibuja el reflejo de una lámina horizontal a la altura `level`. `every`: un fotograma de cada
 * cuantos (los reflejos del mar y la laguna se alternan). `center`/`maxDistance`: solo se
 * calcula si la cámara está cerca de la lámina.
 */
export function PlanarReflection({ level, slot, every = 2, phase = 0, center, maxDistance = Infinity }: {
  level: number; slot: ReflectionSlot; every?: number; phase?: number; center?: [number, number]; maxDistance?: number;
}) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);
  const frame = useRef(0);
  const virtualCamera = useMemo(() => new THREE.PerspectiveCamera(), []);
  const rt = useMemo(() => {
    const w = Math.max(64, Math.round((size.width * dpr) / 2));
    const h = Math.max(64, Math.round((size.height * dpr) / 2));
    const t = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: false });
    // Con mipmaps: los shaders muestrean con desenfoque para que el reflejo no sea un espejo perfecto
    t.texture.minFilter = THREE.LinearMipmapLinearFilter;
    t.texture.magFilter = THREE.LinearFilter;
    t.texture.generateMipmaps = true;
    return t;
  }, [size.width, size.height, dpr]);
  useEffect(() => () => { rt.dispose(); if (slot.texture === rt.texture) { slot.texture = null; slot.on = 0; } }, [rt, slot]);

  useFrame(({ camera }) => {
    frame.current++;
    if (frame.current % every !== phase) return;
    const cam = camera as THREE.PerspectiveCamera;
    if (center && Math.hypot(cam.position.x - center[0], cam.position.z - center[1]) > maxDistance) { slot.on = 0; return; }
    planePoint.set(0, level, 0);
    view.subVectors(cam.position, planePoint);
    if (view.dot(normal) < 0.3) { slot.on = 0; return; } // cámara bajo la lámina

    // Cámara espejada respecto al plano
    view.reflect(normal).negate().add(planePoint);
    cam.getWorldDirection(lookAt);
    lookAt.add(cam.position);
    target.subVectors(lookAt, planePoint).reflect(normal).negate().add(planePoint);
    virtualCamera.position.copy(view);
    virtualCamera.up.set(0, -1, 0);
    virtualCamera.lookAt(target);
    virtualCamera.near = cam.near;
    virtualCamera.far = cam.far;
    virtualCamera.updateMatrixWorld();
    virtualCamera.projectionMatrix.copy(cam.projectionMatrix);

    // Matriz que proyecta un punto del mundo a las uv de la textura
    slot.matrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    slot.matrix.multiply(virtualCamera.projectionMatrix);
    slot.matrix.multiply(virtualCamera.matrixWorldInverse);

    // Plano de recorte oblicuo: nada de lo que está bajo el agua entra en el reflejo
    plane.setFromNormalAndCoplanarPoint(normal, planePoint);
    plane.applyMatrix4(virtualCamera.matrixWorldInverse);
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const p = virtualCamera.projectionMatrix;
    q.x = (Math.sign(clip.x) + p.elements[8]) / p.elements[0];
    q.y = (Math.sign(clip.y) + p.elements[9]) / p.elements[5];
    q.z = -1;
    q.w = (1 + p.elements[10]) / p.elements[14];
    clip.multiplyScalar(2 / clip.dot(q));
    p.elements[2] = clip.x;
    p.elements[6] = clip.y;
    p.elements[10] = clip.z + 1 - 0.003;
    p.elements[14] = clip.w;

    virtualCamera.layers.set(REFLECT_LAYER);
    const prevRT = gl.getRenderTarget();
    const prevXr = gl.xr.enabled;
    gl.xr.enabled = false;
    gl.setRenderTarget(rt);
    gl.state.buffers.depth.setMask(true);
    if (!gl.autoClear) gl.clear();
    gl.render(scene, virtualCamera);
    gl.setRenderTarget(prevRT);
    gl.xr.enabled = prevXr;

    slot.texture = rt.texture;
    slot.on = 1;
  }, -5);

  return null;
}
