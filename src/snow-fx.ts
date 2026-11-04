// 눈가루 파티클: 활강 중 뒤로 흩날리고, 턴/충돌 때 더 많이 튄다
import * as THREE from 'three';

const MAX = 600;
const LIFE = 0.9;

/** 감각 조정용 값 모음 */
export const SNOW_FX = {
  minSpeed: 6, // m/s 이상일 때만 흩날림
  baseRate: 18, // 초당 입자 수 (속도 1.0 기준)
  turnBonus: 40, // 턴할 때 추가 입자 (|turnVel| 비례)
  crashBurst: 70, // 충돌 순간 한 번에 터지는 입자 수
  size: 0.55,
};

export class SnowFx {
  readonly points: THREE.Points;
  private pos = new Float32Array(MAX * 3);
  private vel = new Float32Array(MAX * 3);
  private age = new Float32Array(MAX).fill(LIFE); // LIFE 이상 = 비어 있음
  private ageAttr: THREE.BufferAttribute;
  private cursor = 0;
  private carry = 0;

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.ageAttr = new THREE.BufferAttribute(this.age, 1);
    g.setAttribute('age', this.ageAttr);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { size: { value: SNOW_FX.size }, scale: { value: 600 } },
      vertexShader: /* glsl */ `
        attribute float age;
        uniform float size; uniform float scale;
        varying float vA;
        void main() {
          float k = clamp(age / ${LIFE.toFixed(2)}, 0.0, 1.0);
          vA = (1.0 - k) * (age >= ${LIFE.toFixed(2)} ? 0.0 : 1.0);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (0.6 + k) * scale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          if (d > 1.0) discard;
          gl_FragColor = vec4(0.96, 0.98, 1.0, vA * 0.75 * (1.0 - d * d));
        }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
  }

  private spawn(p: THREE.Vector3, back: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3, power: number) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX;
    const r = () => Math.random() - 0.5;
    const o = i * 3;
    this.pos[o] = p.x + right.x * r() * 0.5;
    this.pos[o + 1] = p.y + 0.1;
    this.pos[o + 2] = p.z + right.z * r() * 0.5;
    const s = 1.5 + Math.random() * 2.5;
    this.vel[o] = back.x * s * power + right.x * r() * 2.2 * power + up.x * 1.4;
    this.vel[o + 1] = up.y * (1.2 + Math.random() * 1.8) * power;
    this.vel[o + 2] = back.z * s * power + right.z * r() * 2.2 * power + up.z * 1.4;
    this.age[i] = 0;
  }

  /** 매 프레임: active 이면 뒤쪽으로 눈가루를 흘린다. burst > 0 이면 한꺼번에 터뜨린다 */
  update(dt: number, p: THREE.Vector3, fwd: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3, active: boolean, speed: number, turn: number, burst = 0) {
    const back = new THREE.Vector3().copy(fwd).negate();
    if (active && speed > SNOW_FX.minSpeed) {
      const sp = Math.min(1, speed / 40);
      this.carry += dt * (SNOW_FX.baseRate * sp + SNOW_FX.turnBonus * Math.min(1, Math.abs(turn)) * sp);
      while (this.carry >= 1) {
        this.carry -= 1;
        this.spawn(p, back, right, up, 0.5 + sp);
      }
    }
    for (let k = 0; k < burst; k++) this.spawn(p, back, right, up, 1.6);
    for (let i = 0; i < MAX; i++) {
      if (this.age[i] >= LIFE) continue;
      this.age[i] += dt;
      const o = i * 3;
      this.vel[o + 1] -= 4.5 * dt; // 중력
      this.vel[o] *= 1 - 1.8 * dt;
      this.vel[o + 2] *= 1 - 1.8 * dt;
      this.pos[o] += this.vel[o] * dt;
      this.pos[o + 1] += this.vel[o + 1] * dt;
      this.pos[o + 2] += this.vel[o + 2] * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.ageAttr.needsUpdate = true;
  }
}
