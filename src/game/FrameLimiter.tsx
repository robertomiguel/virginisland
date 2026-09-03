'use client';
import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';

/** Con el Canvas en frameloop="never", este componente avanza el render a un máximo de `fps`. */
export function FrameLimiter({ fps }: { fps: number }) {
  const advance = useThree((s) => s.advance);

  useEffect(() => {
    const interval = 1000 / fps;
    let last = performance.now();
    let raf = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      const elapsed = t - last;
      if (elapsed >= interval - 0.5) {
        last = t - (elapsed % interval); // compensa la deriva del rAF
        advance(t);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [advance, fps]);

  return null;
}
