'use client';
import { useEffect, useState } from 'react';
import { WEATHER_PRESETS, autoWeather, daytime, manual, setAutoWeather, setManualParams, setWeather, weather, type WeatherKind } from '../weather';

const PRESETS: { kind: WeatherKind; label: string }[] = [
  { kind: 'despejado', label: 'Despejado' }, { kind: 'pocasNubes', label: 'Pocas nubes' }, { kind: 'cubierto', label: 'Cubierto' },
  { kind: 'llovizna', label: 'Garúa' }, { kind: 'aguacero', label: 'Aguacero' }, { kind: 'tormenta', label: 'Tormenta' },
];

function Slider({ label, value, min, max, step, onChange, format }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  return (
    <label className="cp-row">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} />
      <em>{format ? format(value) : value.toFixed(2)}</em>
    </label>
  );
}

export function ControlPanel() {
  const [open, setOpen] = useState(false);
  const [, tick] = useState(0);
  // refresco periódico para reflejar el clima automático
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 250); return () => clearInterval(id); }, []);

  const p = manual.enabled ? weather.target : weather.params;
  const set = (partial: Parameters<typeof setManualParams>[0]) => { setManualParams(partial); tick((n) => n + 1); };
  const hh = Math.floor(daytime.hour), mm = Math.floor((daytime.hour - hh) * 60);

  return (
    <div className={`cp ${open ? 'open' : ''}`}>
      <button className="cp-toggle" onClick={() => setOpen(!open)}>{open ? 'Cerrar' : 'Clima y hora'}</button>
      {open && (
        <div className="cp-body">
          <div className="cp-section">
            <div className="cp-title">Hora del día <em>{`${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`}</em></div>
            <Slider label="Hora" value={daytime.hour} min={0} max={24} step={0.05} onChange={(v) => { daytime.hour = v; tick((n) => n + 1); }} format={(v) => `${Math.floor(v)}h`} />
            <label className="cp-check"><input type="checkbox" checked={daytime.auto} onChange={(e) => { daytime.auto = e.target.checked; tick((n) => n + 1); }} /> Reloj en marcha</label>
            {daytime.auto && <Slider label="Velocidad" value={daytime.hoursPerMinute} min={0.25} max={30} step={0.25} onChange={(v) => { daytime.hoursPerMinute = v; tick((n) => n + 1); }} format={(v) => `${v} h/min`} />}
          </div>

          <div className="cp-section">
            <div className="cp-title">Clima <em>{manual.enabled ? 'manual' : autoWeather.enabled ? `automático · ${weather.kind}` : `fijo · ${weather.kind}`}</em></div>
            <div className="cp-presets">
              {PRESETS.map((pr) => (
                <button key={pr.kind} className={weather.kind === pr.kind ? 'on' : ''} onClick={() => { manual.enabled = false; autoWeather.enabled = false; setWeather(pr.kind, 5); tick((n) => n + 1); }}>{pr.label}</button>
              ))}
              <button className={autoWeather.enabled && !manual.enabled ? 'on' : ''} onClick={() => { setAutoWeather(); tick((n) => n + 1); }}>Automático</button>
            </div>
          </div>

          <div className="cp-section">
            <div className="cp-title">Nubes</div>
            <Slider label="Cobertura" value={p.coverage} min={0} max={1} step={0.01} onChange={(v) => set({ coverage: v })} />
            <Slider label="Oscuridad" value={p.darkness} min={0} max={1} step={0.01} onChange={(v) => set({ darkness: v })} />
            <Slider label="Luz solar" value={p.sun} min={0} max={1} step={0.01} onChange={(v) => set({ sun: v })} />
          </div>

          <div className="cp-section">
            <div className="cp-title">Viento</div>
            <Slider label="Velocidad" value={p.wind} min={0} max={30} step={0.5} onChange={(v) => set({ wind: v })} format={(v) => `${v} m/s`} />
            <Slider label="Oleaje" value={p.waves} min={0} max={2.5} step={0.05} onChange={(v) => set({ waves: v })} format={(v) => `${v.toFixed(2)}×`} />
          </div>

          <div className="cp-section">
            <div className="cp-title">Lluvia</div>
            <Slider label="Intensidad" value={p.rain} min={0} max={1} step={0.01} onChange={(v) => set({ rain: v })} />
            <Slider label="Rayos" value={p.lightning} min={0} max={0.5} step={0.01} onChange={(v) => set({ lightning: v })} format={(v) => `${(v * 60).toFixed(0)}/min`} />
            <Slider label="Niebla" value={p.fogFar} min={300} max={3000} step={50} onChange={(v) => set({ fogFar: v })} format={(v) => `${v} m`} />
          </div>
          <div className="cp-hint">{Object.keys(WEATHER_PRESETS).length} presets. Mover un deslizador pasa a modo manual. "Automático" cambia de clima cada 1 a 4 minutos.</div>
        </div>
      )}
    </div>
  );
}
