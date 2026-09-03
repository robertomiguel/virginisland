'use client';
import { useEffect, useState } from 'react';
import { LOAD_PHASES, loading } from '../loading';

export function Loader() {
  const [state, setState] = useState({ phase: loading.phase, stage: loading.stage, done: loading.done });
  useEffect(() => {
    const id = setInterval(() => setState({ phase: loading.phase, stage: loading.stage, done: loading.done }), 120);
    return () => clearInterval(id);
  }, []);
  if (state.done) return null;
  const pct = Math.round((state.stage / (LOAD_PHASES.length - 1)) * 100);
  return (
    <div className="loader">
      <div className="loader-card">
        <div className="spinner" />
        <div className="loader-title">Generando la isla</div>
        <div className="loader-phase">{state.phase}…</div>
        <div className="loader-bar"><div style={{ width: `${pct}%` }} /></div>
      </div>
    </div>
  );
}
