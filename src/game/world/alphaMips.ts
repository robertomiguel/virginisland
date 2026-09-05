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

/**
 * Rellena el fondo del mapa de color con el color de lo pintado ("dilatación").
 *
 * Los atlas de vegetación de Poly Haven traen la hoja (o la brizna) sobre FONDO NEGRO, y el recorte
 * lo pone el mapa alfa aparte. Eso vale en el nivel 0, pero al alejarse GL promedia téxeles: una
 * brizna de diez píxeles de ancho se mezcla con el negro de al lado y el pasto se ve como motas
 * negras aunque el alfa siga recortando bien la silueta. Aquí el fondo se rellena antes de generar
 * las mipmaps, empujando el color hacia fuera con una pirámide (se baja promediando solo lo pintado
 * y se vuelve a subir tapando los huecos con el nivel de arriba).
 */
export function dilateColorMap(color: THREE.Texture, alpha: THREE.Texture, alphaTest: number) {
  if (typeof document === 'undefined') return;
  if (color.userData.dilated) return;
  const img = color.image as CanvasImageSource & { width: number; height: number };
  const aImg = alpha.image as CanvasImageSource & { width: number; height: number };
  if (!img?.width || !aImg?.width) return;
  color.userData.dilated = true;

  const w0 = img.width, h0 = img.height;
  const draw = (src: CanvasImageSource, w: number, h: number) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(src, 0, 0, w, h);
    return { canvas: c, ctx, data: ctx.getImageData(0, 0, w, h) };
  };
  const col = draw(img, w0, h0);
  const alp = draw(aImg, w0, h0).data; // el alfa se estira al tamaño del color si no coinciden

  // Nivel 0 de la pirámide: color y peso (1 donde el alfa pinta)
  const levels: { w: number; h: number; rgb: Float32Array; wt: Float32Array }[] = [];
  const cut = alphaTest * 255;
  let rgb = new Float32Array(w0 * h0 * 3), wt = new Float32Array(w0 * h0);
  for (let i = 0; i < w0 * h0; i++) {
    const on = alp.data[i * 4 + 1] >= cut ? 1 : 0; // alphaMap se muestrea por el canal verde
    wt[i] = on;
    for (let c = 0; c < 3; c++) rgb[i * 3 + c] = col.data.data[i * 4 + c] * on;
  }
  levels.push({ w: w0, h: h0, rgb, wt });

  // Bajada: cada nivel promedia solo lo que tiene peso
  while (levels[levels.length - 1].w > 1 || levels[levels.length - 1].h > 1) {
    const p = levels[levels.length - 1];
    const w = Math.max(1, p.w >> 1), h = Math.max(1, p.h >> 1);
    rgb = new Float32Array(w * h * 3); wt = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = y * w + x;
        let sw = 0;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const px = Math.min(x * 2 + dx, p.w - 1), py = Math.min(y * 2 + dy, p.h - 1);
            const pi = py * p.w + px;
            sw += p.wt[pi];
            for (let c = 0; c < 3; c++) rgb[o * 3 + c] += p.rgb[pi * 3 + c];
          }
        }
        wt[o] = sw > 0 ? 1 : 0;
        if (sw > 0) for (let c = 0; c < 3; c++) rgb[o * 3 + c] /= sw;
      }
    }
    levels.push({ w, h, rgb, wt });
  }

  // Subida: donde no hay peso, se copia el color del nivel de arriba
  for (let l = levels.length - 2; l >= 0; l--) {
    const cur = levels[l], up = levels[l + 1];
    for (let y = 0; y < cur.h; y++) {
      for (let x = 0; x < cur.w; x++) {
        const o = y * cur.w + x;
        if (cur.wt[o] > 0) continue;
        const ui = Math.min(y >> 1, up.h - 1) * up.w + Math.min(x >> 1, up.w - 1);
        if (up.wt[ui] <= 0) continue;
        for (let c = 0; c < 3; c++) cur.rgb[o * 3 + c] = up.rgb[ui * 3 + c];
        cur.wt[o] = 1;
      }
    }
  }

  const base = levels[0];
  for (let i = 0; i < w0 * h0; i++) for (let c = 0; c < 3; c++) col.data.data[i * 4 + c] = base.rgb[i * 3 + c];
  col.ctx.putImageData(col.data, 0, 0);
  color.image = col.canvas;
  color.generateMipmaps = true;
  color.minFilter = THREE.LinearMipmapLinearFilter;
  color.needsUpdate = true;
}
