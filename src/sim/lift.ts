// 리프트 경로와 의자 순환 (three.js 의존 없음 → 서버에서도 그대로 재사용 가능)
//
// 구조: 슬로프 옆(+x 쪽 둑 위)에 오르막 줄(up)과 내리막 줄(down)이 나란히 있고,
// 양 끝 승강장에서 반원으로 돌아 하나의 닫힌 고리가 된다.
// 의자 위치는 "시간 t" 만으로 결정된다 → 서버/클라이언트가 같은 시계를 쓰면 모두 같은 의자를 본다.
import { centerX, height } from './terrain';

/** 리프트 감각/배치 파라미터. 속도·간격은 여기 숫자만 바꾸면 됨 */
export const LIFT = {
  /** 슬로프 중심 기준 어느 쪽에 세울지 (+1 = +x 쪽) */
  side: 1,
  /** 중심선에서 오르막 줄/내리막 줄까지의 거리 (m). 둘 사이 절반이 회전 반지름 */
  upOffset: 41,
  downOffset: 49,
  /** 아래/위 승강장의 회전 중심 z */
  bottomZ: 1514,
  topZ: -8,
  /** 아래 승강장: 회전 끝에서 탑승 지점까지 / 위 승강장: 하차 지점에서 회전 시작까지 거리 (m) */
  boardGap: 15,
  unloadGap: 15,
  /** 의자 속도 (m/s). 탑승 → 하차 약 90초가 되도록 잡음 (오르막 약 1580m ÷ 90초). 값을 올리면 더 빨리 오름 */
  speed: 17.6,
  /** 의자 간격 (m) → 간격 / 속도 = 의자가 오는 주기(초) */
  chairSpacing: 36,
  /** 의자 한 대의 좌석 수 (2인승)와 좌석 사이 간격 (m) */
  seats: 2,
  seatPitch: 0.8,
  /**
   * 테스트용 배경 동승자: 다른 플레이어가 없어도 2인승이 보이도록, 오르막 의자 일부에 NPC 가 앉아 있다.
   * 확률은 (의자, 회차)로 결정되므로 서버/클라이언트가 같은 결과를 본다. 둘 다 0 이면 꺼짐.
   * single: 1명이 타고 있을 확률, double: 2명 모두 타고 있을 확률(이 의자는 탑승 불가).
   * 만석 의자는 연속해서 오지 않도록 보정되므로, 실제 만석 비율은 double × (1 − double) 이다.
   */
  ambient: { single: 0.3, double: 0.14 },
  /** 케이블에서 좌석 바닥까지 길이 (m) */
  hang: 2.0,
  /** 승강장 바닥에서 좌석 바닥까지 높이 (m) */
  seatLift: 0.45,
  /** 철탑 간격 (m) */
  towerSpacing: 50,
  /** 중간 구간에서 지면과 좌석 바닥 사이 최소 여유 (m) */
  clearance: 9,
  /** 철탑 사이 케이블 처짐 (m) */
  sag: 0.6,
  /** 승강장 데크 폭 (m) */
  deckWidth: 13,
  /** 경로 샘플 간격 (m), 반원 분할 수 */
  step: 3,
  turnSegments: 12,
};

const MID = (LIFT.upOffset + LIFT.downOffset) / 2;
const R = (LIFT.downOffset - LIFT.upOffset) / 2;
/** 승강장에서 케이블이 수평으로 유지되는 구간 길이 */
const FLAT_BOTTOM = LIFT.boardGap + 5;
const FLAT_TOP = LIFT.unloadGap + 5;

const ox = (z: number, off: number) => centerX(z) + LIFT.side * off;
const mod = (a: number, n: number) => ((a % n) + n) % n;
const wrapAngle = (a: number) => mod(a + Math.PI, Math.PI * 2) - Math.PI;

/** z 위치에서 오르막 줄이 향하는 방향각 (+z = 0, 오르막이라 대체로 π 근처) */
function upHeadingAt(z: number): number {
  const dxdz = (centerX(z + 1) - centerX(z - 1)) / 2;
  return Math.atan2(-dxdz, -1);
}

