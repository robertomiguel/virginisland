import * as THREE from 'three';

/*
 * Océano espectral (Tessendorf) en WebGL2:
 *  1. h0(k) por espectro de Phillips según el viento (CPU, se regenera cuando cambia el viento, con fundido).
 *  2. Cada fotograma: h(k,t) y desplazamientos choppy en un pase; IFFT 2D radix-2 Stockham (ping-pong);
 *     pase final de normales y jacobiano (espuma por plegado de crestas).
 * Salida: textura de desplazamiento (dx, dy, dz) y textura de normales/espuma, repetibles en un parche de PATCH m.
 */

export const FFT_N = 256;
export const PATCH = 320; // metros del parche que se repite
const G = 9.81;

const fullscreenVert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const spectrumFrag = /* glsl */ `
  precision highp float;
  uniform sampler2D h0A, h0B;   // (h0(k).re, h0(k).im, h0(-k).re, h0(-k).im)
  uniform float blend;          // fundido A→B
  uniform float time;
  uniform float N, L;
  varying vec2 vUv;
  layout(location = 0) out vec4 outA; // h (complejo), Dx (complejo)
  layout(location = 1) out vec4 outB; // Dz (complejo)
  vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
  void main() {
    vec2 x = floor(vUv * N);
    vec2 k = 6.28318530718 * (x - N * 0.5) / L;
    float kl = length(k);
    vec4 h0 = mix(texture(h0A, vUv), texture(h0B, vUv), blend);
    float w = sqrt(G_CONST * kl);
    vec2 e = vec2(cos(w * time), sin(w * time));
    vec2 h = cmul(h0.xy, e) + cmul(vec2(h0.z, -h0.w), vec2(e.x, -e.y));
    vec2 dir = kl > 1e-5 ? k / kl : vec2(0.0);
    // D = -i * (k/|k|) * h
    vec2 dx = vec2(h.y, -h.x) * dir.x;
    vec2 dz = vec2(h.y, -h.x) * dir.y;
    outA = vec4(h, dx);
    outB = vec4(dz, 0.0, 0.0);
  }
`.replace('G_CONST', G.toFixed(2));

// IFFT radix-2 Stockham: cada fragmento calcula UNA salida a partir de dos entradas.
const fftFrag = /* glsl */ `
  precision highp float;
  uniform sampler2D srcA, srcB;
  uniform float N, Ns;         // Ns = 1, 2, 4, ... N/2
  uniform float horizontal;    // 1: a lo largo de x; 0: a lo largo de y
  varying vec2 vUv;
  layout(location = 0) out vec4 outA;
  layout(location = 1) out vec4 outB;
  vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
  void main() {
    vec2 px = floor(vUv * N);
    float o = horizontal > 0.5 ? px.x : px.y;
    float other = horizontal > 0.5 ? px.y : px.x;
    float R = 2.0;
    float q = floor(o / (Ns * R));
    float rem = o - q * Ns * R;
    float r = floor(rem / Ns);
    float m = rem - r * Ns;
    float j = q * Ns + m;
    float ang = 6.28318530718 * m / (Ns * R); // signo positivo: transformada inversa
    vec2 tw = vec2(cos(ang), sin(ang));
    vec2 uv0 = (horizontal > 0.5 ? vec2(j, other) : vec2(other, j)) + 0.5;
    vec2 uv1 = (horizontal > 0.5 ? vec2(j + N * 0.5, other) : vec2(other, j + N * 0.5)) + 0.5;
    vec4 a0 = texture(srcA, uv0 / N), a1 = texture(srcA, uv1 / N);
    vec4 b0 = texture(srcB, uv0 / N), b1 = texture(srcB, uv1 / N);
    vec2 a1h = cmul(a1.xy, tw), a1d = cmul(a1.zw, tw), b1d = cmul(b1.xy, tw);
    if (r < 0.5) { outA = vec4(a0.xy + a1h, a0.zw + a1d); outB = vec4(b0.xy + b1d, 0.0, 0.0); }
    else { outA = vec4(a0.xy - a1h, a0.zw - a1d); outB = vec4(b0.xy - b1d, 0.0, 0.0); }
  }
`;

