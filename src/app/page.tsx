'use client';
import dynamic from 'next/dynamic';

const GameCanvas = dynamic(() => import('@/game/GameCanvas').then((m) => m.GameCanvas), {
  ssr: false,
  loading: () => <div className="loading">Cargando isla…</div>,
});

export default function Home() {
  return <GameCanvas />;
}
