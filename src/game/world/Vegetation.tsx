'use client';
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { FLORA_KINDS, FLOWER_KINDS, GRASS_CELL, GRASS_FAR, GRASS_KINDS, GRASS_VARIANTS, LOG_KINDS, ROCK_KINDS, TREE_KINDS, TREE_NEAR, generateFlora, generateFlowers, generateLogs, generateRocks, grassCell, grassDensityAt, type Placed } from '../vegetation';
import { WIND } from '../config';

import { weather, weatherClock } from '../weather';
import { FOLIAGE_ALPHA_TEST, extractVariants, matchFoliage, type Variant } from './variants';
import { prepareAlphaMap } from './alphaMips';
import { addWindSway } from './windShader';
import { buildClump, liftNormals } from './grass';
import { registerStandardMaterial } from './Shadows';
import { REFLECT_MASK } from './Reflection';

const windDir = new THREE.Vector2(...WIND.dir).normalize();
const dummy = new THREE.Object3D();

/**
 * Capa instanciada genérica: `variants[v]` tiene piezas cercanas y (opcionalmente) lejanas.
 * Cada 0.4 s se reparten los elementos por distancia a la cámara.
 */
function InstancedLayer({ items, variants, nearDist, maxDist, castShadow = false, receiveShadow = true, reflect = false }: {
  items: Placed[]; variants: { near: Variant; far?: Variant }[]; nearDist: number; maxDist: number;
  castShadow?: boolean; receiveShadow?: boolean; reflect?: boolean; // reflect: sale en el reflejo del agua
}) {
  const refs = useRef<{ near: THREE.InstancedMesh[]; far: THREE.InstancedMesh[] }[]>(variants.map(() => ({ near: [], far: [] })));
  const timer = useRef(10);
  const counts = useMemo(() => variants.map((_, v) => items.filter((it) => it.variant === v).length), [items, variants]);
  const layerMask = reflect ? REFLECT_MASK : 1;
  // Los materiales estándar tienen que conocer las cascadas de sombra
  useMemo(() => { for (const v of variants) for (const part of [...v.near.parts, ...(v.far?.parts ?? [])]) registerStandardMaterial(part.material); }, [variants]);

  useFrame(({ camera }, dt) => {
    timer.current += dt;
    if (timer.current < 0.4) return;
    timer.current = 0;
    const n = variants.map(() => 0), f = variants.map(() => 0);
    const cx = camera.position.x, cz = camera.position.z;
    for (const it of items) {
      const d = Math.hypot(it.x - cx, it.z - cz);
      if (d > maxDist) continue;
      const v = it.variant;
      const isNear = d < nearDist || !variants[v].far;
      dummy.position.set(it.x, it.y, it.z);
      dummy.rotation.set(0, it.rot, 0);
      dummy.scale.setScalar(it.scale);
      dummy.updateMatrix();
      if (isNear) { for (const m of refs.current[v].near) m.setMatrixAt(n[v], dummy.matrix); n[v]++; }
      else { for (const m of refs.current[v].far) m.setMatrixAt(f[v], dummy.matrix); f[v]++; }
    }
    variants.forEach((_, v) => {
      for (const m of refs.current[v].near) { m.count = n[v]; m.instanceMatrix.needsUpdate = true; }
      for (const m of refs.current[v].far) { m.count = f[v]; m.instanceMatrix.needsUpdate = true; }
    });
  });

  return (
    <group>
      {variants.map((vr, v) => (
        <group key={v}>
          {vr.near.parts.map((p, i) => (
            <instancedMesh key={`n${i}`} ref={(el) => { if (el) refs.current[v].near[i] = el; }} args={[p.geometry, p.material, Math.max(1, counts[v])]} frustumCulled={false} count={0} castShadow={castShadow} receiveShadow={receiveShadow} layers-mask={layerMask} />
          ))}
          {vr.far?.parts.map((p, i) => (
            <instancedMesh key={`f${i}`} ref={(el) => { if (el) refs.current[v].far[i] = el; }} args={[p.geometry, p.material, Math.max(1, counts[v])]} frustumCulled={false} count={0} castShadow={castShadow} receiveShadow={receiveShadow} layers-mask={layerMask} />
          ))}
        </group>
      ))}
    </group>
  );
}