const finalizeFrag = /* glsl */ `
  precision highp float;
  uniform sampler2D srcA, srcB;
  uniform float N;
  uniform float chop;
  varying vec2 vUv;
  layout(location = 0) out vec4 outDisp;
  void main() {
    vec2 px = floor(vUv * N);
    float sgn = mod(px.x + px.y, 2.0) < 0.5 ? 1.0 : -1.0; // centra el espectro
    float s = sgn / (N * N);
    vec4 a = texture(srcA, vUv);
    vec4 b = texture(srcB, vUv);
    outDisp = vec4(a.z * s * chop, a.x * s, b.x * s * chop, 0.0);
  }
`;

const normalFrag = /* glsl */ `
  precision highp float;
  uniform sampler2D disp;
  uniform float N, L;
  varying vec2 vUv;
  layout(location = 0) out vec4 outN;
  void main() {
    float t = 1.0 / N;
    float d = L / N;
    vec3 c = texture(disp, vUv).xyz;
    vec3 xp = texture(disp, vUv + vec2(t, 0.0)).xyz, xm = texture(disp, vUv - vec2(t, 0.0)).xyz;
    vec3 zp = texture(disp, vUv + vec2(0.0, t)).xyz, zm = texture(disp, vUv - vec2(0.0, t)).xyz;
    float dhdx = (xp.y - xm.y) / (2.0 * d);
    float dhdz = (zp.y - zm.y) / (2.0 * d);
    // Jacobiano del desplazamiento horizontal: < 0 donde la cresta se pliega (espuma)
    float jxx = 1.0 + (xp.x - xm.x) / (2.0 * d);
    float jzz = 1.0 + (zp.z - zm.z) / (2.0 * d);
    float jxz = (zp.x - zm.x) / (2.0 * d);
    float jzx = (xp.z - xm.z) / (2.0 * d);
    float J = jxx * jzz - jxz * jzx;
    float foam = clamp((0.55 - J) * 1.6, 0.0, 1.0);
    outN = vec4(-dhdx, -dhdz, foam, c.y);
  }
`;

function makeRT(n: number, count: number, wrap: THREE.Wrapping, filter: THREE.MagnificationTextureFilter) {
  const rt = new THREE.WebGLRenderTarget(n, n, {
    count,
    type: THREE.FloatType,
    format: THREE.RGBAFormat,
    minFilter: filter as THREE.MinificationTextureFilter,
    magFilter: filter,
    wrapS: wrap,
    wrapT: wrap,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
  });
  for (const t of rt.textures) { t.wrapS = t.wrapT = wrap; t.minFilter = filter as THREE.MinificationTextureFilter; t.magFilter = filter; t.generateMipmaps = false; }
  return rt;
}

