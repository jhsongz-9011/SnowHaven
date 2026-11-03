// 물리 검증용 봇 시뮬레이션: npm run simtest
import { EQUIPMENT, EQUIPMENT_ORDER, type Equipment } from './equipment';
import { createPlayer, stepPlayer, wrapAngle } from './physics';
import { CRASH } from './equipment';
import { FIXED, MOVING, PLAYER_RADIUS, movingPose, hitTest } from './obstacles';
import { centerX, COURSE, fallLine, height } from './terrain';
import {
  LIFT, STATIONS, TOWERS, PATH_LENGTH, CHAIR_COUNT, CHAIR_SPACING, BOARD_S, UNLOAD_S, BOARD_POINT, UNLOAD_POINT,
  RIDE_TIME, chairS, crossed, poseAt, chairCycle, ambientMask, freeSeat, seatLateral,
} from './lift';

const DT = 1 / 60;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type Bot = (eq: Equipment, s: ReturnType<typeof createPlayer>, t: number) => number;

/** 중앙선을 따라 곧장 내려가는 봇 */
const centerBot: Bot = (eq, s) => {
  const phi = fallLine(s.x, s.z).angle;
  const rel = wrapAngle(s.heading - phi);
  const desiredRel = clamp((centerX(s.z) - s.x) * 0.03, -0.5, 0.5);
  if (eq.steerMode === 'angle') return clamp(-desiredRel / eq.maxAngle, -1, 1);
  return clamp((rel - desiredRel) * 4, -1, 1);
};

/** S자로 좌우를 번갈아 가르며 내려가는 봇 (회전 장비 전용) */
const weaveBot: Bot = (eq, s, t) => {
  const phi = fallLine(s.x, s.z).angle;
  const rel = wrapAngle(s.heading - phi);
  const desiredRel = 0.7 * Math.sin(t * 1.6);
  return clamp((rel - desiredRel) * 4, -1, 1);
};

function run(eq: Equipment, bot: Bot, collide = false) {
  const s = createPlayer();
  let maxSpeed = 0;
  let sumSpeed = 0;
  let n = 0;
  let maxOffCenter = 0;
  let t = 0;
  while (!s.finished && t < 300) {
    const input = bot(eq, s, t);
    stepPlayer(s, input, eq, DT, t, collide); // 기본은 장애물 없이 (속도 비교용)
    maxSpeed = Math.max(maxSpeed, s.speed);
    sumSpeed += s.speed;
    n++;
    maxOffCenter = Math.max(maxOffCenter, Math.abs(s.x - centerX(s.z)));
    t += DT;
  }
  return {
    finished: s.finished,
    time: s.finished ? s.finishTime : NaN,
    max: maxSpeed * 3.6,
    avg: (sumSpeed / n) * 3.6,
    off: maxOffCenter,
    crashes: s.crashes,
  };
}

console.log(`코스 길이 약 ${COURSE.finishZ - COURSE.startZ}m, 벽 한계 ±${COURSE.halfWidth}m\n`);
const row = (name: string, r: ReturnType<typeof run>) =>
  console.log(
    `${name.padEnd(12)} 완주:${r.finished ? 'O' : 'X'}  기록 ${r.time.toFixed(1).padStart(5)}s  평균 ${r.avg.toFixed(0).padStart(3)}km/h  최고 ${r.max.toFixed(0).padStart(3)}km/h  중앙선 최대이탈 ${r.off.toFixed(1)}m`,
  );

console.log('[직진(중앙선 추종)]');
const results: Record<string, number> = {};
for (const id of EQUIPMENT_ORDER) {
  const r = run(EQUIPMENT[id], centerBot);
  results[id] = r.time;
  row(EQUIPMENT[id].label, r);
}

console.log('\n[S자 턴으로 가르며 내려오기]');
for (const id of EQUIPMENT_ORDER) {
  if (EQUIPMENT[id].steerMode === 'angle') continue;
  row(EQUIPMENT[id].label, run(EQUIPMENT[id], weaveBot));
}

const ok = results.sled < results.board && results.board < results.ski;
console.log(`\n속도 순서 (썰매 > 보드 > 스키): ${ok ? '통과' : '실패'}`);
if (!ok) process.exitCode = 1;

