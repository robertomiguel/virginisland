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

  // Densidad de nube en [0,1] para un punto XZ del mundo (a la altura de la capa)
  float cloudDensity(vec2 xz) {
    vec2 p = (xz + cloudOffset) * 0.0011;
    float warp = fbm5(p * 1.7 + 31.0 + cloudTime * 0.0012);
    float d = fbm5(p + (warp - 0.5) * 0.45);
    float lo = 0.62 - cloudCoverage * 0.32;
    return smoothstep(lo, lo + 0.28, d);
  }
`;
