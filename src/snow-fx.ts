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
  fallenRate: 60, // 넘어져 미끄러지는 동안 초당 입자 수
  fallenMinSpeed: 4, // m/s 이상일 때만
  maxPx: 48, // 눈가루 점 최대 화면 크기 (모바일 필 레이트 보호)
  pxScale: 600, // 거리 대비 점 크기 환산 계수
  gravity: 4.5,
  drag: 1.8,
  size: 0.55,
};

const rand = () => Math.random() - 0.5;

export class SnowFx {
  readonly points: THREE.Points;
  private pos = new Float32Array(MAX * 3);
  private vel = new Float32Array(MAX * 3);
  private age = new Float32Array(MAX).fill(LIFE); // LIFE 이상 = 비어 있음
  private ageAttr: THREE.BufferAttribute;
  private cursor = 0;
  private carry = 0;
  private slideCarry = 0;
  private live = 0; // 살아 있는 입자 수 (0 이면 갱신·업로드를 건너뛴다)
  private readonly back = new THREE.Vector3();

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.ageAttr = new THREE.BufferAttribute(this.age, 1);
    g.setAttribute('age', this.ageAttr);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { size: { value: SNOW_FX.size }, scale: { value: SNOW_FX.pxScale } },
      vertexShader: /* glsl */ `
        attribute float age;
        uniform float size; uniform float scale;
        varying float vA;
        void main() {
          float k = clamp(age / ${LIFE.toFixed(2)}, 0.0, 1.0);
          vA = (1.0 - k) * (age >= ${LIFE.toFixed(2)} ? 0.0 : 1.0);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = min(size * (0.6 + k) * scale / -mv.z, ${SNOW_FX.maxPx.toFixed(1)});
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
    const r = rand;
    const o = i * 3;
    this.pos[o] = p.x + right.x * r() * 0.5;
    this.pos[o + 1] = p.y + 0.1;
    this.pos[o + 2] = p.z + right.z * r() * 0.5;
    const s = 1.5 + Math.random() * 2.5;
    this.vel[o] = back.x * s * power + right.x * r() * 2.2 * power + up.x * 1.4;
    this.vel[o + 1] = up.y * (1.2 + Math.random() * 1.8) * power;
    this.vel[o + 2] = back.z * s * power + right.z * r() * 2.2 * power + up.z * 1.4;
    if (this.age[i] >= LIFE) this.live++; // 아직 살아 있는 슬롯을 덮어쓰는 경우는 세지 않는다
    this.age[i] = 0;
  }

  /** 매 프레임: active 이면 뒤쪽으로 눈가루를 흘린다. burst > 0 이면 한꺼번에 터뜨린다 */
  update(dt: number, p: THREE.Vector3, fwd: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3, active: boolean, speed: number, turn: number, burst = 0, sliding = false) {
    const back = this.back.copy(fwd).negate();
    if (active && speed > SNOW_FX.minSpeed) {
      const sp = Math.min(1, speed / 40);
      this.carry += dt * (SNOW_FX.baseRate * sp + SNOW_FX.turnBonus * Math.min(1, Math.abs(turn)) * sp);
      while (this.carry >= 1) {
        this.carry -= 1;
        this.spawn(p, back, right, up, 0.5 + sp);
      }
    }
    if (sliding) {
      this.slideCarry += dt * SNOW_FX.fallenRate;
      while (this.slideCarry >= 1) {
        this.slideCarry -= 1;
        this.spawn(p, back, right, up, 1.0);
      }
    }
    for (let k = 0; k < burst; k++) this.spawn(p, back, right, up, 1.6);
    if (this.live === 0) return;
    for (let i = 0; i < MAX; i++) {
      if (this.age[i] >= LIFE) continue;
      this.age[i] += dt;
      if (this.age[i] >= LIFE) this.live--;
      const o = i * 3;
      this.vel[o + 1] -= SNOW_FX.gravity * dt;
      const damp = Math.max(0, 1 - SNOW_FX.drag * dt);
      this.vel[o] *= damp;
      this.vel[o + 2] *= damp;
      this.pos[o] += this.vel[o] * dt;
      this.pos[o + 1] += this.vel[o + 1] * dt;
      this.pos[o + 2] += this.vel[o + 2] * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.ageAttr.needsUpdate = true;
  }
}