/** Phillips: espectro de olas en mar abierto según el viento. */
function buildH0(N: number, L: number, windSpeed: number, windDir: [number, number], seed: number, targetSigma: number): THREE.DataTexture {
  let s = seed * 9301 + 49297;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const gauss = () => { const u = Math.max(1e-6, rnd()), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const V = Math.max(1.5, windSpeed);
  const Lw = (V * V) / G;                  // mayor ola posible para ese viento
  const l = Math.max(0.15, Lw * 0.003);    // corte de olas muy pequeñas
  const wx = windDir[0], wz = windDir[1];
  const h0 = new Float32Array(N * N * 2);
  for (let n = 0; n < N; n++) {
    for (let m = 0; m < N; m++) {
      const kx = (2 * Math.PI * (m - N / 2)) / L;
      const kz = (2 * Math.PI * (n - N / 2)) / L;
      const k2 = kx * kx + kz * kz;
      let p = 0;
      if (k2 > 1e-8) {
        const k = Math.sqrt(k2);
        const kdw = (kx * wx + kz * wz) / k;
        p = Math.exp(-1 / (k2 * Lw * Lw)) / (k2 * k2) * Math.pow(Math.abs(kdw), 4) * Math.exp(-k2 * l * l);
        if (kdw < 0) p *= 0.12; // apenas olas contra el viento
      }
      const a = Math.sqrt(p / 2);
      h0[(n * N + m) * 2] = gauss() * a;
      h0[(n * N + m) * 2 + 1] = gauss() * a;
    }
  }
  // Normalización: varianza de la altura = Σ(|h0(k)|²+|h0(-k)|²)/N⁴
  let sum = 0;
  for (let i = 0; i < N * N; i++) sum += h0[i * 2] ** 2 + h0[i * 2 + 1] ** 2;
  const sigma = Math.sqrt(2 * sum) / (N * N);
  const scale = sigma > 1e-9 ? targetSigma / sigma : 0;
  const data = new Float32Array(N * N * 4);
  for (let n = 0; n < N; n++) {
    for (let m = 0; m < N; m++) {
      const i = n * N + m;
      const mm = (N - m) % N, nn = (N - n) % N; // índice de -k
      const j = nn * N + mm;
      data[i * 4] = h0[i * 2] * scale;
      data[i * 4 + 1] = h0[i * 2 + 1] * scale;
      data[i * 4 + 2] = h0[j * 2] * scale;
      data[i * 4 + 3] = h0[j * 2 + 1] * scale;
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Altura significativa objetivo (σ de la superficie) según el viento, en metros. */
export function sigmaForWind(v: number): number {
  return Math.min(1.4, 0.012 * v * v * 0.35 + 0.02 * v); // 5 m/s → 0.2 m, 9 → 0.52, 16 → 1.4
}

export class OceanSim {
  readonly displacement: THREE.Texture;
  readonly normals: THREE.Texture;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;
  private spectrumMat: THREE.RawShaderMaterial;
  private fftMat: THREE.RawShaderMaterial;
  private finalizeMat: THREE.RawShaderMaterial;
  private normalMat: THREE.RawShaderMaterial;
  private ping: THREE.WebGLRenderTarget;
  private pong: THREE.WebGLRenderTarget;
  private dispRT: THREE.WebGLRenderTarget;
  private normRT: THREE.WebGLRenderTarget;
  private h0A: THREE.DataTexture;
  private h0B: THREE.DataTexture;
  private blend = 1;
  private windOfB = 0;
  private lastRebuild = -1e9;
  private seed = 1;
  time = 0;
  wind = 9;
  windDir: [number, number] = [1, 0];

  constructor(wind: number, windDir: [number, number]) {
    this.wind = wind;
    this.windDir = windDir;
    this.h0A = buildH0(FFT_N, PATCH, wind, windDir, this.seed++, sigmaForWind(wind));
    this.h0B = this.h0A;
    this.windOfB = wind;
    const glsl3 = { glslVersion: THREE.GLSL3 } as const;
    const mk = (frag: string, uniforms: Record<string, THREE.IUniform>) =>
      new THREE.RawShaderMaterial({ ...glsl3, vertexShader: `precision highp float;\nin vec3 position; in vec2 uv; out vec2 vUv;\nvoid main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`, fragmentShader: frag.replace('varying vec2 vUv;', 'in vec2 vUv;'), uniforms, depthTest: false, depthWrite: false });
    this.spectrumMat = mk(spectrumFrag, { h0A: { value: this.h0A }, h0B: { value: this.h0B }, blend: { value: 1 }, time: { value: 0 }, N: { value: FFT_N }, L: { value: PATCH } });
    this.fftMat = mk(fftFrag, { srcA: { value: null }, srcB: { value: null }, N: { value: FFT_N }, Ns: { value: 1 }, horizontal: { value: 1 } });
    this.finalizeMat = mk(finalizeFrag, { srcA: { value: null }, srcB: { value: null }, N: { value: FFT_N }, chop: { value: 1.1 } });
    this.normalMat = mk(normalFrag, { disp: { value: null }, N: { value: FFT_N }, L: { value: PATCH } });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.spectrumMat);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.ping = makeRT(FFT_N, 2, THREE.ClampToEdgeWrapping, THREE.NearestFilter);
    this.pong = makeRT(FFT_N, 2, THREE.ClampToEdgeWrapping, THREE.NearestFilter);
    this.dispRT = makeRT(FFT_N, 1, THREE.RepeatWrapping, THREE.LinearFilter);
    this.normRT = makeRT(FFT_N, 1, THREE.RepeatWrapping, THREE.LinearFilter);
    this.displacement = this.dispRT.texture;
    this.normals = this.normRT.texture;
  }

  /** Regenera el espectro si el viento cambió bastante (con fundido de 5 s). */
  setWind(speed: number, now: number) {
    this.wind = speed;
    if (Math.abs(speed - this.windOfB) > 1.5 && now - this.lastRebuild > 5) {
      this.h0A = this.h0B;
      this.h0B = buildH0(FFT_N, PATCH, speed, this.windDir, this.seed++, sigmaForWind(speed));
      this.windOfB = speed;
      this.blend = 0;
      this.lastRebuild = now;
      this.spectrumMat.uniforms.h0A.value = this.h0A;
      this.spectrumMat.uniforms.h0B.value = this.h0B;
    }
  }

  update(gl: THREE.WebGLRenderer, dt: number) {
    this.time += dt;
    this.blend = Math.min(1, this.blend + dt / 5);
    const prevRT = gl.getRenderTarget();
    const prevAutoClear = gl.autoClear;
    gl.autoClear = false;

    // 1. espectro en t
    this.spectrumMat.uniforms.time.value = this.time;
    this.spectrumMat.uniforms.blend.value = this.blend;
    this.quad.material = this.spectrumMat;
    gl.setRenderTarget(this.ping);
    gl.render(this.scene, this.camera);

    // 2. IFFT 2D: log2(N) pases horizontales + log2(N) verticales
    let src = this.ping, dst = this.pong;
    this.quad.material = this.fftMat;
    for (const horizontal of [1, 0]) {
      for (let Ns = 1; Ns < FFT_N; Ns *= 2) {
        this.fftMat.uniforms.srcA.value = src.textures[0];
        this.fftMat.uniforms.srcB.value = src.textures[1];
        this.fftMat.uniforms.Ns.value = Ns;
        this.fftMat.uniforms.horizontal.value = horizontal;
        gl.setRenderTarget(dst);
        gl.render(this.scene, this.camera);
        [src, dst] = [dst, src];
      }
    }

    // 3. desplazamiento (con signo de centrado y escala 1/N²)
    this.finalizeMat.uniforms.srcA.value = src.textures[0];
    this.finalizeMat.uniforms.srcB.value = src.textures[1];
    this.finalizeMat.uniforms.chop.value = 0.9 + Math.min(0.6, this.wind * 0.03);
    this.quad.material = this.finalizeMat;
    gl.setRenderTarget(this.dispRT);
    gl.render(this.scene, this.camera);

    // 4. normales y espuma
    this.normalMat.uniforms.disp.value = this.dispRT.texture;
    this.quad.material = this.normalMat;
    gl.setRenderTarget(this.normRT);
    gl.render(this.scene, this.camera);

    gl.setRenderTarget(prevRT);
    gl.autoClear = prevAutoClear;
  }
}

/** Instancia compartida (la crea OceanPhysics). */
export const oceanSimHolder: { sim: OceanSim | null } = { sim: null };
