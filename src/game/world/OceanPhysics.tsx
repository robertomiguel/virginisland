'use client';
import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { WIND } from '../config';
import { weather } from '../weather';
import { OceanSim, oceanSimHolder } from './oceanSim';

/** Ejecuta la simulación espectral del mar en GPU cada fotograma (antes del render de la escena). */
export function OceanPhysics() {
  const sim = useMemo(() => {
    const d = WIND.dir;
    const l = Math.hypot(d[0], d[1]) || 1;
    return new OceanSim(weather.params.wind, [d[0] / l, d[1] / l]);
  }, []);
  useEffect(() => {
    oceanSimHolder.sim = sim;
    return () => { oceanSimHolder.sim = null; };
  }, [sim]);
  useFrame(({ gl }, dt) => {
    const step = Math.min(dt, 0.05);
    sim.setWind(weather.params.wind, sim.time);
    sim.update(gl, step);
  }, -1);
  return null;
}
