'use client';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { SHIP, WATER_LEVEL } from '../config';
import { terrainHeight } from '../terrain';
import { smoothstep } from '../noise';
import { oceanSimHolder, type DisplacementBlock } from './oceanSim';
import { registerStandardMaterial } from './Shadows';
import { REFLECT_MASK } from './Reflection';

const SHIP_URL = '/models/dutch_ship_large_01.glb';

/**
 * Oscilador de segundo orden: un cuerpo flotante vuelve a su equilibrio (el plano del agua) con un
 * periodo propio y un amortiguamiento; no copia la ola, la sigue con retraso y filtra las rápidas.
 */
class Dof {
  x = 0; v = 0;
  constructor(private period: number, private damping: number) {}
  step(target: number, dt: number) {
    const wn = (2 * Math.PI) / this.period;
    const a = wn * wn * (target - this.x) - 2 * this.damping * wn * this.v;
    this.v += a * dt;
    this.x += this.v * dt;
  }
}

/**
 * Barco fondeado frente a la costa. El origen del modelo está en la línea de flotación.
 * Física del flotador: se lee de la simulación del mar la altura del agua en todos los texels bajo la
 * huella del casco y se ajusta el plano que mejor la aproxima (mínimos cuadrados). Su altura media es la
 * arfada y sus pendientes el cabeceo (proa/popa) y el balanceo (babor/estribor): las olas más cortas que la
 * eslora se cancelan solas. Cada grado de libertad responde con el periodo propio y amortiguamiento
 * típicos de un buque de 30 m, así que el barco queda estable con mar normal y solo acusa el mar de fondo.
 */
export function Ship() {
  const gltf = useGLTF(SHIP_URL);
  const hull = useRef<THREE.Group>(null);
  const heading = SHIP.heading;
  // Mismo factor que el shader del mar: el oleaje de mar abierto se atenúa al acercarse a la orilla
  const openAmp = useMemo(() => smoothstep(4, 20, WATER_LEVEL - terrainHeight(SHIP.x, SHIP.z)), []);
  const block = useMemo<DisplacementBlock>(() => ({ data: new Float32Array(0), i0: 0, j0: 0, w: 0, h: 0, texel: 1 }), []);
  const target = useRef({ y: 0, pitch: 0, roll: 0 });
  const dof = useMemo(() => ({ heave: new Dof(5.5, 0.5), pitch: new Dof(6.5, 0.45), roll: new Dof(9, 0.3) }), []);
  const tick = useRef(0);

  const scene = useMemo(() => {
    const s = gltf.scene;
    s.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      m.layers.mask = REFLECT_MASK;
      const mat = m.material as THREE.MeshStandardMaterial;
      if (/sails|rigging/i.test(mat.name)) mat.side = THREE.DoubleSide;
      registerStandardMaterial(mat);
    });
    return s;
  }, [gltf]);

  useEffect(() => { console.info(`[isla] barco fondeado en (${SHIP.x}, ${SHIP.z}), rumbo ${(heading * 180 / Math.PI).toFixed(0)}°`); }, [heading]);

  useFrame(({ gl }, dt) => {
    const g = hull.current;
    if (!g) return;
    const sim = oceanSimHolder.sim;
    const t = target.current;
    // Plano del agua bajo el casco, cada 2 fotogramas (lectura síncrona de la GPU)
    if (sim && openAmp > 0.01 && tick.current++ % 2 === 0) {
      const ax = Math.cos(heading), az = -Math.sin(heading);   // proa
      const px = -az, pz = ax;                                  // estribor (+z local)
      const [A, B] = SHIP.hull;
      const cx = SHIP.x + ax * SHIP.hullOffset, cz = SHIP.z + az * SHIP.hullOffset;
      sim.readDisplacementArea(gl, cx, cz, A + 1, block);
      let n = 0, sy = 0, su = 0, sv = 0, suu = 0, svv = 0, suy = 0, svy = 0;
      for (let j = 0; j < block.h; j++) {
        for (let i = 0; i < block.w; i++) {
          const wx = (block.i0 + i + 0.5) * block.texel - cx, wz = (block.j0 + j + 0.5) * block.texel - cz;
          const u = wx * ax + wz * az, v = wx * px + wz * pz;
          if ((u * u) / (A * A) + (v * v) / (B * B) > 1) continue;
          const y = block.data[(j * block.w + i) * 4 + 1] * openAmp;
          n++; sy += y; su += u; sv += v; suu += u * u; svv += v * v; suy += u * y; svy += v * y;
        }
      }
      if (n >= 3) {
        const mu = su / n, mv = sv / n;
        const varU = suu / n - mu * mu, varV = svv / n - mv * mv;
        t.y = sy / n;
        const slopeU = varU > 1e-3 ? (suy / n - mu * (sy / n)) / varU : 0;
        const slopeV = varV > 1e-3 ? (svy / n - mv * (sy / n)) / varV : 0;
        t.pitch = Math.atan(slopeU);   // proa arriba = giro positivo en Z
        t.roll = -Math.atan(slopeV);   // estribor arriba = giro negativo en X
      }
    }
    const h = Math.min(dt, 0.05);
    dof.heave.step(t.y, h);
    dof.pitch.step(t.pitch, h);
    dof.roll.step(t.roll, h);
    g.position.y = WATER_LEVEL + dof.heave.x;
    g.rotation.z = dof.pitch.x;
    g.rotation.x = dof.roll.x;
  });

  return (
    <group position={[SHIP.x, WATER_LEVEL, SHIP.z]} rotation={[0, heading, 0]}>
      <group ref={hull}>
        <primitive object={scene} />
      </group>
    </group>
  );
}

useGLTF.preload(SHIP_URL);