// ---------------- 리프트 ----------------
console.log('\n[리프트]');
const period = CHAIR_SPACING / LIFT.speed;
console.log(
  `고리 길이 ${PATH_LENGTH.toFixed(0)}m · 의자 ${CHAIR_COUNT}개 · 간격 ${CHAIR_SPACING.toFixed(1)}m (${period.toFixed(2)}초마다 1대) · 철탑 ${TOWERS.length}개`,
);
console.log(`탑승 → 하차 ${RIDE_TIME.toFixed(1)}초 (의자 속도 ${(LIFT.speed * 3.6).toFixed(0)}km/h)`);

const fails: string[] = [];
const check = (name: string, pass: boolean, detail: string) => {
  console.log(`  ${pass ? '통과' : '실패'}  ${name} (${detail})`);
  if (!pass) fails.push(name);
};

// 1) 탑승 지점에서 좌석 높이 = 데크 + seatLift, 하차 지점도 동일
const bp = poseAt(BOARD_S);
const up = poseAt(UNLOAD_S);
check(
  '승강장에서 좌석이 데크 바로 위',
  Math.abs(bp.y - BOARD_POINT.y - LIFT.seatLift) < 0.05 && Math.abs(up.y - UNLOAD_POINT.y - LIFT.seatLift) < 0.05,
  `탑승 ${(bp.y - BOARD_POINT.y).toFixed(2)}m / 하차 ${(up.y - UNLOAD_POINT.y).toFixed(2)}m`,
);

// 2) 지면 여유: 승객이 타는 오르막 줄과 빈 내리막 줄을 따로 본다 (승강장 수평 구간은 제외)
const topFlatEnd = STATIONS.top.z + STATIONS.top.length / 2; // 위 승강장 수평 구간은 z ≤ 이 값
const bottomFlatStart = STATIONS.bottom.z - STATIONS.bottom.length / 2; // 아래 승강장 수평 구간은 z ≥ 이 값
const MID_OFF = (LIFT.upOffset + LIFT.downOffset) / 2;
const clear = { up: { min: Infinity, z: 0 }, down: { min: Infinity, z: 0 } };
const upLineH = { min: Infinity, max: -Infinity }; // 승객 줄의 좌석 지상고 범위 (참고용)
for (let s = 0; s < PATH_LENGTH; s += 1) {
  const p = poseAt(s);
  if (p.z <= topFlatEnd || p.z >= bottomFlatStart) continue;
  if (p.z < LIFT.topZ || p.z > LIFT.bottomZ) continue; // 반원 구간 제외
  const isUp = Math.abs(p.x - centerX(p.z)) < MID_OFF;
  const c = p.y - height(p.x, p.z);
  const line = isUp ? clear.up : clear.down;
  if (c < line.min) {
    line.min = c;
    line.z = p.z;
  }
  if (isUp) {
    upLineH.min = Math.min(upLineH.min, c);
    upLineH.max = Math.max(upLineH.max, c);
  }
}
// 앉은 라이더의 발은 좌석 바닥 아래 약 0.6m (rider.ts buildSeatedRider 의 정강이/장비 기준)
check('승객 줄(오르막) 지면 여유 ≥ 6m', clear.up.min >= 6, `최소 ${clear.up.min.toFixed(1)}m @ z=${clear.up.z.toFixed(0)}`);
check('빈 줄(내리막) 지면 여유 ≥ 2m', clear.down.min >= 2, `최소 ${clear.down.min.toFixed(1)}m @ z=${clear.down.z.toFixed(0)}`);

// 3) 승강장 구간에서 좌석이 지면 아래로 파묻히지 않음
let minDeck = Infinity;
for (let s = 0; s < PATH_LENGTH; s += 1) {
  const p = poseAt(s);
  const inTop = p.z >= STATIONS.top.z - STATIONS.top.length / 2 && p.z <= topFlatEnd;
  const inBottom = p.z >= bottomFlatStart && p.z <= STATIONS.bottom.z + STATIONS.bottom.length / 2;
  if (inTop || inBottom) minDeck = Math.min(minDeck, p.y - height(p.x, p.z));
}
check('승강장 구간 좌석이 지면 위', minDeck > 0.2, `최소 ${minDeck.toFixed(2)}m`);

