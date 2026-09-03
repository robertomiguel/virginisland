// GLSL compartido: ruido y densidad de nubes (la misma función pinta las nubes y sus sombras).
export const noiseGLSL = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm5(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 7.1; a *= 0.5; }
    return s;
  }
`;

/** Requiere uniforms: cloudTime, cloudOffset (deriva acumulada en metros), cloudCoverage. */
export const cloudGLSL = /* glsl */ `
  uniform float cloudTime;
  uniform vec2 cloudOffset;
  uniform float cloudCoverage;

  // Grosor continuo de la capa (ruido sin umbral, 0..1) para un punto XZ del mundo
  float cloudRaw(vec2 xz) {
    vec2 p = (xz + cloudOffset) * 0.0011;
    float warp = fbm5(p * 1.7 + 31.0 + cloudTime * 0.0012);
    return fbm5(p + (warp - 0.5) * 0.45);
  }
  // Densidad (cobertura) en [0,1]: 0 → sin nubes, 0.5 → mitad del cielo, 1 → tapado del todo
  float cloudDensity(vec2 xz) {
    float d = cloudRaw(xz);
    float lo = 0.80 - cloudCoverage * 0.66;
    return smoothstep(lo, lo + 0.18, d);
  }
`;

/** Ondas de impacto de la lluvia: anillos que se expanden desde puntos aleatorios. Devuelve una perturbación de normal en XZ. */
export const rainGLSL = /* glsl */ `
  // Anillos de impacto: devuelve (nx, nz, línea). nx/nz perturban la normal; 'línea' es el brillo del frente (0..1)
  // sizeMul: 1 = tamaño real (anillos de ~1.5 m); mayor para que se lean desde lejos
  vec3 rainRipples(vec2 xz, float t, float amount, float sizeMul) {
    vec2 grad = vec2(0.0);
    float line = 0.0;
    for (int layer = 0; layer < 3; layer++) {
      float cellM = (layer == 0 ? 2.6 : layer == 1 ? 1.5 : 0.9) * sizeMul; // tamaño de celda en metros
      vec2 sp = xz / cellM + float(layer) * 37.0;
      vec2 cell = floor(sp);
      vec2 f = fract(sp) - 0.5;
      for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
        vec2 c = cell + vec2(float(i), float(j));
        float h1 = fract(sin(dot(c, vec2(127.1, 311.7))) * 43758.5453);
        float h2 = fract(sin(dot(c, vec2(269.5, 183.3))) * 43758.5453);
        vec2 center = vec2(float(i), float(j)) + (vec2(h1, h2) - 0.5) * 0.7;
        vec2 d = (f - center) * cellM / sizeMul;   // metros normalizados al tamaño del anillo
        float r = length(d);
        float period = 1.3 + h1 * 0.8;
        float age = mod(t * (0.9 + h2 * 0.4) + h1 * 7.0, period);  // segundos desde el impacto
        float radius = age * 1.1;                     // el frente avanza ~1.1 m/s
        float front = r - radius;
        float envelope = exp(-r * 0.9) * exp(-age * 1.4) * step(front, 0.0);
        float ring = exp(-front * front * 18.0);      // banda del frente
        float rings = sin(front * 16.0) * exp(-front * front * 9.0); // 2-3 anillos tras el frente
        grad += (d / max(r, 1e-3)) * rings * envelope;
        line = max(line, ring * envelope * 1.6);
      }
    }
    return vec3(grad * amount * 1.6, min(1.0, line) * amount);
  }
`;
