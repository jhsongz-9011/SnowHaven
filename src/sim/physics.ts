// 아케이드식 이동 물리. 지형 높이맵의 경사에서 방향과 속도를 직접 계산한다.
import { COURSE, centerX, fallLine } from './terrain';
import { CRASH, type Equipment } from './equipment';
import { hitTest, type Hit } from './obstacles';

export interface PlayerState {
  x: number;
  z: number;
  /** 진행 방향각. 방향벡터 = (sinθ, cosθ) in (x, z) */
  heading: number;
  speed: number; // m/s
  turnVel: number; // 현재 회전 속도 (rad/s, 양수 = 왼쪽)
  /** 폴라인 기준 상대 각 (rad), 렌더링과 속도 계산용 */
  rel: number;
  time: number;
  finished: boolean;
  finishTime: number;
  /** ride: 정상 주행 / fallen: 넘어져 미끄러지는 중 / getup: 일어나 다시 올라타는 중 */
  status: 'ride' | 'fallen' | 'getup';
  /** 현재 status 가 시작된 뒤 경과 시간 (s) */
  statusT: number;
  /** 남은 충돌 보호 시간 (s). 다시 탑승한 직후 같은 장애물에 또 걸리지 않게 한다 */
  invuln: number;
  /** 지금까지 충돌 횟수 */
  crashes: number;
  /** 마지막으로 부딪힌 장애물 (없으면 null) */
  lastHit: Hit | null;
  /** 이번에 넘어진 뒤 미끄러진 거리 (m) */
  slideDist: number;
}

export function createPlayer(): PlayerState {
  const z = COURSE.startZ;
  const x = centerX(z);
  return {
    x,
    z,
    heading: fallLine(x, z).angle,
    speed: 0,
    turnVel: 0,
    rel: 0,
    time: 0,
    finished: false,
    finishTime: 0,
    status: 'ride',
    statusT: 0,
    invuln: 0,
    crashes: 0,
    lastHit: null,
    slideDist: 0,
  };
}

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * @param input -1(왼쪽) ~ +1(오른쪽)
 * @param worldT 세계 시계(초). 이동 장애물의 위치가 이 값으로 정해진다
 * @param collide false 면 장애물과 충돌하지 않는다 (속도 비교 같은 테스트용)
 */
export function stepPlayer(
  s: PlayerState,
  input: number,
  eq: Equipment,
  dt: number,
  worldT: number = s.time,
  collide = true,
): void {
  const { angle: phi, slope } = fallLine(s.x, s.z);

  if (s.finished) {
    // 결승선 통과 후에는 서서히 정지
    s.speed *= Math.exp(-0.9 * dt);
    s.x += Math.sin(s.heading) * s.speed * dt;
    s.z += Math.cos(s.heading) * s.speed * dt;
    s.z = Math.min(s.z, COURSE.endZ - 5);
    clampToCourse(s, phi, dt);
    return;
  }

  s.time += dt;

  // 넘어져 미끄러지는 중 / 일어나는 중: 조작은 먹지 않고 감속하며 폴라인 쪽으로 미끄러진다
  if (s.status !== 'ride') {
    s.statusT += dt;
    s.turnVel = 0;
    s.speed = Math.max(0, s.speed - (CRASH.slideDecel + CRASH.slideDrag * s.speed) * dt);
    s.heading += wrapAngle(phi - s.heading) * Math.min(1, CRASH.pullToFallLine * dt);
    s.rel = wrapAngle(s.heading - phi);
    const dx = Math.sin(s.heading) * s.speed * dt;
    const dz = Math.cos(s.heading) * s.speed * dt;
    s.x += dx;
    s.z += dz;
    s.slideDist += Math.hypot(dx, dz);
    clampToCourse(s, phi, dt);
    if (s.status === 'fallen' && s.statusT >= CRASH.tumbleTime && s.speed * 3.6 <= CRASH.recoverKmh) {
      s.status = 'getup';
      s.statusT = 0;
    } else if (s.status === 'getup' && s.statusT >= CRASH.getupTime) {
      s.status = 'ride';
      s.statusT = 0;
      s.invuln = CRASH.invulnTime;
    }
    checkFinish(s);
    return;
  }

  // 1) 방향
  if (eq.steerMode === 'rate') {
    const targetOmega = -input * eq.turnRate; // 오른쪽 입력 = θ 감소
    s.turnVel += (targetOmega - s.turnVel) * (1 - Math.exp(-dt / eq.turnInertia));
    s.heading += s.turnVel * dt;
    // 입력이 없으면 폴라인으로 서서히 복귀
    const rel0 = wrapAngle(s.heading - phi);
    s.heading -= rel0 * eq.fallPull * (1 - Math.abs(input) * 0.8) * dt;
    s.rel = wrapAngle(s.heading - phi);
  } else {
    const target = -input * eq.maxAngle;
    const cur = wrapAngle(s.heading - phi);
    const next = cur + (target - cur) * (1 - Math.exp(-dt / eq.turnInertia));
    s.heading = phi + next;
    s.turnVel = (next - cur) / dt;
    s.rel = next;
  }

  // 2) 속도: 폴라인과 정렬될수록 빠르고, 옆으로 가로지를수록 느려짐
  const a = Math.cos(s.rel);
  const f = a >= 0 ? eq.sideFactor + (1 - eq.sideFactor) * a : eq.sideFactor * (1 + a);
  const slopeFactor = clamp(0.8 + 0.2 * (slope / 0.3), 0.8, 1.2);
  const target = eq.maxSpeed * f * slopeFactor;
  const tau = target > s.speed ? eq.accelTime : eq.brakeTime;
  s.speed += (target - s.speed) * (1 - Math.exp(-dt / tau));

  // 3) 이동
  s.x += Math.sin(s.heading) * s.speed * dt;
  s.z += Math.cos(s.heading) * s.speed * dt;

  clampToCourse(s, phi, dt);

  // 4) 장애물 충돌 → 넘어짐
  if (collide) {
    if (s.invuln > 0) s.invuln = Math.max(0, s.invuln - dt);
    else {
      const hit = hitTest(s.x, s.z, worldT);
      if (hit) {
        s.status = 'fallen';
        s.statusT = 0;
        s.crashes++;
        s.lastHit = hit;
        s.slideDist = 0;
        s.speed *= CRASH.impactKeep;
        s.turnVel = 0;
      }
    }
  }

  // 5) 결승
  checkFinish(s);
}

function checkFinish(s: PlayerState): void {
  if (s.z >= COURSE.finishZ) {
    s.finished = true;
    s.finishTime = s.time;
    s.status = 'ride'; // 결승선을 넘으면 일어서서 멈춘다
    s.statusT = 0;
  }
}

/** 슬로프 좌우 벽에 부딪히면 속도를 잃고 코스 안쪽으로 밀려난다 */
function clampToCourse(s: PlayerState, phi: number, dt: number): void {
  const cx = centerX(s.z);
  const d = s.x - cx;
  if (Math.abs(d) > COURSE.halfWidth) {
    s.x = cx + Math.sign(d) * COURSE.halfWidth;
    s.speed *= Math.exp(-1.6 * dt);
    s.heading += wrapAngle(phi - s.heading) * Math.min(1, 6 * dt);
  }
}