// 4) 경로 연속성: 위치 점프와 방향(heading) 불연속을 함께 본다
let maxJump = 0;
let maxTurn = 0;
let prev = poseAt(0);
for (let s = 0.5; s <= PATH_LENGTH; s += 0.5) {
  const p = poseAt(s);
  maxJump = Math.max(maxJump, Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z));
  maxTurn = Math.max(maxTurn, Math.abs(wrapAngle(p.heading - prev.heading)));
  prev = p;
}
check('경로 연속성 (위치 NaN/점프 없음, 0.5m당 방향 변화 ≤ 0.2rad)', Number.isFinite(maxJump) && maxJump <= 0.6 && maxTurn <= 0.2, `점프 ${maxJump.toFixed(3)}m, 최대 방향 변화 ${maxTurn.toFixed(3)}rad`);

// 5) 아무 때나 탑승 대기해도 대기 시간 ≤ 의자 주기, 탑승 후 하차까지 시간 = 예상값
const DT_L = 1 / 60;
let worstWait = 0;
let rideErr = 0;
for (let off = 0; off < period; off += period / 12) {
  let t = off;
  let boarded = -1;
  let tBoard = 0;
  while (boarded < 0 && t < off + period * 2) {
    const t0 = t;
    t += DT_L;
    for (let i = 0; i < CHAIR_COUNT; i++) {
      if (crossed(chairS(i, t0), chairS(i, t), BOARD_S)) {
        boarded = i;
        tBoard = t;
        break;
      }
    }
  }
  worstWait = Math.max(worstWait, tBoard - off);
  let tUnload = -1;
  while (tUnload < 0 && t < tBoard + RIDE_TIME * 2) {
    const t0 = t;
    t += DT_L;
    if (crossed(chairS(boarded, t0), chairS(boarded, t), UNLOAD_S)) tUnload = t;
  }
  rideErr = Math.max(rideErr, Math.abs(tUnload - tBoard - RIDE_TIME));
}
check('최대 대기 ≤ 의자 주기', worstWait <= period + 0.05, `최대 ${worstWait.toFixed(2)}초 / 주기 ${period.toFixed(2)}초`);
check('탑승→하차 시간 일치', rideErr < 0.05, `오차 ${rideErr.toFixed(3)}초`);

// 6) 고리 이음매: 경로 끝과 시작이 이어지는가 / 의자 간격이 균일한가
const seam = Math.hypot(...(() => {
  const e = poseAt(PATH_LENGTH - 1e-6);
  const f = poseAt(0);
  return [e.x - f.x, e.y - f.y, e.z - f.z];
})());
let spacingErr = 0;
for (let i = 0; i < CHAIR_COUNT; i++) {
  const d = (chairS((i + 1) % CHAIR_COUNT, 5) - chairS(i, 5) + PATH_LENGTH) % PATH_LENGTH;
  spacingErr = Math.max(spacingErr, Math.abs(d - CHAIR_SPACING));
}
check('고리 이음매 + 의자 간격 균일', seam < 1e-3 && spacingErr < 1e-6, `이음매 ${seam.toExponential(1)}m, 간격 오차 ${spacingErr.toExponential(1)}m`);

// 6-2) 탑승/하차 지점이 데크 발판 안쪽 (데크 회전을 반영한 지역 좌표)
const onDeck = (st: typeof STATIONS.top, pt: { x: number; z: number }) => {
  const dx = pt.x - st.x;
  const dz = pt.z - st.z;
  const lx = dx * Math.cos(st.heading) - dz * Math.sin(st.heading);
  const lz = dx * Math.sin(st.heading) + dz * Math.cos(st.heading);
  return { ok: Math.abs(lx) <= st.width / 2 - 1 && Math.abs(lz) <= st.length / 2 - 1, lx, lz };
};
const ob = onDeck(STATIONS.bottom, BOARD_POINT);
const ou = onDeck(STATIONS.top, UNLOAD_POINT);
check('탑승/하차 지점이 데크 안쪽', ob.ok && ou.ok, `탑승 (${ob.lx.toFixed(1)}, ${ob.lz.toFixed(1)}) · 하차 (${ou.lx.toFixed(1)}, ${ou.lz.toFixed(1)})`);

