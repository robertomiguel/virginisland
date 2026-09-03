'use client';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Clouds } from './Clouds';
import { Sun } from './Sun';
import { SkyDome } from './SkyDome';
import { updateCloudMotion, updateWeather, weather } from '../weather';
import { WIND } from '../config';

const windDir = new THREE.Vector2(...WIND.dir).normalize();

/** Avanza el clima y aplica la niebla (el resto lo leen los shaders directamente). */
function WeatherController() {
  const scene = useThree((s) => s.scene);
  useFrame(({ clock }, dt) => {
    const step = Math.min(dt, 0.1);
    updateWeather(clock.getElapsedTime(), step);
    updateCloudMotion(step, windDir.x, windDir.y);
    const p = weather.params;
    const fog = scene.fog as THREE.Fog | null;
    if (fog) {
      fog.color.setRGB(p.fog[0], p.fog[1], p.fog[2]);
      fog.far = p.fogFar;
      fog.near = p.fogFar * 0.27;
    }
  });
  return null;
}

export function Environment({ sunDir }: { sunDir: THREE.Vector3 }) {
  return (
    <>
      <fog attach="fog" args={['#b3d4f0', 700, 2600]} />
      <WeatherController />
      <SkyDome sunDir={sunDir} />
      <Sun sunDir={sunDir} />
      <Clouds sunDir={sunDir} />
    </>
  );
}