// --- Árboles -------------------------------------------------------------------------------
function TreeKind({ items, kind }: { items: Placed[]; kind: number }) {
  const k = TREE_KINDS[kind];
  const lod1 = useGLTF(k.lod1);
  const lod2 = useGLTF(k.lod2);
  const alpha = useLoader(THREE.TextureLoader, k.alpha);
  const variants = useMemo(() => {
    prepareAlphaMap(alpha, FOLIAGE_ALPHA_TEST);
    // El alfa solo va en las hojas; tronco y ramas son opacos
    const opts = { alphaMap: { leaves: alpha }, singleVariant: true };
    const near = extractVariants(lod1.scene, opts)[0];
    const far = extractVariants(lod2.scene, opts)[0];
    matchFoliage(near, far);   // el lod2 viene con una cuarta parte de las hojas
    return [{ near, far }];
  }, [lod1, lod2, alpha]);
  const mine = useMemo(() => items.filter((t) => t.kind === kind).map((t) => ({ ...t, variant: 0 })), [items, kind]);
  return <InstancedLayer items={mine} variants={variants} nearDist={TREE_NEAR} maxDist={Infinity} castShadow reflect />;
}

export function Trees({ items }: { items: Placed[] }) {
  useEffect(() => { console.info(`[isla] árboles: ${items.length} (jacarandas ${items.filter((t) => t.kind === 0).length}, anchos ${items.filter((t) => t.kind === 1).length})`); }, [items]);
  return (
    <group>
      {TREE_KINDS.map((_, i) => (
        <TreeKind key={i} items={items} kind={i} />
      ))}
    </group>
  );
}

// --- Flora baja ----------------------------------------------------------------------------
function FloraKind({ items, kind, onVariants }: { items: Placed[]; kind: number; onVariants?: (n: number) => void }) {
  const k = FLORA_KINDS[kind];
  const gltf = useGLTF(k.url);
  const alpha = useLoader(THREE.TextureLoader, k.alpha);
  const variants = useMemo(() => {
    prepareAlphaMap(alpha, FOLIAGE_ALPHA_TEST);
    // En los matorrales el alfa va solo en hojas y ramitas: al tronco lo agujerearía
    const alphaMap = k.parts.length ? Object.fromEntries(k.parts.map((n) => [n, alpha])) : alpha;
    return extractVariants(gltf.scene, { alphaMap }).map((v) => ({ near: v }));
  }, [gltf, alpha, k.parts]);
  useEffect(() => onVariants?.(variants.length), [variants, onVariants]);
  const mine = useMemo(() => items.filter((t) => t.kind === kind).map((t) => ({ ...t, variant: t.variant % variants.length })), [items, kind, variants.length]);
  return <InstancedLayer items={mine} variants={variants} nearDist={Infinity} maxDist={k.far} />;
}

export function Flora() {
  const items = useMemo(() => generateFlora(), []);
  useEffect(() => { console.info(`[isla] flora baja: ${items.length}`); }, [items]);
  return (
    <group>
      {FLORA_KINDS.map((_, i) => (
        <FloraKind key={i} items={items} kind={i} />
      ))}
    </group>
  );
}

// --- Rocas ---------------------------------------------------------------------------------
function RockKind({ items, kind }: { items: Placed[]; kind: number }) {
  const k = ROCK_KINDS[kind];
  const lod1 = useGLTF(k.lod1);
  const lod2 = useGLTF(k.lod2);
  const variants = useMemo(() => {
    const near = extractVariants(lod1.scene, { splitComponents: k.split });
    const far = extractVariants(lod2.scene, { splitComponents: k.split });
    return near.map((v, i) => ({ near: v, far: far[Math.min(i, far.length - 1)] }));
  }, [lod1, lod2, k.split]);
  const mine = useMemo(() => items.filter((t) => t.kind === kind).map((t) => ({ ...t, variant: t.variant % variants.length })), [items, kind, variants.length]);
  return <InstancedLayer items={mine} variants={variants} nearDist={120} maxDist={Infinity} castShadow reflect />;
}

export function Rocks() {
  const items = useMemo(() => generateRocks(9000, [1, 1, 8]), []);
  useEffect(() => { console.info(`[isla] rocas: ${items.length}`); }, [items]);
  return (
    <group>
      {ROCK_KINDS.map((_, i) => (
        <RockKind key={i} items={items} kind={i} />
      ))}
    </group>
  );
}