// 6-3) 가변 dt(1/30, 1/60, 1/120)에서도 같은 의자가 같은 시각에 탑승
const boardWith = (dt: number) => {
  let t = 0.3;
  for (;;) {
    const t0 = t;
    t += dt;
    for (let i = 0; i < CHAIR_COUNT; i++) if (crossed(chairS(i, t0), chairS(i, t), BOARD_S)) return { i, t };
    if (t > 20) return { i: -1, t };
  }
};
const b30 = boardWith(1 / 30);
const b60 = boardWith(1 / 60);
const b120 = boardWith(1 / 120);
check(
  '프레임 간격이 달라도 같은 의자·같은 시각 탑승',
  b30.i === b60.i && b60.i === b120.i && b30.i >= 0 && Math.abs(b30.t - b120.t) <= 1 / 30 + 1e-9,
  `의자 #${b30.i}/${b60.i}/${b120.i}, 시각 ${b30.t.toFixed(3)}/${b60.t.toFixed(3)}/${b120.t.toFixed(3)}초`,
);

// 7) 승강장 데크가 슬로프 폭(벽 ±38m) 밖에 있음
const innerEdge = (s: typeof STATIONS.top) => {
  // 데크 중심에서 슬로프 중심선까지 거리 − 폭/2
  return Math.abs(s.x - centerX(s.z)) - s.width / 2;
};
check(
  '승강장이 코스 벽 바깥',
  innerEdge(STATIONS.top) >= COURSE.halfWidth - 0.5 && innerEdge(STATIONS.bottom) >= COURSE.halfWidth - 0.5,
  `안쪽 모서리 ${innerEdge(STATIONS.bottom).toFixed(1)}m / 벽 ${COURSE.halfWidth}m`,
);

// 8) 상승 시간 목표: 탑승 → 하차 약 90초
check('상승 시간 약 90초 (85~95초)', RIDE_TIME >= 85 && RIDE_TIME <= 95, `${RIDE_TIME.toFixed(1)}초 (의자 ${(LIFT.speed * 3.6).toFixed(0)}km/h)`);

// 9) 2인승: 좌석 2개가 의자 폭 안, 동승자 점유가 결정적이고 확률이 설정과 일치, 만석 의자는 탑승 불가
check('좌석 2개, 의자 폭 안에 서로 겹치지 않음',
  LIFT.seats === 2 && seatLateral(0) < 0 && seatLateral(1) > 0 && seatLateral(1) - seatLateral(0) >= 0.7 && Math.abs(seatLateral(1)) + 0.3 <= 0.85,
  `좌석 위치 ${seatLateral(0).toFixed(2)} / ${seatLateral(1).toFixed(2)}m`);
