'use client';
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { FLORA_KINDS, FLOWER_KINDS, GRASS_MODEL, GRASS_VARIANTS, LOG_KINDS, ROCK_KINDS, TREE_KINDS, TREE_NEAR, generateFlora, generateGrass, generateLogs, generateRocks, type Placed } from '../vegetation';
import { WIND } from '../config';
import { weather } from '../weather';
import { FOLIAGE_ALPHA_TEST, extractVariants, matchFoliage, type Variant } from './variants';
import { prepareAlphaMap } from './alphaMips';
import { addWindSway } from './windShader';
import { buildMossClump } from './grass';
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
    return extractVariants(gltf.scene, { alphaMap: alpha }).map((v) => ({ near: v }));
  }, [gltf, alpha]);
  useEffect(() => onVariants?.(variants.length), [variants, onVariants]);
  const mine = useMemo(() => items.filter((t) => t.kind === kind).map((t) => ({ ...t, variant: t.variant % variants.length })), [items, kind, variants.length]);
  return <InstancedLayer items={mine} variants={variants} nearDist={Infinity} maxDist={160} />;
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

// --- Pasto y flores ------------------------------------------------------------------------
const GRASS_WIND = 0.012; // 0 para apagar el vaivén del pasto

export function Grass() {
  const items = useMemo(() => generateGrass(), []);
  const registry = useMemo<THREE.WebGLProgramParametersWithUniforms[]>(() => [], []);
  const gltf = useGLTF(GRASS_MODEL.url);
  const alpha = useLoader(THREE.TextureLoader, GRASS_MODEL.alpha);
  const grassVariants = useMemo(() => {
    prepareAlphaMap(alpha, FOLIAGE_ALPHA_TEST);
    // Los matojos del modelo miden ~3 cm: se agrandan y se agrupan en matas del tamaño del pasto
    const tufts = extractVariants(gltf.scene, { alphaMap: alpha });
    const material = tufts[0].parts[0].material;
    if (GRASS_WIND > 0) addWindSway(material as THREE.MeshStandardMaterial, GRASS_WIND, registry);
    const geos = tufts.map((t) => t.parts[0].geometry);
    return Array.from({ length: GRASS_VARIANTS }, (_, i) => ({
      near: { parts: [{ geometry: buildMossClump(i + 1, geos, GRASS_MODEL.tuftScale), material }], baseY: 0 } as Variant,
    }));
  }, [gltf, alpha, registry]);
  const grass = useMemo(() => items.filter((t) => t.kind === 0), [items]);
  const flowers = useMemo(() => items.filter((t) => t.kind === 1), [items]);
  useEffect(() => { console.info(`[isla] matas de pasto: ${grass.length}, flores: ${flowers.length}`); }, [grass, flowers]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    for (const s of registry) {
      s.uniforms.uTime.value = t;
      s.uniforms.uWind.value = weather.params.wind;
      s.uniforms.uWindDir.value.copy(windDir);
    }
  });

  return (
    <group>
      <InstancedLayer items={grass} variants={grassVariants} nearDist={Infinity} maxDist={75} />
      {FLOWER_KINDS.map((_, i) => (
        <Suspense key={i} fallback={null}><FlowerKind items={flowers} kind={i} /></Suspense>
      ))}
    </group>
  );
}

useGLTF.preload(GRASS_MODEL.url);
for (const k of TREE_KINDS) { useGLTF.preload(k.lod1); useGLTF.preload(k.lod2); }
for (const k of FLORA_KINDS) useGLTF.preload(k.url);
for (const k of FLOWER_KINDS) useGLTF.preload(k.url);
for (const k of ROCK_KINDS) { useGLTF.preload(k.lod1); useGLTF.preload(k.lod2); }
for (const k of LOG_KINDS) { useGLTF.preload(k.lod1); useGLTF.preload(k.lod2); }