// ---------- 승강장 ----------
export interface Station {
  /** 데크 중심 */
  x: number;
  z: number;
  /** 오르막 진행 방향각 */
  heading: number;
  length: number;
  width: number;
  /** 데크 윗면 y, 기초 바닥 y */
  deckY: number;
  floorY: number;
  /** 승강장 구간의 케이블 높이 */
  cableY: number;
}

function makeStation(zMin: number, zMax: number): Station {
  const zc = (zMin + zMax) / 2;
  let hi = -Infinity;
  let lo = Infinity;
  for (let i = 0; i <= 8; i++) {
    const z = zMin + ((zMax - zMin) * i) / 8;
    for (let j = 0; j <= 4; j++) {
      const off = MID - LIFT.deckWidth / 2 + (LIFT.deckWidth * j) / 4;
      const h = height(ox(z, off), z);
      hi = Math.max(hi, h);
      lo = Math.min(lo, h);
    }
  }
  const deckY = hi + 0.4; // 지형이 데크를 뚫고 나오지 않도록 가장 높은 지점 기준
  return {
    x: ox(zc, MID),
    z: zc,
    heading: upHeadingAt(zc),
    length: zMax - zMin,
    width: LIFT.deckWidth,
    deckY,
    floorY: lo - 2,
    cableY: deckY + LIFT.seatLift + LIFT.hang,
  };
}

export const STATIONS = {
  bottom: makeStation(LIFT.bottomZ - FLAT_BOTTOM, LIFT.bottomZ + R + 3),
  top: makeStation(LIFT.topZ - R - 3, LIFT.topZ + FLAT_TOP),
};

// ---------- 케이블 높이 (철탑 사이는 부드러운 에르미트 곡선) ----------
interface Knot {
  z: number;
  y: number;
  m: number;
  station: boolean;
}

const knots: Knot[] = [];
export interface Tower {
  x: number;
  z: number;
  heading: number;
  groundY: number;
  cableY: number;
}
export const TOWERS: Tower[] = [];

(function buildKnots() {
  const zA = LIFT.topZ + FLAT_TOP;
  const zB = LIFT.bottomZ - FLAT_BOTTOM;
  knots.push({ z: LIFT.topZ, y: STATIONS.top.cableY, m: 0, station: true });
  knots.push({ z: zA, y: STATIONS.top.cableY, m: 0, station: true });
  const n = Math.max(2, Math.round((zB - zA) / LIFT.towerSpacing));
  for (let j = 1; j < n; j++) {
    const z = zA + ((zB - zA) * j) / n;
    const ground = Math.max(height(ox(z, LIFT.upOffset), z), height(ox(z, LIFT.downOffset), z));
    const y = ground + LIFT.clearance + LIFT.hang;
    knots.push({ z, y, m: 0, station: false });
    TOWERS.push({ x: ox(z, MID), z, heading: upHeadingAt(z), groundY: height(ox(z, MID), z), cableY: y });
  }
  knots.push({ z: zB, y: STATIONS.bottom.cableY, m: 0, station: true });
  knots.push({ z: LIFT.bottomZ, y: STATIONS.bottom.cableY, m: 0, station: true });
  for (let k = 1; k < knots.length - 1; k++) {
    if (knots[k].station) continue;
    knots[k].m = (knots[k + 1].y - knots[k - 1].y) / (knots[k + 1].z - knots[k - 1].z);
  }
})();

/** 해당 z 에서의 케이블 높이 */
export function cableY(zRaw: number): number {
  const z = Math.min(LIFT.bottomZ, Math.max(LIFT.topZ, zRaw));
  let k = 0;
  while (k < knots.length - 2 && z > knots[k + 1].z) k++;
  const a = knots[k];
  const b = knots[k + 1];
  const dz = b.z - a.z;
  const u = (z - a.z) / dz;
  const u2 = u * u;
  const u3 = u2 * u;
  let y =
    (2 * u3 - 3 * u2 + 1) * a.y +
    (u3 - 2 * u2 + u) * dz * a.m +
    (-2 * u3 + 3 * u2) * b.y +
    (u3 - u2) * dz * b.m;
  if (!(a.station && b.station)) y -= LIFT.sag * 4 * u * (1 - u);
  return y;
}

// ---------- 경로 (닫힌 고리) ----------
export interface LiftPose {
  x: number;
  /** 좌석 바닥 높이 (케이블 y - hang) */
  y: number;
  z: number;
  heading: number;
}