let cnt = [0, 0, 0, 0];
let deterministic = true;
let playerClash = 0;
const total = CHAIR_COUNT * 60;
for (let i = 0; i < CHAIR_COUNT; i++) {
  for (let c = 0; c < 60; c++) {
    const m = ambientMask(i, c);
    if (m !== ambientMask(i, c)) deterministic = false;
    cnt[m]++;
    const seat = freeSeat(m);
    if (m === 3 && seat !== -1) playerClash++; // 만석인데 탑승 가능으로 나오면 안 됨
    if (seat >= 0 && (m & (1 << seat))) playerClash++; // 이미 앉은 좌석에 배정되면 안 됨
  }
}
const frac = (n: number) => n / total;
const near = (v: number, target: number) => Math.abs(v - target) < 0.03;
check(
  '동승자 점유: 결정적 + 확률이 설정과 일치 + 좌석 충돌 없음',
  deterministic && playerClash === 0 && near(frac(cnt[3]), LIFT.ambient.double * (1 - LIFT.ambient.double)) && near(frac(cnt[1] + cnt[2]), LIFT.ambient.single + LIFT.ambient.double ** 2),
  `만석 ${(frac(cnt[3]) * 100).toFixed(1)}% / 1명 ${(frac(cnt[1] + cnt[2]) * 100).toFixed(1)}% / 빈 의자 ${(frac(cnt[0]) * 100).toFixed(1)}%`,
);
// 도착 순서대로 보았을 때 만석 의자가 연속되지 않음 → 최악 대기 = 만석 1대를 보내고 다음 의자 = 의자 주기 × 2
let longestFull = 0;
let fullRun = 0;
const NCH = CHAIR_COUNT;
for (let p = 1; p < NCH * 400; p++) {
  const c = Math.ceil(p / NCH);
  const i = c * NCH - p;
  if (ambientMask(i, c) === 3) {
    fullRun++;
    longestFull = Math.max(longestFull, fullRun);
  } else fullRun = 0;
}
check('만석 의자가 연속되지 않음 (최악 대기 = 의자 주기 × 2)', longestFull <= 1, `연속 최대 ${longestFull}대 → 최악 약 ${(2 * period).toFixed(1)}초`);
// 한 회차 안에서 점유가 안 바뀜 (탑승 순간~하차까지 같은 값)
const c0 = chairCycle(7, 10);
let stable = true;
for (let t = 10; t < 10 + RIDE_TIME; t += 0.5) if (chairCycle(7, t) !== c0 && chairS(7, t) < UNLOAD_S && chairS(7, t) > 0) stable = false;
check('같은 오르막 구간에서는 점유 회차가 유지됨', stable, `의자 #7 회차 ${c0}`);

// 참고(실패 아님): 코드 리뷰에서 지적된 알려진 한계. 승강장 지오메트리를 손볼 때 이 숫자가 줄어야 함
const dk = (st: typeof STATIONS.top) => st.deckY - st.floorY;
console.log(
  `  참고  데크 박스 높이 아래 ${dk(STATIONS.bottom).toFixed(1)}m / 위 ${dk(STATIONS.top).toFixed(1)}m · 승객 줄 지상고 ${upLineH.min.toFixed(1)}~${upLineH.max.toFixed(1)}m (목표 ${LIFT.clearance}m) — 알려진 한계`,
);
console.log(`\n리프트 → 활강 한 사이클 예상: 올라가기 ${RIDE_TIME.toFixed(0)}초 + 내려오기 ${results.ski.toFixed(0)}~${results.sled.toFixed(0)}초`);
console.log(`리프트 검증: ${fails.length === 0 ? '통과' : '실패 → ' + fails.join(', ')}`);
if (fails.length) process.exitCode = 1;



// ---------------- 장애물 ----------------
console.log('\n[장애물]');
console.log(`고정 ${FIXED.length}개 (싱크홀 ${FIXED.filter((o) => o.kind === 'sinkhole').length}, 공사 구간 ${FIXED.filter((o) => o.kind === 'construction').length}) · 이동 ${MOVING.length}마리 (고라니 ${MOVING.filter((m) => m.kind === 'deer').length}, 토끼 ${MOVING.filter((m) => m.kind === 'rabbit').length})`);

// 1) 배치: 코스 안, 출발/결승에서 떨어져 있음, 서로 겹치지 않음
const allZ = [...FIXED.map((o) => o.z), ...MOVING.map((m) => m.z)].sort((a, b) => a - b);
let minGap = Infinity;
for (let i = 1; i < allZ.length; i++) minGap = Math.min(minGap, allZ[i] - allZ[i - 1]);
const inLane = FIXED.every((o) => Math.abs(o.x - centerX(o.z)) <= COURSE.halfWidth - 8);
check(
  '장애물이 코스 안, 출발·결승에서 150m 이상, 서로 60m 이상 간격',
  inLane && allZ[0] >= COURSE.startZ + 150 && allZ[allZ.length - 1] <= COURSE.finishZ - 100 && minGap >= 60,
  `첫 장애물 z=${allZ[0]}, 마지막 z=${allZ[allZ.length - 1]}, 최소 간격 ${minGap}m`,
);