// --- Troncos caídos ------------------------------------------------------------------------
function LogKind({ items, kind }: { items: Placed[]; kind: number }) {
  const k = LOG_KINDS[kind];
  const lod1 = useGLTF(k.lod1);
  const lod2 = useGLTF(k.lod2);
  const variants = useMemo(() => [{ near: extractVariants(lod1.scene)[0], far: extractVariants(lod2.scene)[0] }], [lod1, lod2]);
  const mine = useMemo(() => items.filter((t) => t.kind === kind).map((t) => ({ ...t, variant: 0 })), [items, kind]);
  return <InstancedLayer items={mine} variants={variants} nearDist={120} maxDist={Infinity} castShadow reflect />;
}

export function Logs() {
  const items = useMemo(() => generateLogs(), []);
  useEffect(() => { console.info(`[isla] troncos caídos: ${items.length}`); }, [items]);
  return (
    <group>
      {LOG_KINDS.map((_, i) => (
        <LogKind key={i} items={items} kind={i} />
      ))}
    </group>
  );
}

// --- Flores --------------------------------------------------------------------------------
/** Una especie de flor: cada ejemplar del GLB (a, b, c…) es una variante que se reparte por `sub`. */
function FlowerKind({ items, kind }: { items: Placed[]; kind: number }) {
  const k = FLOWER_KINDS[kind];
  const gltf = useGLTF(k.url);
  const alpha = useLoader(THREE.TextureLoader, k.alpha);
  const variants = useMemo(() => {
    prepareAlphaMap(alpha, FOLIAGE_ALPHA_TEST);
    return extractVariants(gltf.scene, { alphaMap: alpha }).map((v) => ({ near: v }));
  }, [gltf, alpha]);
  const mine = useMemo(
    () => items.filter((t) => t.variant === kind).map((t) => ({ ...t, variant: (t.sub ?? 0) % variants.length })),
    [items, kind, variants.length],
  );
  return <InstancedLayer items={mine} variants={variants} nearDist={Infinity} maxDist={60} />;
}

export function Flowers() {
  const items = useMemo(() => generateFlowers(), []);
  useEffect(() => { console.info(`[isla] flores: ${items.length}`); }, [items]);
  return (
    <group>
      {FLOWER_KINDS.map((_, i) => (
        <Suspense key={i} fallback={null}><FlowerKind items={items} kind={i} /></Suspense>
      ))}
    </group>
  );
}

// --- Pasto ---------------------------------------------------------------------------------
// Vaivén del pasto: flojo a propósito. El juego va a 30 fps, y una mata de 30 cm que se mueva
// más que unos centímetros no se lee como viento sino como temblor.
const GRASS_WIND = 0.08;     // 0 para apagarlo
const GRASS_LIFT = 0.7;      // cuánto se inclina la normal de la brizna hacia el cielo
const GRASS_CAPACITY = 800;  // matas que caben en cada InstancedMesh (una por especie y variante)

/**
 * Alfombra de pasto alrededor de la cámara.
 *
 * No es una `InstancedLayer` porque las matas no salen de una lista fija: se siembran por celdas
 * según anda el jugador (`grassCell`). Cada especie y variante tiene su malla instanciada con sitio
 * reservado; en cada repaso se recorren las celdas del radio y se escriben las matrices.
 *
 * La densidad la pone `grassDensityAt`: cada mata trae fijo el número de matas por m2 a partir del
 * cual le toca salir, y se dibuja mientras la densidad de su distancia llegue a ese número. Así el
 * pasto se espesa al acercarse y se ralea hacia el borde sin cortarse en un círculo, y una mata dada
 * aparece una sola vez, sin parpadear.
 */