const px: number[] = [];
const py: number[] = [];
const pz: number[] = [];
let upCount = 0; // 오르막 줄 정점 개수 (앞쪽 upCount 개)

function push(z: number, off: number) {
  px.push(ox(z, off));
  pz.push(z);
  py.push(cableY(z) - LIFT.hang);
}

(function buildPath() {
  // 1) 오르막 줄: 아래 → 위
  for (let z = LIFT.bottomZ; z > LIFT.topZ; z -= LIFT.step) push(z, LIFT.upOffset);
  push(LIFT.topZ, LIFT.upOffset);
  upCount = px.length;
  // 2) 위 승강장 반원
  for (let i = 1; i < LIFT.turnSegments; i++) {
    const a = (Math.PI * i) / LIFT.turnSegments;
    push(LIFT.topZ - R * Math.sin(a), MID - R * Math.cos(a));
  }
  // 3) 내리막 줄: 위 → 아래
  for (let z = LIFT.topZ; z < LIFT.bottomZ; z += LIFT.step) push(z, LIFT.downOffset);
  push(LIFT.bottomZ, LIFT.downOffset);
  // 4) 아래 승강장 반원
  for (let i = 1; i < LIFT.turnSegments; i++) {
    const a = (Math.PI * i) / LIFT.turnSegments;
    push(LIFT.bottomZ + R * Math.sin(a), MID + R * Math.cos(a));
  }
})();

const N = px.length;
const S = new Float64Array(N + 1); // 누적 거리, S[N] = 전체 길이
for (let i = 0; i < N; i++) {
  const j = (i + 1) % N;
  S[i + 1] = S[i] + Math.hypot(px[j] - px[i], py[j] - py[i], pz[j] - pz[i]);
}
export const PATH_LENGTH = S[N];

const headings = new Float64Array(N);
for (let i = 0; i < N; i++) {
  const a = (i + N - 1) % N;
  const b = (i + 1) % N;
  headings[i] = Math.atan2(px[b] - px[a], pz[b] - pz[a]);
}

/** 고리를 따라 s 미터 지점의 자세 */
export function poseAt(sRaw: number, out: LiftPose = { x: 0, y: 0, z: 0, heading: 0 }): LiftPose {
  const s = mod(sRaw, PATH_LENGTH);
  let lo = 0;
  let hi = N;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (S[mid] <= s) lo = mid;
    else hi = mid;
  }
  const i = lo;
  const j = (i + 1) % N;
  const t = (s - S[i]) / (S[i + 1] - S[i]);
  out.x = px[i] + (px[j] - px[i]) * t;
  out.y = py[i] + (py[j] - py[i]) * t;
  out.z = pz[i] + (pz[j] - pz[i]) * t;
  out.heading = headings[i] + wrapAngle(headings[j] - headings[i]) * t;
  return out;
}

/** 렌더링용: 케이블 정점 (좌석이 아니라 케이블 높이) */
export function cableVertices(): { x: number; y: number; z: number }[] {
  return px.map((x, i) => ({ x, y: py[i] + LIFT.hang, z: pz[i] }));
}

// ---------- 의자 ----------
export const CHAIR_COUNT = Math.max(2, Math.round(PATH_LENGTH / LIFT.chairSpacing));
export const CHAIR_SPACING = PATH_LENGTH / CHAIR_COUNT;

/** i 번째 의자의 시각 t 에서의 경로상 위치 */
export function chairS(i: number, t: number): number {
  return mod(i * CHAIR_SPACING + t * LIFT.speed, PATH_LENGTH);
}

/** 위치 a → b 로 움직이는 동안 지점 c 를 지났는가 (고리 이음매 처리 포함) */
export function crossed(a: number, b: number, c: number): boolean {
  const d = mod(b - a, PATH_LENGTH);
  const e = mod(c - a, PATH_LENGTH);
  return e > 0 && e <= d;
}

/** 오르막 줄에서 해당 z 에 해당하는 s */
function sAtUpZ(zTarget: number): number {
  for (let i = 1; i < upCount; i++) {
    if (pz[i] <= zTarget) {
      const t = (pz[i - 1] - zTarget) / (pz[i - 1] - pz[i]);
      return S[i - 1] + (S[i] - S[i - 1]) * t;
    }
  }
  return S[upCount - 1];
}

