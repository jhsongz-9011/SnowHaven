// 코스 장애물 (three.js 의존 없음 → 서버에서도 같은 충돌 판정을 쓸 수 있다)
//
// 고정: 싱크홀, 공사 구간(고깔 + "안전제일" 노란 판)
// 이동: 고라니, 토끼 — 코스를 가로질러 왕복한다. 위치는 시간 t 만의 함수.
import { centerX } from './terrain';

export type FixedKind = 'sinkhole' | 'construction';
export type MovingKind = 'deer' | 'rabbit';
export type ObstacleKind = FixedKind | MovingKind;

export const OBSTACLE_LABEL: Record<ObstacleKind, string> = {
  sinkhole: '싱크홀',
  construction: '공사 구간',
  deer: '고라니',
  rabbit: '토끼',
};

/** 충돌 원 (장애물 중심 기준 상대 위치) */
export interface Circle {
  dx: number;
  dz: number;
  r: number;
}

export interface FixedObstacle {
  id: string;
  kind: FixedKind;
  x: number;
  z: number;
  /** 시각적 반지름 (싱크홀은 구멍 크기) */
  radius: number;
  parts: Circle[];
}

export interface MovingObstacle {
  id: string;
  kind: MovingKind;
  z: number;
  /** 코스 중심선에서 좌우로 오가는 진폭 (m) */
  amp: number;
  /** 이동 속도 (m/s) */
  speed: number;
  /** 시작 위상 (0~1) */
  phase: number;
  r: number;
}

/** 플레이어 몸 반지름 (m). 충돌은 (장애물 원 반지름 + 이 값) 안에 들어오면 발생 */
export const PLAYER_RADIUS = 0.7;

// ---------- 배치 ----------
// [z, 중심선 기준 좌우 위치(+ = 오른쪽), 종류]
// 장애물 수를 늘릴 때는 60m 간격(simtest 가 확인)을 지키면서 z 를 다시 배치한다. 지금은 z=180 ~ 1380 을 60m 마다 하나씩 (고정 12 + 이동 9).
const FIXED_LAYOUT: [number, number, FixedKind][] = [
  [180, -14, 'sinkhole'],
  [300, 10, 'construction'],
  [420, 18, 'sinkhole'],
  [540, -16, 'construction'],
  [600, 4, 'sinkhole'],
  [720, 20, 'construction'],
  [840, -20, 'sinkhole'],
  [960, -2, 'construction'],
  [1020, 12, 'sinkhole'],
  [1140, -8, 'construction'],
  [1260, 15, 'sinkhole'],
  [1380, -18, 'construction'],
];

// [z, 종류, 진폭, 속도, 위상]
const MOVING_LAYOUT: [number, MovingKind, number, number, number][] = [
  [240, 'deer', 30, 8, 0.0],
  [360, 'rabbit', 30, 12, 0.35],
  [480, 'rabbit', 30, 12, 0.6],
  [660, 'deer', 30, 8, 0.1],
  [780, 'rabbit', 30, 12, 0.85],
  [900, 'deer', 30, 8, 0.55],
  [1080, 'rabbit', 30, 12, 0.8],
  [1200, 'deer', 30, 8, 0.25],
  [1320, 'rabbit', 30, 12, 0.45],
];

function makeFixed(z: number, off: number, kind: FixedKind, n: number): FixedObstacle {
  const x = centerX(z) + off;
  if (kind === 'sinkhole') {
    return { id: `sinkhole-${n}`, kind, x, z, radius: 2.8, parts: [{ dx: 0, dz: 0, r: 2.2 }] };
  }
  // 공사 구간: 위쪽(−z)에 고깔 3개, 그 뒤에 "안전제일" 판 (판은 폭 약 2m)
  return {
    id: `construction-${n}`,
    kind,
    x,
    z,
    radius: 2.2,
    parts: [
      { dx: -0.7, dz: 0, r: 0.7 },
      { dx: 0.7, dz: 0, r: 0.7 },
      { dx: -1.7, dz: -1.4, r: 0.4 },
      { dx: 0, dz: -1.8, r: 0.4 },
      { dx: 1.7, dz: -1.4, r: 0.4 },
    ],
  };
}

export const FIXED: FixedObstacle[] = FIXED_LAYOUT.map(([z, off, kind], i) => makeFixed(z, off, kind, i));

export const MOVING: MovingObstacle[] = MOVING_LAYOUT.map(([z, kind, amp, speed, phase], i) => ({
  id: `${kind}-${i}`,
  kind,
  z,
  amp,
  speed,
  phase,
  r: kind === 'deer' ? 0.9 : 0.45,
}));

// ---------- 이동 장애물의 위치 (시간 t 만의 함수) ----------
export interface MovingPose {
  x: number;
  z: number;
  /** 이동 방향: +1 = +x, −1 = −x */
  dir: 1 | -1;
}

/** 삼각파: u 가 1 늘 때마다 한 주기, 값 −1 ~ +1, 앞 절반이 올라가는 구간 */
function tri(u: number): { v: number; up: boolean } {
  const w = u - Math.floor(u);
  return w < 0.5 ? { v: 4 * w - 1, up: true } : { v: 3 - 4 * w, up: false };
}

export function movingPose(m: MovingObstacle, t: number): MovingPose {
  const { v, up } = tri((t * m.speed) / (4 * m.amp) + m.phase);
  return { x: centerX(m.z) + m.amp * v, z: m.z, dir: up ? 1 : -1 };
}

// ---------- 충돌 판정 ----------
export interface Hit {
  id: string;
  kind: ObstacleKind;
  label: string;
}

/** (x, z) 에 있는 플레이어가 시각 t 에 장애물과 부딪히는지 */
export function hitTest(x: number, z: number, t: number): Hit | null {
  for (const o of FIXED) {
    if (Math.abs(z - o.z) > 6) continue;
    for (const p of o.parts) {
      const dx = x - (o.x + p.dx);
      const dz = z - (o.z + p.dz);
      const rr = p.r + PLAYER_RADIUS;
      if (dx * dx + dz * dz < rr * rr) return { id: o.id, kind: o.kind, label: OBSTACLE_LABEL[o.kind] };
    }
  }
  for (const m of MOVING) {
    if (Math.abs(z - m.z) > 3) continue;
    const p = movingPose(m, t);
    const dx = x - p.x;
    const dz = z - p.z;
    const rr = m.r + PLAYER_RADIUS;
    if (dx * dx + dz * dz < rr * rr) return { id: m.id, kind: m.kind, label: OBSTACLE_LABEL[m.kind] };
  }
  return null;
}
