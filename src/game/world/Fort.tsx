'use client';
import { useMemo } from 'react';
import { Html, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { terrainHeight } from '../terrain';
import { FORT_PIECES, FORT_PIECE_NAMES, castleLayout, type FortPieceName } from './castle';
import { registerStandardMaterial } from './Shadows';
import { REFLECT_MASK } from './Reflection';

/**
 * Kit modular de fuerte (Poly Haven modular_fort_01, CC0): 22 piezas en un solo GLB con 3 materiales
 * compartidos (wall, trim, plaster). Cada pieza se saca por nombre y se puede repetir las veces que haga
 * falta: las copias comparten geometría y material, así que un castillo entero cuesta lo mismo en GPU
 * que las piezas distintas que use.
 */
const FORT_URL = '/models/modular_fort_01.glb';
const PREFIX = 'modular_fort_01_';

/** Plantillas del kit: un grupo por pieza, con la traslación original del asset anulada. */
export function useFortKit(): Map<FortPieceName, THREE.Group> {
  const gltf = useGLTF(FORT_URL);
  return useMemo(() => {
    const kit = new Map<FortPieceName, THREE.Group>();
    // Cada pieza tiene 2-3 primitivas, así que GLTFLoader la deja como Group (con el nombre del nodo) y mallas hijas.
    gltf.scene.traverse((o) => {
      const name = o.name.replace(PREFIX, '') as FortPieceName;
      if (!(name in FORT_PIECES) || kit.has(name)) return;
      o.traverse((c) => {
        const m = c as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = true;
        m.receiveShadow = true;
        m.layers.mask = REFLECT_MASK;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) registerStandardMaterial(mat);
      });
      const g = new THREE.Group();
      g.name = name;
      const clone = o.clone(); // comparte geometrías y materiales
      clone.position.set(0, 0, 0);
      clone.rotation.set(0, 0, 0);
      g.add(clone);
      kit.set(name, g);
    });
    return kit;
  }, [gltf]);
}

/** Una pieza del kit en el mundo. `y` se omite para apoyarla en el terreno. */
export function FortPiece({ name, x, z, y, rotationY = 0, kit }: {
  name: FortPieceName; x: number; z: number; y?: number; rotationY?: number; kit: Map<FortPieceName, THREE.Group>;
}) {
  const obj = useMemo(() => kit.get(name)?.clone() ?? new THREE.Group(), [kit, name]);
  const py = y ?? terrainHeight(x, z) - 0.4; // ligeramente hundida para que no flote en pendiente
  return <primitive object={obj} position={[x, py, z]} rotation={[0, rotationY, 0]} />;
}

export function fortCatalogEnabled(): boolean {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('piezas');
}
export const FORT_CATALOG = { x: -160, z: 60, cols: 5, step: 24 };

/** Modo `?piezas`: todas las piezas del kit en una cuadrícula con su nombre, para revisarlas una a una. */
export function FortCatalog() {
  const kit = useFortKit();
  const items = useMemo(() => FORT_PIECE_NAMES.map((name, i) => ({
    name,
    x: FORT_CATALOG.x + (i % FORT_CATALOG.cols) * FORT_CATALOG.step,
    z: FORT_CATALOG.z + Math.floor(i / FORT_CATALOG.cols) * FORT_CATALOG.step,
  })), []);
  return (
    <>
      {items.map((it) => (
        <group key={it.name}>
          <FortPiece name={it.name} x={it.x} z={it.z} kit={kit} />
          <Html position={[it.x + 2, terrainHeight(it.x, it.z) + 11, it.z + 2]} center distanceFactor={60}
            style={{ color: '#fff', background: 'rgba(0,0,0,.55)', padding: '2px 6px', borderRadius: 4, fontSize: 13, whiteSpace: 'nowrap', fontFamily: 'system-ui' }}>
            {it.name}
          </Html>
        </group>
      ))}
    </>
  );
}

export function Castle() {
  const kit = useFortKit();
  const pieces = useMemo(() => castleLayout(), []);
  if (fortCatalogEnabled()) {
    return <FortCatalog />;
  }
  return (
    <>
      {pieces.map((p) => (
        <FortPiece key={p.key} name={p.name} x={p.x} z={p.z} y={p.y} rotationY={p.rotY} kit={kit} />
      ))}
    </>
  );
}

export const Fort = Castle;

useGLTF.preload(FORT_URL);