// 2) 고정 장애물이 한 단면에서 차지하는 폭 (피할 길이 충분한가)
let widest = 0;
for (const o of FIXED) {
  const xs = o.parts.flatMap((p) => [p.dx - p.r, p.dx + p.r]);
  widest = Math.max(widest, Math.max(...xs) - Math.min(...xs));
}
check('고정 장애물 폭 ≤ 코스 폭의 10%', widest <= COURSE.halfWidth * 2 * 0.1, `최대 ${widest.toFixed(1)}m / 코스 ${COURSE.halfWidth * 2}m`);

// 3) 이동 장애물: 시간 t 만의 함수(결정적), 코스 안을 왕복, 방향이 바뀜
let movOk = true;
let flips = 0;
for (const m of MOVING) {
  let prevDir = movingPose(m, 0).dir;
  for (let t = 0; t < 120; t += 0.05) {
    const a = movingPose(m, t);
    const b = movingPose(m, t);
    if (a.x !== b.x || a.z !== b.z) movOk = false;
    if (Math.abs(a.x - centerX(m.z)) > m.amp + 1e-6) movOk = false;
    if (a.dir !== prevDir) {
      flips++;
      prevDir = a.dir;
    }
  }
}
check('이동 장애물 위치가 시간의 결정적 함수이며 진폭 안에서 왕복', movOk && flips > MOVING.length * 2, `120초 동안 방향 전환 ${flips}회`);

// 4) 충돌 후 흐름: 장비별로 최고 속도에서 충돌시켜 넘어짐 → 감속 → 20km/h 이하에서 일어남 → 다시 주행
console.log('  충돌 시나리오 (장비별 최고 속도로 싱크홀에 정면 충돌):');
for (const id of EQUIPMENT_ORDER) {
  const eq = EQUIPMENT[id];
  const sink = FIXED.find((o) => o.kind === 'sinkhole')!;
  const s = createPlayer();
  s.z = sink.z - 90;
  s.x = sink.x;
  s.heading = 0;
  s.speed = eq.maxSpeed;
  const log: number[] = [];
  let hitSpeed = 0;
  let getupSpeed = -1;
  let tHit = -1;
  let tGetup = -1;
  let tRide = -1;
  let monotonic = true;
  let prevSpeed = Infinity;
  let t = 0;
  for (; t < 40; t += DT) {
    const before = s.status;
    stepPlayer(s, 0, eq, DT, t, true);
    if (before === 'ride' && s.status === 'fallen') {
      tHit = t;
      hitSpeed = s.speed;
      prevSpeed = s.speed;
    }
    if (s.status === 'fallen') {
      if (s.speed > prevSpeed + 1e-9) monotonic = false;
      prevSpeed = s.speed;
    }
    if (before === 'fallen' && s.status === 'getup') {
      tGetup = t;
      getupSpeed = s.speed;
    }
    if (before === 'getup' && s.status === 'ride') {
      tRide = t;
      break;
    }
    log.push(s.speed);
  }
  const slid = s.slideDist;
  const rideAgain = tRide > 0;
  const speedBeforeRide = s.speed;
  // 다시 탑승 후 가속되는지
  for (let k = 0; k < 120; k++) stepPlayer(s, 0, eq, DT, t + k * DT, true);
  check(
    `${eq.label}: 충돌 → 감속 → ${CRASH.recoverKmh}km/h 이하에서 일어남 → 재탑승 → 다시 가속`,
    tHit > 0 && monotonic && getupSpeed * 3.6 <= CRASH.recoverKmh + 1e-6 && rideAgain && s.crashes === 1 && s.speed > speedBeforeRide,
    `충돌 ${(hitSpeed * 3.6).toFixed(0)}km/h → 미끄러짐 ${slid.toFixed(0)}m / ${(tGetup - tHit).toFixed(1)}초 → 일어날 때 ${(getupSpeed * 3.6).toFixed(0)}km/h → 재탑승까지 총 ${(tRide - tHit).toFixed(1)}초`,
  );
}

// 5) 일어난 직후에는 보호 시간 동안 다시 충돌하지 않음 (장애물 위에서 일어나도 무한 충돌 방지)
{
  const eq = EQUIPMENT.ski;
  const o = FIXED.find((q) => q.kind === 'construction')!;
  const s = createPlayer();
  s.z = o.z;
  s.x = o.x;
  s.status = 'getup';
  s.statusT = CRASH.getupTime - DT;
  s.speed = 0;
  stepPlayer(s, 0, eq, DT, 0, true); // → ride, 보호 시작
  stepPlayer(s, 0, eq, DT, 0, true);
  check('일어난 직후 보호 시간 동안은 장애물 위에 있어도 다시 넘어지지 않음', s.status === 'ride' && s.crashes === 0 && s.invuln > 0, `남은 보호 ${s.invuln.toFixed(2)}초, 충돌 ${s.crashes}회`);
}

