'use client';
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { collide } from './collision';
import { ISLAND_RADIUS, WATER_LEVEL, WORLD_RADIUS } from './config';
import { terrainHeight } from './terrain';

const EYE_HEIGHT = 1.7; // Altura de los ojos sobre el suelo en metros

export function WalkControls() {
  const three = useThree();
  const camera = three.camera;
  const gl = three.gl;
  const controls = three.controls as OrbitControlsImpl | null;

  const posRef = useRef<THREE.Vector3 | null>(null);
  const rotRef = useRef({ yaw: 0, pitch: 0 });
  const velY = useRef(0);
  const onGround = useRef(true);
  const bobTime = useRef(0);

  const isDragging = useRef(false);
  const lastPointer = useRef({ x: 0, y: 0 });

  const keys = useRef({
    forward: false,
    backward: false,
    left: false,
    right: false,
    sprint: false,
    jump: false,
  });

  // Inicialización de la posición del jugador al entrar en modo caminar
  useEffect(() => {
    const orbTarget = controls?.target;
    let startX = 25;
    let startZ = 70;

    if (orbTarget && Number.isFinite(orbTarget.x) && Number.isFinite(orbTarget.z)) {
      const dist = Math.hypot(orbTarget.x, orbTarget.z);
      if (dist < ISLAND_RADIUS * 1.1) {
        startX = orbTarget.x;
        startZ = orbTarget.z;
      }
    }

    const rawG = terrainHeight(startX, startZ);
    const isSwim = rawG < WATER_LEVEL - 0.6;
    const startY = (isSwim ? WATER_LEVEL - 0.4 : rawG) + EYE_HEIGHT;

    posRef.current = new THREE.Vector3(startX, startY, startZ);

    // Dirección inicial a partir de hacia dónde miraba la cámara
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const startYaw = Math.atan2(-dir.x, -dir.z);
    const startPitch = Math.max(-1.4, Math.min(1.4, Math.asin(Math.max(-0.99, Math.min(0.99, dir.y)))));
    rotRef.current = { yaw: startYaw, pitch: startPitch };

    camera.rotation.order = 'YXZ';
    camera.position.set(startX, startY, startZ);
    camera.rotation.set(startPitch, startYaw, 0, 'YXZ');

    // Al salir de modo caminar, recolocar la cámara orbital detrás de la posición del jugador
    return () => {
      if (controls && posRef.current) {
        const { x, y, z } = posRef.current;
        const yaw = rotRef.current.yaw;
        controls.target.set(x - Math.sin(yaw) * 15, y - 0.5, z - Math.cos(yaw) * 15);
        camera.position.set(x + Math.sin(yaw) * 12, y + 8, z + Math.cos(yaw) * 12);
        controls.update();
      }
    };
  }, [camera, controls]);

  // Manejo del teclado
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
          keys.current.forward = true;
          break;
        case 'KeyS':
        case 'ArrowDown':
          keys.current.backward = true;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          keys.current.left = true;
          break;
        case 'KeyD':
        case 'ArrowRight':
          keys.current.right = true;
          break;
        case 'ShiftLeft':
        case 'ShiftRight':
          keys.current.sprint = true;
          break;
        case 'Space':
          keys.current.jump = true;
          e.preventDefault();
          break;
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
          keys.current.forward = false;
          break;
        case 'KeyS':
        case 'ArrowDown':
          keys.current.backward = false;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          keys.current.left = false;
          break;
        case 'KeyD':
        case 'ArrowRight':
          keys.current.right = false;
          break;
        case 'ShiftLeft':
        case 'ShiftRight':
          keys.current.sprint = false;
          break;
        case 'Space':
          keys.current.jump = false;
          break;
      }
    };

    const onBlur = () => {
      keys.current = { forward: false, backward: false, left: false, right: false, sprint: false, jump: false };
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // Manejo del mouse y táctil (arrastrar para mirar + soporte de bloqueo de cursor al hacer clic)
  useEffect(() => {
    const dom = gl.domElement;
    dom.style.touchAction = 'none';

    const onPointerDown = (e: PointerEvent) => {
      isDragging.current = true;
      lastPointer.current = { x: e.clientX, y: e.clientY };
    };

    const onPointerMove = (e: PointerEvent) => {
      if (document.pointerLockElement === dom) {
        rotRef.current.yaw -= e.movementX * 0.0022;
        rotRef.current.pitch = Math.max(-1.45, Math.min(1.45, rotRef.current.pitch - e.movementY * 0.0022));
        return;
      }
      if (!isDragging.current) return;
      const dx = e.clientX - lastPointer.current.x;
      const dy = e.clientY - lastPointer.current.y;
      lastPointer.current = { x: e.clientX, y: e.clientY };
      rotRef.current.yaw -= dx * 0.003;
      rotRef.current.pitch = Math.max(-1.45, Math.min(1.45, rotRef.current.pitch - dy * 0.003));
    };

    const onPointerUp = () => {
      isDragging.current = false;
    };

    dom.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);

    return () => {
      dom.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      if (document.pointerLockElement === dom) {
        document.exitPointerLock?.();
      }
    };
  }, [gl]);

  // Actualización por fotograma (movimiento, gravedad, altura sobre el terreno y cabeceo de paso)
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const pos = posRef.current;
    if (!pos) return;

    const yaw = rotRef.current.yaw;
    const pitch = rotRef.current.pitch;

    // Vectores horizontales de avance y desplazamiento lateral
    const forwardX = -Math.sin(yaw);
    const forwardZ = -Math.cos(yaw);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);

    let mx = 0;
    let mz = 0;
    if (keys.current.forward) { mx += forwardX; mz += forwardZ; }
    if (keys.current.backward) { mx -= forwardX; mz -= forwardZ; }
    if (keys.current.left) { mx -= rightX; mz -= rightZ; }
    if (keys.current.right) { mx += rightX; mz += rightZ; }

    const inputLen = Math.hypot(mx, mz);
    const isSprinting = keys.current.sprint;
    const speed = isSprinting ? 15 : 7.5;

    if (inputLen > 0.001) {
      const step = (speed * dt) / inputLen;
      const targetX = pos.x + mx * step;
      const targetZ = pos.z + mz * step;

      // Límite dentro de la isla y mar cercano
      const distFromCenter = Math.hypot(targetX, targetZ);
      if (distFromCenter < WORLD_RADIUS * 0.95) {
        const feet = pos.y - EYE_HEIGHT;
        const curG = Math.max(terrainHeight(pos.x, pos.z), WATER_LEVEL - 0.4, collide(pos.x, pos.z, feet).floor);
        const nextG = Math.max(terrainHeight(targetX, targetZ), WATER_LEVEL - 0.4, collide(targetX, targetZ, feet).floor);
        // Evitar trepar acantilados verticales (> 2 metros por paso)
        if (nextG - curG < 2.0) {
          pos.x = targetX;
          pos.z = targetZ;
        }
      }
    }

    // Colisión con los cuerpos del mundo: saca al jugador de árboles, rocas, muros y casco, y de
    // paso dice si está pisando algo sólido (una roca baja, la escalera o el adarve del castillo).
    const hit = collide(pos.x, pos.z, pos.y - EYE_HEIGHT);
    pos.x = hit.x;
    pos.z = hit.z;

    // Altura del terreno y física vertical
    const rawG = Math.max(terrainHeight(pos.x, pos.z), hit.floor);
    const isSwimming = rawG < WATER_LEVEL - 0.6;
    const floorY = (isSwimming ? WATER_LEVEL - 0.4 : rawG) + EYE_HEIGHT;

    if (isSwimming) {
      // Flotación en el agua
      pos.y += (floorY - pos.y) * Math.min(1, dt * 10);
      velY.current = 0;
      onGround.current = true;
    } else {
      if (keys.current.jump && onGround.current) {
        velY.current = 6.0;
        onGround.current = false;
        keys.current.jump = false;
      }

      velY.current -= 18 * dt; // gravedad
      pos.y += velY.current * dt;

      if (pos.y <= floorY) {
        pos.y = floorY;
        velY.current = 0;
        onGround.current = true;
      } else {
        onGround.current = false;
      }
    }

    // Aplicar a la cámara
    camera.position.set(pos.x, pos.y, pos.z);
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
    camera.updateMatrixWorld();
  }, -10);

  return null;
}