export function Grass() {
  const registry = useMemo<THREE.WebGLProgramParametersWithUniforms[]>(() => [], []);
  const gltfs = useGLTF(GRASS_KINDS.map((k) => k.url));
  const alphas = useLoader(THREE.TextureLoader, GRASS_KINDS.map((k) => k.alpha));

  // Una mata por especie y variante, ya fusionada
  const shapes = useMemo(() => {
    const out: { geometry: THREE.BufferGeometry; material: THREE.Material }[] = [];
    GRASS_KINDS.forEach((k, i) => {
      prepareAlphaMap(alphas[i], FOLIAGE_ALPHA_TEST);
      const tufts = extractVariants(gltfs[i].scene, { alphaMap: alphas[i] });
      const material = tufts[0].parts[0].material;
      // El vaivén de las hojas mide desde el centro de la copa; en una mata de 30 cm hay que
      // apagar ese reparto para que la brizna se doble entera.
      if (GRASS_WIND > 0) addWindSway(material as THREE.MeshStandardMaterial, GRASS_WIND, registry, [0, 0.02]);
      liftNormals(material as THREE.MeshStandardMaterial, GRASS_LIFT);
      const geos = tufts.map((t) => t.parts[0].geometry);
      for (let v = 0; v < GRASS_VARIANTS; v++) {
        out.push({ geometry: buildClump(i * 10 + v + 1, geos, { count: [...k.tufts] as [number, number], radius: k.radius, scale: k.tuftScale }), material });
      }
    });
    return out;
  }, [gltfs, alphas, registry]);

  const meshes = useRef<THREE.InstancedMesh[]>([]);
  const cells = useRef(new Map<string, Placed[]>());
  const timer = useRef(10);
  const logged = useRef(false);

  useMemo(() => { for (const sh of shapes) registerStandardMaterial(sh.material); }, [shapes]);

  useFrame(({ camera }, dt) => {
    // Reloj propio acumulado por dt: con frameloop="never" + FrameLimiter el de R3F da saltos,
    // y un salto en el tiempo del viento es justo lo que hace que el pasto tiemble.
    for (const s of registry) {
      s.uniforms.uTime.value = weatherClock.t;
      s.uniforms.uWind.value = weather.params.wind;
      s.uniforms.uWindDir.value.copy(windDir);
    }
    timer.current += dt;
    if (timer.current < 0.4) return;
    timer.current = 0;

    const cx = camera.position.x, cz = camera.position.z;
    const reach = GRASS_FAR + GRASS_CELL;
    const i0 = Math.floor((cx - reach) / GRASS_CELL), i1 = Math.floor((cx + reach) / GRASS_CELL);
    const j0 = Math.floor((cz - reach) / GRASS_CELL), j1 = Math.floor((cz + reach) / GRASS_CELL);
    const counts = new Array(shapes.length).fill(0);
    const live = new Set<string>();
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        // la celda entra si alguna esquina cae dentro del radio
        if (Math.hypot((i + 0.5) * GRASS_CELL - cx, (j + 0.5) * GRASS_CELL - cz) > GRASS_FAR + GRASS_CELL * 0.71) continue;
        const key = `${i},${j}`;
        live.add(key);
        let items = cells.current.get(key);
        if (!items) cells.current.set(key, (items = grassCell(i, j)));
        for (const it of items) {
          const d = Math.hypot(it.x - cx, it.z - cz);
          if (it.rank! > grassDensityAt(d)) continue;
          const sh = it.kind * GRASS_VARIANTS + it.variant;
          const n = counts[sh];
          if (n >= GRASS_CAPACITY) continue;
          dummy.position.set(it.x, it.y, it.z);
          dummy.rotation.set(0, it.rot, 0);
          dummy.scale.setScalar(it.scale);
          dummy.updateMatrix();
          meshes.current[sh]?.setMatrixAt(n, dummy.matrix);
          counts[sh] = n + 1;
        }
      }
    }
    for (const key of cells.current.keys()) if (!live.has(key)) cells.current.delete(key);
    shapes.forEach((_, i) => {
      const m = meshes.current[i];
      if (!m) return;
      m.count = counts[i];
      m.instanceMatrix.needsUpdate = true;
    });
    if (!logged.current) {
      logged.current = true;
      const tris = shapes.reduce((a, sh, i) => a + counts[i] * (sh.geometry.getIndex()!.count / 3), 0);
      console.info(`[isla] pasto: ${counts.reduce((a, b) => a + b, 0)} matas a la vista, ${Math.round(tris / 1000)}k triángulos`);
    }
  });

  return (
    <group>
      {shapes.map((sh, i) => (
        <instancedMesh key={i} ref={(el) => { if (el) meshes.current[i] = el; }} args={[sh.geometry, sh.material, GRASS_CAPACITY]} frustumCulled={false} count={0} receiveShadow />
      ))}
    </group>
  );
}

for (const k of GRASS_KINDS) useGLTF.preload(k.url);
for (const k of TREE_KINDS) { useGLTF.preload(k.lod1); useGLTF.preload(k.lod2); }
for (const k of FLORA_KINDS) useGLTF.preload(k.url);
for (const k of FLOWER_KINDS) useGLTF.preload(k.url);
for (const k of ROCK_KINDS) { useGLTF.preload(k.lod1); useGLTF.preload(k.lod2); }
for (const k of LOG_KINDS) { useGLTF.preload(k.lod1); useGLTF.preload(k.lod2); }