// 6) 기본 장애물 충돌 판정 단위 확인
const f0 = FIXED[0];
check(
  '충돌 판정: 장애물 중심은 충돌, 멀리 떨어지면 충돌 없음',
  hitTest(f0.x, f0.z, 0) !== null && hitTest(f0.x + f0.radius + PLAYER_RADIUS + 3, f0.z, 0) === null,
  `${f0.id}`,
);

// 7) 피할 수 있는가: 장애물을 보고 피하는 봇과, 중앙선만 따라가는 봇을 비교
const dodgeBot: Bot = (eq, s, t) => {
  const look0 = s.z + 6;
  const look1 = s.z + Math.max(70, s.speed * 2.4);
  let best = centerX(s.z);
  let bestCost = Infinity;
  for (let off = -30; off <= 30; off += 2) {
    const x = centerX(s.z) + off;
    let cost = Math.abs(x - s.x) * 0.05 + Math.abs(off) * 0.02;
    for (const o of FIXED) {
      if (o.z < look0 || o.z > look1) continue;
      for (const p of o.parts) if (Math.abs(x - (o.x + p.dx)) < p.r + PLAYER_RADIUS + 1.5) cost += 100;
    }
    for (const m of MOVING) {
      if (m.z < look0 || m.z > look1) continue;
      const arrive = t + (m.z - s.z) / Math.max(s.speed, 10);
      if (Math.abs(x - movingPose(m, arrive).x) < m.r + PLAYER_RADIUS + 3) cost += 100;
    }
    if (cost < bestCost) {
      bestCost = cost;
      best = x;
    }
  }
  const desiredRel = clamp((best - s.x) * 0.03, -0.5, 0.5);
  const phi = fallLine(s.x, s.z).angle;
  const rel = wrapAngle(s.heading - phi);
  if (eq.steerMode === 'angle') return clamp(-desiredRel / eq.maxAngle, -1, 1);
  return clamp((rel - desiredRel) * 4, -1, 1);
};
console.log('  장애물 코스 한 판 (충돌 켬):');
const dodgeResult: Record<string, ReturnType<typeof run>> = {};
for (const id of EQUIPMENT_ORDER) {
  const naive = run(EQUIPMENT[id], centerBot, true);
  const dodge = run(EQUIPMENT[id], dodgeBot, true);
  dodgeResult[id] = dodge;
  console.log(
    `    ${EQUIPMENT[id].label.padEnd(4)} 중앙선만 따라감: 충돌 ${naive.crashes}회 ${naive.time.toFixed(1)}s │ 보고 피함: 충돌 ${dodge.crashes}회 ${dodge.time.toFixed(1)}s (장애물 없을 때 ${results[id].toFixed(1)}s)`,
  );
}
check('중앙선만 따라가면 장애물에 걸린다 (장애물이 의미 있음)', EQUIPMENT_ORDER.every((id) => run(EQUIPMENT[id], centerBot, true).crashes >= 1), '모든 장비에서 충돌 1회 이상');
check(
  '보고 피하는 봇은 거의 충돌 없이 완주 (스키·보드 ≤ 1회, 썰매 ≤ 2회)',
  dodgeResult.ski.finished && dodgeResult.board.finished && dodgeResult.sled.finished && dodgeResult.ski.crashes <= 1 && dodgeResult.board.crashes <= 1 && dodgeResult.sled.crashes <= 2,
  `스키 ${dodgeResult.ski.crashes} · 보드 ${dodgeResult.board.crashes} · 썰매 ${dodgeResult.sled.crashes}회`,
);

console.log(`\n전체 검증: ${fails.length === 0 ? '통과' : '실패 → ' + fails.join(', ')}`);
if (fails.length) process.exitCode = 1;
