import * as THREE from 'three';

/**
 * Mipmaps que conservan la cobertura del recorte alfa.
 *
 * Al alejarse, GL promedia el alfa de la textura de hojas: los téxeles quedan por debajo de
 * `alphaTest` y la copa se deshace, así que se ve el cielo (y las nubes) a través del árbol.
 * Aquí cada nivel se reescala para que la fracción de téxeles que superan el umbral sea la misma
 * que en el nivel 0, de modo que el follaje mantiene su densidad a cualquier distancia.
 *
 * El mapa alfa se muestrea por el canal verde (así lo hace `alphaMap` en three).
 */
export function coverageMipmaps(tex: THREE.Texture, alphaTest: number) {
  if (typeof document === 'undefined') return;
  if (tex.userData.coverageMips) return; // `useLoader` comparte la textura entre modelos
  const img = tex.image as CanvasImageSource & { width: number; height: number };
  if (!img?.width) return;
  tex.userData.coverageMips = true;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  canvas.width = img.width;
  canvas.height = img.height;
  ctx.drawImage(img, 0, 0);
  const base = ctx.getImageData(0, 0, img.width, img.height);

  const cut = alphaTest * 255;
  const coverage = (d: ImageData, scale: number) => {
    let n = 0;
    for (let i = 1; i < d.data.length; i += 4) if (d.data[i] * scale >= cut) n++;
    return n / (d.data.length / 4);
  };
  const target = coverage(base, 1);

  const mipmaps: ImageData[] = [base];
  let prev = base;
  while (prev.width > 1 || prev.height > 1) {
    const w = Math.max(1, prev.width >> 1);
    const h = Math.max(1, prev.height >> 1);
    const next = new ImageData(w, h);
    // Filtro de caja sobre el nivel anterior (sin reescalar: el error no se acumula)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const x0 = Math.min(x * 2, prev.width - 1), x1 = Math.min(x * 2 + 1, prev.width - 1);
        const y0 = Math.min(y * 2, prev.height - 1), y1 = Math.min(y * 2 + 1, prev.height - 1);
        const o = (y * w + x) * 4;
        for (let c = 0; c < 4; c++) {
          next.data[o + c] = (
            prev.data[(y0 * prev.width + x0) * 4 + c] + prev.data[(y0 * prev.width + x1) * 4 + c] +
            prev.data[(y1 * prev.width + x0) * 4 + c] + prev.data[(y1 * prev.width + x1) * 4 + c]
          ) / 4;
        }
      }
    }
    prev = next;
    // Escala que devuelve al nivel la cobertura del original (búsqueda binaria)
    let lo = 0, hi = 6;
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      if (coverage(next, mid) < target) lo = mid; else hi = mid;
    }
    const scale = (lo + hi) / 2;
    const scaled = new ImageData(w, h);
    for (let i = 0; i < next.data.length; i += 4) {
      for (let c = 0; c < 3; c++) scaled.data[i + c] = Math.min(255, next.data[i + c] * scale);
      scaled.data[i + 3] = next.data[i + 3];
    }
    mipmaps.push(scaled);
  }

  tex.mipmaps = mipmaps as unknown as THREE.Texture['mipmaps'];
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
}

/** Prepara un mapa alfa de vegetación: sin voltear (glTF), nítido de refilón y con mipmaps de cobertura. */
export function prepareAlphaMap(tex: THREE.Texture, alphaTest: number): THREE.Texture {
  tex.flipY = false;          // las texturas de glTF no se voltean
  tex.anisotropy = 16;        // three lo recorta al máximo del equipo; caminando casi todo se ve de refilón
  tex.colorSpace = THREE.NoColorSpace;
  coverageMipmaps(tex, alphaTest);
  return tex;
}