/** 탑승 지점 / 하차 지점 (경로상 위치 s) */
export const BOARD_S = sAtUpZ(LIFT.bottomZ - LIFT.boardGap);
export const UNLOAD_S = sAtUpZ(LIFT.topZ + LIFT.unloadGap);

export interface Spot {
  x: number;
  /** 발 딛는 데크 높이 */
  y: number;
  z: number;
  heading: number;
}

function spotAt(s: number, deckY: number): Spot {
  const p = poseAt(s);
  return { x: p.x, y: deckY, z: p.z, heading: p.heading };
}

export const BOARD_POINT: Spot = spotAt(BOARD_S, STATIONS.bottom.deckY);
export const UNLOAD_POINT: Spot = spotAt(UNLOAD_S, STATIONS.top.deckY);

/** 오르막 구간(탑승 → 하차)의 거리와 소요 시간 */
export const RIDE_LENGTH = UNLOAD_S - BOARD_S;
export const RIDE_TIME = RIDE_LENGTH / LIFT.speed;

// ---------- 2인승 좌석과 동승자 ----------
/** 좌석 i 의 좌우 위치 (m). 진행 방향 기준 왼쪽이 음수 (좌석 0 = 왼쪽) */
export function seatLateral(seat: number): number {
  return (seat - (LIFT.seats - 1) / 2) * LIFT.seatPitch;
}

/** 진행 방향 heading 에서 화면 오른쪽 방향으로 lateral m 이동하는 (dx, dz) */
export function lateralShift(heading: number, lateral: number): [number, number] {
  return [-Math.cos(heading) * lateral, Math.sin(heading) * lateral];
}

/** 의자가 s=0(오르막 시작) 을 지날 때마다 1씩 늘어나는 회차. 점유 상태는 (의자, 회차)로 결정된다 */
export function chairCycle(i: number, t: number): number {
  return Math.floor((i * CHAIR_SPACING + t * LIFT.speed) / PATH_LENGTH);
}

/** 정수 해시 → [0, 1). 삼각함수를 쓰지 않아 엔진이 달라도 같은 값 */
function hash01(a: number, b: number, c: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35) ^ Math.imul(c + 0x165667b1, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/**
 * 탑승 지점 도착 순서 번호. 의자 i 가 회차 c 에서 s=0 을 지나는 시각이 (c·N − i) 에 비례하므로
 * 이 값이 1씩 커지는 순서가 곧 의자가 도착하는 시간 순서다.
 */
function arrivalIndex(i: number, cycle: number): number {
  return cycle * CHAIR_COUNT - i;
}

/** 배경 동승자가 앉은 좌석 비트마스크 (bit0 = 좌석 0, bit1 = 좌석 1). 만석 의자는 연달아 오지 않는다 */
export function ambientMask(i: number, cycle: number): number {
  const p = arrivalIndex(i, cycle);
  const r = hash01(p, 0, 1);
  if (r < LIFT.ambient.double) {
    // 직전에 도착한 의자(p−1)가 만석 후보였다면 이번엔 1명만 태워서 만석이 이어지지 않게 한다
    if (hash01(p - 1, 0, 1) >= LIFT.ambient.double) return 3;
    return hash01(p, 0, 2) < 0.5 ? 1 : 2;
  }
  if (r < LIFT.ambient.double + LIFT.ambient.single) return hash01(p, 0, 2) < 0.5 ? 1 : 2;
  return 0;
}

/** 비어 있는 좌석 중 앞 번호 (모두 찼으면 -1) */
export function freeSeat(mask: number): number {
  for (let k = 0; k < LIFT.seats; k++) if (!(mask & (1 << k))) return k;
  return -1;
}

/** 배경 동승자 외투 색 번호 (0~7) */
export function ambientColor(i: number, cycle: number, seat: number): number {
  return Math.floor(hash01(arrivalIndex(i, cycle), 0, 10 + seat) * 8);
}

/** 배경 동승자는 오르막(s = 0 ~ 하차 지점)에서만 의자에 앉아 있다 */
export const AMBIENT_END_S = UNLOAD_S;
