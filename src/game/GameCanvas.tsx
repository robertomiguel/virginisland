'use client';
import { Suspense, useEffect, useState } from 'react';
import { Loader } from './ui/Loader';
import { ControlPanel } from './ui/ControlPanel';
import { Canvas } from '@react-three/fiber';
import { Scene } from './Scene';
import { FrameLimiter } from './FrameLimiter';
import { MAX_DPR, TARGET_FPS, urlVec } from './config';
import { WeatherLabel } from './WeatherLabel';

const lowView = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('vista') === 'horizonte';

export function GameCanvas() {
  // La escena se monta tras pintar la pantalla de carga; si no, el navegador queda en negro durante la generación.
  const [mount, setMount] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setTimeout(() => setMount(true), 30));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div className="game-root">
      <Canvas
        frameloop="never"
        dpr={[1, MAX_DPR]}
        camera={{ fov: 60, near: 0.5, far: 5000, position: urlVec('cam') ?? (lowView ? [330, 30, 420] : [260, 140, 380]) }}
        gl={{ antialias: true }}
        shadows="percentage"
      >
        <FrameLimiter fps={TARGET_FPS} />
        {mount && (
          <Suspense fallback={null}>
            <Scene />
          </Suspense>
        )}
      </Canvas>
      <Loader />
      <ControlPanel />
      <div className="hint-box">
        <div>Arrastrar: orbitar · Rueda: zoom · Botón derecho: desplazar</div>
        <WeatherLabel />
      </div>
    </div>
  );
}
