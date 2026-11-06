// 환경 효과: 내리는 눈 + 활강 자국
import * as THREE from 'three';
import { height } from './sim/terrain';
import type { EquipmentId } from './sim/equipment';

/** 감각 조정용 값 모음 */
export const ENV_FX = {
  flakes: 900, // 내리는 눈 입자 수
  flakeSize: 0.14,
  fallSpeed: 1.6, // m/s
  area: { w: 50, h: 28 }, // 카메라 주변 눈이 내리는 범위 (가로폭, 높이)
  trackSpacing: 0.6, // m: 자국 샘플 간격
  trackPoints: 500, // 자국 최대 길이 = 간격 × 개수 (약 300m)
  trackY: 0.12, // 지형 메시(격자 2.5m)의 보간 오차에 묻히지 않도록 살짝 띄운다
};

export class Snowfall {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private seed: Float32Array;

  constructor() {
    const n = ENV_FX.flakes;
    this.pos = new Float32Array(n * 3);
    this.seed = new Float32Array(n);
    const { w, h } = ENV_FX.area;
    for (let i = 0; i < n; i++) {
      this.pos[i * 3] = (Math.random() - 0.5) * w;
      this.pos[i * 3 + 1] = Math.random() * h;
      this.pos[i * 3 + 2] = (Math.random() - 0.5) * w;
      this.seed[i] = Math.random() * 6.28;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    // 가까운 눈송이가 네모로 커지지 않도록 화면 크기를 제한한 둥근 점
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { size: { value: ENV_FX.flakeSize } },
      vertexShader: /* glsl */ `
        uniform float size;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(size * 700.0 / -mv.z, 1.5, 6.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          if (d > 1.0) discard;
          gl_FragColor = vec4(1.0, 1.0, 1.0, 0.85 * (1.0 - d * d));
        }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
  }

  /** 눈은 카메라 주변 상자 안에서만 내리며, 상자를 벗어나면 반대쪽으로 순환한다 */
  update(dt: number, t: number, cam: THREE.Vector3) {
    const { w, h } = ENV_FX.area;
    const n = ENV_FX.flakes;
    const p = this.pos;
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      p[o + 1] -= ENV_FX.fallSpeed * dt;
      p[o] += Math.sin(t * 0.8 + this.seed[i]) * 0.35 * dt;
      p[o + 2] += Math.cos(t * 0.7 + this.seed[i]) * 0.35 * dt;
    }
    // 상자를 카메라에 붙인다: 상대 좌표를 래핑
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      const rx = ((((p[o] - cam.x) % w) + w * 1.5) % w) - w / 2;
      const rz = ((((p[o + 2] - cam.z) % w) + w * 1.5) % w) - w / 2;
      const ry = ((((p[o + 1] - cam.y + h * 0.35) % h) + h) % h) - h * 0.35;
      p[o] = cam.x + rx;
      p[o + 2] = cam.z + rz;
      p[o + 1] = cam.y + ry;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

const LANES: Record<EquipmentId, { off: number[]; w: number }> = {
  ski: { off: [-0.2, 0.2], w: 0.045 },
  board: { off: [0], w: 0.16 },
  sled: { off: [-0.38, 0.38], w: 0.06 },
};
const MAX_LANES = Math.max(...Object.values(LANES).map((l) => l.off.length));
const FADE_SAMPLES = 30; // 가장 오래된 쪽 이만큼의 샘플에 걸쳐 옅어진다 (버퍼가 차도 모양이 변하지 않음)

/** 샘플 하나: 레인마다 좌/우 가장자리 정점(높이까지)을 한 번만 계산해 둔다 */
interface Sample {
  lanes: number; // 이 샘플의 레인 수 (장비 종류에 따라 다름 → 장비를 바꿔도 이미 남은 자국은 그대로)
  v: Float32Array; // [lane][좌/우][x,y,z]
  gap: boolean; // true 면 이 샘플과 다음 샘플 사이는 잇지 않는다
}

/** 눈 위에 남는 활강 자국 (장비별 모양). 넘어지거나 리프트 탈 때는 끊긴다 */
export class SkiTracks {
  readonly mesh: THREE.Mesh;
  private samples: Sample[] = [];
  private lastX = NaN;
  private lastZ = NaN;
  private pos: Float32Array;
  private col: Float32Array;
  private geo: THREE.BufferGeometry;
  private posAttr: THREE.BufferAttribute;
  private colAttr: THREE.BufferAttribute;

  constructor() {
    const quads = ENV_FX.trackPoints * MAX_LANES;
    this.pos = new Float32Array(quads * 4 * 3);
    this.col = new Float32Array(quads * 4 * 4);
    this.geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3);
    this.colAttr = new THREE.BufferAttribute(this.col, 4);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colAttr.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.posAttr);
    this.geo.setAttribute('color', this.colAttr);
    const idx: number[] = [];
    for (let q = 0; q < quads; q++) {
      const b = q * 4;
      idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
    this.geo.setIndex(idx);
    this.geo.setDrawRange(0, 0);
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
  }

  /** active: 눈 위에서 정상적으로 타는 중. heading: 진행 방향(rad) */
  update(x: number, z: number, heading: number, active: boolean, kind: EquipmentId) {
    if (!active) {
      const last = this.samples[this.samples.length - 1];
      if (last && !last.gap) last.gap = true; // 새 샘플을 만들지 않고 마지막 샘플에 끊김 표시만 한다
      this.lastX = NaN;
      return;
    }
    if (!Number.isNaN(this.lastX) && Math.hypot(x - this.lastX, z - this.lastZ) < ENV_FX.trackSpacing) return;
    this.lastX = x;
    this.lastZ = z;
    this.samples.push(this.makeSample(x, z, heading, kind));
    if (this.samples.length > ENV_FX.trackPoints) this.samples.shift();
    this.rebuild();
  }

  private makeSample(x: number, z: number, heading: number, kind: EquipmentId): Sample {
    const { off, w } = LANES[kind];
    const rx = Math.cos(heading);
    const rz = -Math.sin(heading); // right = up × fwd
    const v = new Float32Array(off.length * 6);
    for (let l = 0; l < off.length; l++) {
      for (let side = 0; side < 2; side++) {
        const d = off[l] + (side === 0 ? -w : w);
        const px = x + rx * d;
        const pz = z + rz * d;
        const o = l * 6 + side * 3;
        v[o] = px;
        v[o + 1] = height(px, pz) + ENV_FX.trackY;
        v[o + 2] = pz;
      }
    }
    return { lanes: off.length, v, gap: false };
  }

  /** 저장된 정점을 버퍼에 복사한다 (새 객체/클로저를 만들지 않음) */
  private rebuild() {
    const s = this.samples;
    const pos = this.pos;
    const col = this.col;
    let q = 0;
    for (let i = 0; i + 1 < s.length; i++) {
      const a = s[i];
      const b = s[i + 1];
      if (a.gap) continue;
      const lanes = Math.min(a.lanes, b.lanes);
      const fa = Math.min(1, i / FADE_SAMPLES);
      const fb = Math.min(1, (i + 1) / FADE_SAMPLES);
      for (let l = 0; l < lanes; l++) {
        const base = q * 12;
        const cb = q * 16;
        // 정점 순서: a좌, a우, b좌, b우
        for (let k = 0; k < 6; k++) {
          pos[base + k] = a.v[l * 6 + k];
          pos[base + 6 + k] = b.v[l * 6 + k];
        }
        for (let k = 0; k < 4; k++) {
          const f = k < 2 ? fa : fb;
          const c = cb + k * 4;
          col[c] = 0.42;
          col[c + 1] = 0.54;
          col[c + 2] = 0.7;
          col[c + 3] = 0.85 * f;
        }
        q++;
      }
    }
    this.geo.setDrawRange(0, q * 6);
    this.posAttr.clearUpdateRanges();
    this.colAttr.clearUpdateRanges();
    this.posAttr.addUpdateRange(0, q * 12);
    this.colAttr.addUpdateRange(0, q * 16);
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }
}
