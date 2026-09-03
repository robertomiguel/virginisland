'use client';
import { useEffect, useState } from 'react';
import { weather, type WeatherKind } from './weather';

const NAMES: Record<WeatherKind, string> = { despejado: 'Despejado', pocasNubes: 'Pocas nubes', cubierto: 'Cubierto', tormenta: 'Tormenta' };

export function WeatherLabel() {
  const [kind, setKind] = useState<WeatherKind>(weather.kind);
  useEffect(() => {
    const id = setInterval(() => setKind(weather.kind), 1000);
    return () => clearInterval(id);
  }, []);
  return <div className="muted">Clima: {NAMES[kind]}{weather.locked ? ' (fijado por URL)' : ''}</div>;
}
