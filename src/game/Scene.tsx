'use client';
import { Suspense, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { setPhase } from './loading';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { SUN_DIRECTION, WATER_LEVEL } from './config';
import { LAKE, lakeOutline } from './island';
import { Environment } from './world/Environment';
import { Terrain, buildHeightmap } from './world/Terrain';
import { Ocean, StillWater } from './world/Water';
import { OceanPhysics } from './world/OceanPhysics';
import { River } from './world/River';
import { CameraBounds } from './CameraBounds';
import { Flora, Flowers, Grass, Logs, Rocks, Trees } from './world/Vegetation';
import { generateTrees } from './vegetation';
import { Lights } from './world/Lights';
import { Ship } from './world/Ship';
import { Castle } from './world/Fort';
import { Bridge } from './world/Bridge';
import { PlanarReflection, reflections, reflectionsEnabled } from './world/Reflection';
import { WORLD_RADIUS, CAMERA_MAX_DISTANCE, urlVec } from './config';
import { useNavigationMode } from './navigation';
import { WalkControls } from './WalkControls';

/** Avanza una etapa de montaje por fotograma para que el mundo aparezca progresivamente. */
function Stager({ stage, onAdvance, max }: { stage: number; onAdvance: (s: number) => void; max: number }) {
  useFrame(() => {
    if (stage < max) onAdvance(stage + 1);
  });
  return null;
}

export function Scene() {
  const navMode = useNavigationMode();
  const [stage, setStage] = useState(0);
  const advance = (s: number) => { setPhase(s); setStage(s); };
  const sunDir = useMemo(() => new THREE.Vector3(...SUN_DIRECTION).normalize(), []);
  const trees = useMemo(() => generateTrees(), []);
  const heightmap = useMemo(() => buildHeightmap(trees), [trees]);

  return (
    <>
      <Stager stage={stage} onAdvance={advance} max={6} />
      <Environment sunDir={sunDir} />
      <Lights sunDir={sunDir} />
      <Suspense fallback={null}>
        <Terrain sunDir={sunDir} heightmap={heightmap} />
      </Suspense>
      <OceanPhysics />
      <Ocean heightmap={heightmap} sunDir={sunDir} level={WATER_LEVEL} />
      {stage >= 1 && (
        <>
          <StillWater heightmap={heightmap} sunDir={sunDir} level={LAKE.level} outline={lakeOutline()} />
          <River sunDir={sunDir} heightmap={heightmap} />
          {reflectionsEnabled() && (
            <>
              <PlanarReflection level={WATER_LEVEL} slot={reflections.sea} every={1} />
              <PlanarReflection level={LAKE.level} slot={reflections.lake} every={2} phase={1} center={[LAKE.x, LAKE.z]} maxDistance={320} />
            </>
          )}
        </>
      )}
      {stage >= 2 && <Suspense fallback={null}><Trees items={trees} /></Suspense>}
      {stage >= 3 && <Suspense fallback={null}><Flora /></Suspense>}
      {stage >= 4 && <Suspense fallback={null}><Rocks /><Logs /><Ship /><Castle /><Bridge /></Suspense>}
      {stage >= 5 && <Suspense fallback={null}><Grass /><Flowers /></Suspense>}
      <OrbitControls
        makeDefault
        enabled={navMode === 'orbit'}
        target={urlVec('mira') ?? (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('vista') === 'horizonte' ? [0, 60, 0] : [0, 10, 0])}
        enableDamping
        dampingFactor={0.08}
        maxPolarAngle={Math.PI / 2 - 0.03}
        minDistance={10}
        maxDistance={CAMERA_MAX_DISTANCE}
        screenSpacePanning={false}
      />
      {navMode === 'orbit' && <CameraBounds radius={WORLD_RADIUS} />}
      {navMode === 'walk' && <WalkControls />}
    </>
  );
}
