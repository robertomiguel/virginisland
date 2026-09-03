import * as THREE from 'three';

/** Inyecta el vaivén de viento (ráfagas que recorren el bosque) en un material estándar instanciado. */
export function addWindSway(mat: THREE.MeshStandardMaterial, strength: number, registry: THREE.WebGLProgramParametersWithUniforms[]) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uWind = { value: 0 };
    shader.uniforms.uWindDir = { value: new THREE.Vector2(1, 0) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;\nuniform vec2 uWindDir;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 iPos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          float phase = fract(sin(iPos.x * 12.9898 + iPos.z * 78.233) * 43758.5453) * 6.2832;
          float hgt = max(position.y, 0.0);
          float radial = smoothstep(0.2, 3.0, length(position.xz) + hgt * 0.3);
          float along = dot(iPos.xz, uWindDir);
          float g1 = sin(along * 0.025 - uTime * 0.45 + phase * 0.25);
          float g2 = sin(along * 0.009 - uTime * 0.19 + 1.7);
          float own = sin(uTime * 0.8 + phase + position.y * 0.06 + position.x * 0.05);
          float bend = 0.55 + 0.32 * g1 + 0.22 * g2 + 0.18 * own;
          float lateral = 0.22 * sin(uTime * 0.5 + phase * 1.3 + along * 0.012);
          vec3 wl = normalize(transpose(mat3(instanceMatrix)) * vec3(uWindDir.x, 0.0, uWindDir.y));
          vec3 sl = vec3(-wl.z, 0.0, wl.x);
          float amp = uWind * hgt * radial * ${strength.toFixed(5)};
          transformed += (wl * bend + sl * lateral) * amp;
          transformed.y -= bend * amp * 0.18;
        #endif`,
      );
    registry.push(shader);
  };
}
