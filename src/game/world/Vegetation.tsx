'use client';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { FLORA_KINDS, FLOWER_COLORS, GRASS_VARIANTS, LOG_KINDS, PALM_VARIANTS, ROCK_KINDS, generateFlora, generateGrass, generateLogs, generateRocks, type Placed } from '../vegetation';
import { WIND } from '../config';
import { weather } from '../weather';
import { extractVariants, type Variant } from './variants';
import { buildPalm } from './palm';
import { buildFlower, buildGrassClump } from './grass';
import { ISLAND_TREE, JACARANDA, buildTree, type TreeSpec } from './tree';

const windDir = new THREE.Vector2(...WIND.dir).normalize();
const dummy = new THREE.Object3D();

/**
 * Capa instanciada genérica: `variants[v]` tiene piezas cercanas y (opcionalmente) lejanas.
 * Cada 0.4 s se reparten los elementos por distancia a la cámara.
 */
function InstancedLayer({ items, variants, nearDist, maxDist }: { items: Placed[]; variants: { near: Variant; far?: Variant }[]; nearDist: number; maxDist: number }) {
  const refs = useRef<{ near: THREE.InstancedMesh[]; far: THREE.InstancedMesh[] }[]>(variants.map(() => ({ near: [], far: [] })));
  const timer = useRef(10);
  const counts = useMemo(() => variants.map((_, v) => items.filter((it) => it.variant === v).length), [items, variants]);

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
            <instancedMesh key={`n${i}`} ref={(el) => { if (el) refs.current[v].near[i] = el; }} args={[p.geometry, p.material, Math.max(1, counts[v])]} frustumCulled={false} count={0} />
          ))}
          {vr.far?.parts.map((p, i) => (
            <instancedMesh key={`f${i}`} ref={(el) => { if (el) refs.current[v].far[i] = el; }} args={[p.geometry, p.material, Math.max(1, counts[v])]} frustumCulled={false} count={0} />
          ))}
        </group>
      ))}
    </group>
  );
}

// --- Árboles -------------------------------------------------------------------------------
const TREE_VARIANTS = 6;

function ProceduralTrees({ items, kind, spec, leafBase }: { items: Placed[]; kind: 0 | 1; spec: TreeSpec; leafBase: string }) {
  const [barkDiff, barkNor, leafDiff, leafAlpha, leafNor] = useLoader(THREE.TextureLoader, [
    '/textures/island_tree_01_bark_diff.jpg', '/textures/island_tree_01_bark_nor.jpg',
    `/textures/${leafBase}_diff.jpg`, `/textures/${leafBase}_alpha.jpg`, `/textures/${leafBase}_nor.jpg`,
  ]);
  const variants = useMemo(() => {
    barkDiff.wrapS = barkDiff.wrapT = barkNor.wrapS = barkNor.wrapT = THREE.RepeatWrapping;
    barkDiff.colorSpace = leafDiff.colorSpace = THREE.SRGBColorSpace;
    leafDiff.anisotropy = leafAlpha.anisotropy = 4;
    const barkMat = new THREE.MeshStandardMaterial({ map: barkDiff, normalMap: barkNor, roughness: 0.95, name: 'bark' });
    const leafMat = new THREE.MeshStandardMaterial({ map: leafDiff, alphaMap: leafAlpha, normalMap: leafNor, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8, name: 'leaves' });
    return Array.from({ length: TREE_VARIANTS }, (_, i) => ({ near: buildTree(spec, kind * 100 + i + 1, barkMat, leafMat) }));
  }, [barkDiff, barkNor, leafDiff, leafAlpha, leafNor, spec, kind]);
  const mine = useMemo(() => items.filter((t) => t.kind === kind).map((t) => ({ ...t, variant: t.variant % TREE_VARIANTS })), [items, kind]);
  return <InstancedLayer items={mine} variants={variants} nearDist={Infinity} maxDist={Infinity} />;
}

// Desactivado hasta tener un modelo de palmera mejor
export function Palms({ items }: { items: Placed[] }) {
  const [bark, barkNor] = useLoader(THREE.TextureLoader, ['/textures/bark_brown_02_diff.jpg', '/textures/bark_brown_02_nor.jpg']);
  const variants = useMemo(() => {
    bark.wrapS = bark.wrapT = barkNor.wrapS = barkNor.wrapT = THREE.RepeatWrapping;
    bark.colorSpace = THREE.SRGBColorSpace;
    return Array.from({ length: PALM_VARIANTS }, (_, i) => ({ near: buildPalm(bark, barkNor, i + 1) }));
  }, [bark, barkNor]);
  const mine = useMemo(() => items.filter((t) => t.kind === 2), [items]);
  return <InstancedLayer items={mine} variants={variants} nearDist={Infinity} maxDist={Infinity} />;
}

export function Trees({ items }: { items: Placed[] }) {
  useEffect(() => { console.info(`[isla] árboles: ${items.length} (jacarandas ${items.filter((t) => t.kind === 0).length}, anchos ${items.filter((t) => t.kind === 1).length}, palmeras ${items.filter((t) => t.kind === 2).length})`); }, [items]);
  return (
    <group>
      <ProceduralTrees items={items} kind={0} spec={JACARANDA} leafBase="jacaranda_leaves" />
      <ProceduralTrees items={items} kind={1} spec={ISLAND_TREE} leafBase="island_tree_01_leaves" />
    </group>
  );
}

// --- Flora baja ----------------------------------------------------------------------------
function FloraKind({ items, kind, onVariants }: { items: Placed[]; kind: number; onVariants?: (n: number) => void }) {
  const k = FLORA_KINDS[kind];
  const gltf = useGLTF(k.url);
  const alpha = useLoader(THREE.TextureLoader, k.alpha);
  const variants = useMemo(() => {
    alpha.flipY = false; // las texturas de glTF no se voltean
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
  return <InstancedLayer items={mine} variants={variants} nearDist={120} maxDist={Infinity} />;
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
  return <InstancedLayer items={mine} variants={variants} nearDist={120} maxDist={Infinity} />;
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

// --- Pasto y flores ------------------------------------------------------------------------
const GRASS_WIND = 0.012; // 0 para apagar el vaivén del pasto

export function Grass() {
  const items = useMemo(() => generateGrass(), []);
  const registry = useMemo<THREE.WebGLProgramParametersWithUniforms[]>(() => [], []);
  const grassVariants = useMemo(() => Array.from({ length: GRASS_VARIANTS }, (_, i) => ({ near: buildGrassClump(i + 1, registry, GRASS_WIND) })), [registry]);
  const flowerVariants = useMemo(() => FLOWER_COLORS.map((c, i) => ({ near: buildFlower(i + 1, c, registry, GRASS_WIND) })), [registry]);
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
      <InstancedLayer items={flowers} variants={flowerVariants} nearDist={Infinity} maxDist={60} />
    </group>
  );
}

for (const k of FLORA_KINDS) useGLTF.preload(k.url);
for (const k of ROCK_KINDS) { useGLTF.preload(k.lod1); useGLTF.preload(k.lod2); }
for (const k of LOG_KINDS) { useGLTF.preload(k.lod1); useGLTF.preload(k.lod2); }
