import * as THREE from 'three';
import { Input } from './input';
import { buildRider, buildSeatedRider } from './rider';
import { SnowFx, SNOW_FX } from './snow-fx';
import { applyFallPose } from './rider-motion';
import { Net } from './net/net';
import type { PlayerView } from './net/protocol';
import { Snowfall, SkiTracks } from './env-fx';
import { buildWorld } from './world';
import { buildLift } from './lift-view';
import { buildObstacles } from './obstacle-view';
import { CRASH, EQUIPMENT, EQUIPMENT_ORDER, TOP_SPEED, type EquipmentId } from './sim/equipment';
import { createPlayer, stepPlayer, wrapAngle, type PlayerState } from './sim/physics';
import { COURSE, centerX, fallLine, height, normal } from './sim/terrain';
import {
  LIFT, BOARD_POINT, BOARD_S, UNLOAD_POINT, UNLOAD_S, CHAIR_COUNT, RIDE_LENGTH, chairS, chairCycle, ambientMask, freeSeat,
  seatLateral, lateralShift, crossed, poseAt, type LiftPose,
} from './sim/lift';

// ---------- 장면 ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const SKY = 0xbfdcf0;
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 80, 420);

scene.add(new THREE.HemisphereLight(0xffffff, 0x9fb4c8, 1.0));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(-60, 120, -40);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.3, 900);
buildWorld(scene);
const liftView = buildLift(scene);
const obstacleView = buildObstacles(scene);

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

// ---------- 상태 ----------
/**
 * station : 아래 승강장에 서 있음 (E 로 탑승 대기)
 * waiting : 의자가 오기를 기다림 (오면 자동 탑승)
 * riding  : 의자에 고정되어 위로 이동
 * transfer: 걸어서 이동하는 짧은 연출 (결승선 → 승강장, 정상 승강장 → 출발선)
 * ski     : 슬로프 활강
 */
type Mode = 'station' | 'waiting' | 'riding' | 'transfer' | 'ski';
let mode: Mode = 'station';
let equipment: EquipmentId = 'ski';
let player: PlayerState = createPlayer();
const input = new Input(document.body);

/** 리프트 시계. 의자 위치는 이 값만으로 결정된다 (멀티플레이 때 서버 시간으로 교체) */
let liftT = 0;
/** 렌더링용 시계: 고정 스텝 사이 남은 시간만큼 앞서가 고주사율 화면에서도 의자가 부드럽게 움직임 */
let renderT = 0;
let chair = -1;
/** 탑승한 좌석 번호 (0 = 왼쪽, 1 = 오른쪽) */
let mySeat = 0;
/** 테스트 버전: 우측 상단 '정상으로' 버튼 표시 (정식 버전에서는 false) */
const SHOW_SKIP = true;
/** 리프트 위에서 시선이 향하는, 진행 방향 앞쪽 거리 (m). 코스 중앙선 위의 점을 바라본다 */
const RIDE_LOOK_AHEAD = 40;
/** 리프트 위에서 아래로 내려다보는 최대 각도 (rad). 리프트가 슬로프보다 높아서 제한하지 않으면 사면만 보인다 */
const RIDE_MAX_PITCH = (14 * Math.PI) / 180;

interface Pose {
  x: number;
  y: number;
  z: number;
  heading: number;
  up: THREE.Vector3;
}
interface Transfer {
  from: Pose;
  to: Pose;
  t: number;
  dur: number;
  next: 'station' | 'ski';
  nextPlayer?: PlayerState;
}
let tr: Transfer | null = null;
const UP = new THREE.Vector3(0, 1, 0);

const skiPose = (p: PlayerState): Pose => {
  const [nx, ny, nz] = normal(p.x, p.z);
  return { x: p.x, y: height(p.x, p.z), z: p.z, heading: p.heading, up: new THREE.Vector3(nx, ny, nz) };
};
const spotPose = (p: { x: number; y: number; z: number; heading: number }): Pose => ({ ...p, up: UP.clone() });

const riderRoot = new THREE.Group(); // 위치와 표면 정렬
const riderLean = new THREE.Group(); // 턴할 때 기울기
riderRoot.add(riderLean);
scene.add(riderRoot);
const snowFx = new SnowFx();
scene.add(snowFx.points);
const snowfall = new Snowfall();
scene.add(snowfall.points);
const tracks = new SkiTracks();
scene.add(tracks.mesh);
const net = new Net(); // 서버가 없으면 조용히 재시도만 하고 혼자 플레이된다
scene.add(net.remotes.group);
let riderModel: THREE.Group | null = null;
let modelIsSeated = false;
let freeCam = false; // 디버그: true 면 카메라를 건드리지 않음
let paused = false; // 디버그: true 면 실시간 시뮬레이션을 멈춘다 (advance() 로만 진행)

/** 모델은 장비 3종 × (서 있음/앉음) 6개를 한 번만 만들어 두고 교체만 한다 (geometry 누수 방지) */
const MODELS = {
  stand: Object.fromEntries(EQUIPMENT_ORDER.map((id) => [id, buildRider(id)])) as Record<EquipmentId, THREE.Group>,
  seated: Object.fromEntries(EQUIPMENT_ORDER.map((id) => [id, buildSeatedRider(id)])) as Record<EquipmentId, THREE.Group>,
};

function applyModel() {
  const seated = mode === 'riding';
  const next = (seated ? MODELS.seated : MODELS.stand)[equipment];
  if (next === riderModel) return;
  if (riderModel) riderLean.remove(riderModel);
  riderModel = next;
  modelIsSeated = seated;
  riderLean.add(riderModel);
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
/** 서버로 보낼 내 상태 (모든 모드 공통: 월드 위치·방향 + 모델 종류) */
function buildMyView(): PlayerView {
  // 이동 연출(transfer) 중에는 출발 위치를 보낸다: 몇 백 m 를 0.9초에 보간하는 연출을 그대로 보내면 서버가 연속 순간이동으로 오해한다.
  // 도착하면 새 위치가 한 번에 전해진다 (서버는 이를 "순간이동 1회"로 허용).
  const pose = mode === 'transfer' && tr ? tr.from : currentPose();
  const skiing = mode === 'ski';
  return {
    eq: equipment,
    seated: mode === 'riding',
    st: skiing ? player.status : 'ride',
    stT: r3(skiing ? player.statusT : 0),
    crashes: player.crashes,
    x: r3(pose.x),
    y: r3(pose.y),
    z: r3(pose.z),
    h: r3(pose.heading),
    ux: r3(pose.up.x),
    uy: r3(pose.up.y),
    uz: r3(pose.up.z),
    sp: r3(skiing ? player.speed : 0),
    tv: r3(skiing ? player.turnVel : 0),
  };
}

function setEquipment(id: EquipmentId) {
  if (id === equipment && riderModel) return;
  equipment = id;
  applyModel();
  document.querySelectorAll<HTMLButtonElement>('#gear button').forEach((b) => {
    b.classList.toggle('on', b.dataset.eq === id);
  });
  (document.activeElement as HTMLElement | null)?.blur();
}

/** R: 정상 출발선에서 바로 다시 (조작감 튜닝용 지름길) */
function reset() {
  player = createPlayer();
  mode = 'ski';
  tr = null;
  chair = -1;
  camHeading = player.heading;
}

function startTransfer(from: Pose, to: Pose, dur: number, next: 'station' | 'ski', nextPlayer?: PlayerState) {
  tr = { from, to, t: 0, dur, next, nextPlayer };
  mode = 'transfer';
}

/** 테스트용: 승강장/탑승 대기/리프트 위에서 정상 출발선으로 바로 이동 (짧은 이동 연출 후 활강 시작) */
function skipToTop() {
  if (mode === 'ski' || mode === 'transfer') return;
  const cur = currentPose();
  const from: Pose = { x: cur.x, y: cur.y, z: cur.z, heading: cur.heading, up: cur.up.clone() }; // currentPose 는 공유 객체라 복사
  const np = createPlayer();
  chair = -1;
  startTransfer(from, skiPose(np), 0.9, 'ski', np);
}

/** E / 버튼: 상황에 맞는 동작 */
function action() {
  if (mode === 'station') mode = 'waiting';
  else if (mode === 'waiting') mode = 'station';
  else if (mode === 'ski' && player.finished) startTransfer(skiPose(player), spotPose(BOARD_POINT), 1.6, 'station');
}

// ---------- HUD ----------
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// 접속 상태 표시: 바뀔 때만 DOM 을 갱신한다
const netHud = $('net');
let netHudKey = '\0'; // 처음에는 어떤 상태와도 다르게 해서 오프라인 표시도 그려지게 한다
function updateNetHud() {
  const on = net.connected;
  const key = on ? `${net.selfName}|${net.remotes.count}` : '';
  if (key === netHudKey) return;
  netHudKey = key;
  netHud.className = on ? 'hud on' : 'hud';
  netHud.replaceChildren();
  const dot = document.createElement('span');
  dot.className = 'dot';
  dot.setAttribute('aria-hidden', 'true');
  const small = document.createElement('small');
  netHud.append(dot, on ? net.selfName : '오프라인');
  small.textContent = on ? `접속자 ${net.remotes.count + 1}명` : '혼자 플레이 중 (서버 연결 안 됨)';
  netHud.append(small);
}
const spdEl = $('spd');
const timeEl = $('time');
const progEl = $('prog');
const crashEl = $('crash');
const msg = $('msg');

const actionBtn = $<HTMLButtonElement>('action');
const skipBtn = $<HTMLButtonElement>('skip');
const hintEl = $('hint');
document.querySelectorAll<HTMLButtonElement>('#gear button').forEach((b) => {
  b.addEventListener('click', () => setEquipment(b.dataset.eq as EquipmentId));
});
actionBtn.addEventListener('click', () => {
  action();
  actionBtn.blur();
});
skipBtn.addEventListener('click', () => {
  skipToTop();
  skipBtn.blur();
});
input.onKey = (k) => {
  if (k === '1' || k === '2' || k === '3') setEquipment(EQUIPMENT_ORDER[Number(k) - 1]);
  if (k === 'r') reset();
  if (k === 'e' || k === ' ') {
    (document.activeElement as HTMLElement | null)?.blur();
    action();
  }
};

const TOUCH = matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches; // 터치만 있는 기기면 키보드 대신 터치 안내 (마우스/키보드도 있는 하이브리드 기기는 기존 안내)
const HINT_SKI = TOUCH ? '화면 왼쪽/오른쪽을 누르고 있으면 그 방향으로 꺾어요' : '← → / A D 방향 조절 · 1 스키 · 2 보드 · 3 썰매 · R 정상에서 다시 시작 (모바일: 화면 좌/우 터치)';
let uiKey = '';

function updateUi() {
  let label = '';
  let hint = '';
  if (mode === 'station') {
    label = '리프트 타기';
    hint = TOUCH ? '아래에서 장비를 고르고 리프트를 타세요' : 'E / 버튼으로 리프트 탑승 · 1 스키 · 2 보드 · 3 썰매 로 장비 선택';
  } else if (mode === 'waiting') {
    label = '취소';
    hint = TOUCH ? '빈 의자가 오면 자동으로 탑승해요' : '빈 자리가 있는 의자가 오면 자동으로 탑승합니다 · E 취소';
  } else if (mode === 'riding') {
    hint = TOUCH ? '올라가는 중… 장비는 지금 바꿔도 돼요' : '코스를 바라보며 올라가는 중… 장비는 지금 바꿔도 됩니다 (1 · 2 · 3)';
  } else if (mode === 'transfer') {
    hint = '이동 중…';
  } else if (mode === 'ski') {
    hint = HINT_SKI;
    if (player.finished) label = '리프트 승강장으로';
  }
  const showSkip = SHOW_SKIP && (mode === 'station' || mode === 'waiting' || mode === 'riding');
  const key = `${mode}|${label}|${hint}|${showSkip}`;
  if (key === uiKey) return;
  uiKey = key;
  skipBtn.style.display = showSkip ? 'block' : 'none';
  actionBtn.style.display = label ? 'block' : 'none';
  actionBtn.innerHTML = label ? (TOUCH ? label : `${label}<small>E</small>`) : '';
  hintEl.textContent = hint;
}

/** 값이 바뀔 때만 DOM 을 건드린다 */
function setText(el: HTMLElement, v: string) {
  if (el.textContent !== v) el.textContent = v;
}

function updateHud() {
  const riding = mode === 'riding';
  setText(spdEl, String(Math.round((riding ? LIFT.speed : mode === 'ski' ? player.speed : 0) * 3.6)));
  const t = player.finished ? player.finishTime : player.time;
  setText(timeEl, `${t.toFixed(2)} s`);
  let p = 0;
  if (mode === 'ski') p = (player.z - COURSE.startZ) / (COURSE.finishZ - COURSE.startZ);
  else if (riding) {
    p = (chairS(chair, renderT) - BOARD_S) / RIDE_LENGTH;
  }
  const w = `${(Math.max(0, Math.min(1, p)) * 100).toFixed(1)}%`;
  if (progEl.style.width !== w) progEl.style.width = w;
  const bg = riding ? '#d8342c' : '#1f7ae0';
  if (progEl.dataset.bg !== bg) {
    progEl.dataset.bg = bg;
    progEl.style.background = bg;
  }
  setText(crashEl, `충돌 ${player.crashes}회`);
  // 중앙 메시지: 완주 / 넘어짐 / 일어나는 중
  let html = '';
  if (mode === 'ski' && player.finished) {
    html = `${EQUIPMENT[equipment].label} 완주! ${player.finishTime.toFixed(2)}초<small>충돌 ${player.crashes}회 · E 리프트 승강장으로 · R 정상에서 다시 · 1/2/3 으로 장비 바꾸기</small>`;
  } else if (mode === 'ski' && player.status === 'fallen') {
    html = `${player.lastHit?.label ?? '장애물'}에 부딪혀 넘어졌다!<small>속도가 ${CRASH.recoverKmh}km/h 아래로 떨어지면 다시 일어납니다</small>`;
  } else if (mode === 'ski' && player.status === 'getup') {
    html = '다시 올라타는 중…';
  }
  if (msg.dataset.k !== html) {
    msg.dataset.k = html;
    msg.innerHTML = html;
    msg.style.display = html ? 'block' : 'none';
  }
  updateUi();
}

// ---------- 라이더와 카메라 ----------
const fwd = new THREE.Vector3();
const right = new THREE.Vector3();
const basis = new THREE.Matrix4();
let camHeading = player.heading;
let lean = 0; // 옆 기울기 (롤)
let tuck = 0; // 앞으로 숙임 (피치)
let twist = 0; // 몸 비틀림 (요)
const camPos = new THREE.Vector3();
const lookTarget = new THREE.Vector3();
const lookSmooth = new THREE.Vector3();
let lookInit = false;

const chairPose: LiftPose = { x: 0, y: 0, z: 0, heading: 0 };
const poseOut: Pose = { x: 0, y: 0, z: 0, heading: 0, up: new THREE.Vector3(0, 1, 0) };

/** 지금 상태에서 라이더가 있어야 할 위치와 방향 */
function currentPose(): Pose {
  switch (mode) {
    case 'ski':
      return skiPose(player);
    case 'riding': {
      poseAt(chairS(chair, renderT), chairPose);
      const [sx, sz] = lateralShift(chairPose.heading, seatLateral(mySeat));
      poseOut.x = chairPose.x + sx;
      poseOut.y = chairPose.y;
      poseOut.z = chairPose.z + sz;
      poseOut.heading = chairPose.heading;
      poseOut.up.copy(UP);
      return poseOut;
    }
    case 'transfer': {
      const { from, to } = tr!;
      const u = Math.min(1, tr!.t / tr!.dur);
      const e = u * u * (3 - 2 * u);
      poseOut.x = from.x + (to.x - from.x) * e;
      poseOut.z = from.z + (to.z - from.z) * e;
      poseOut.y = from.y + (to.y - from.y) * e + 1.4 * Math.sin(Math.PI * u); // 살짝 뛰어 이동
      poseOut.heading = from.heading + wrapAngle(to.heading - from.heading) * e;
      poseOut.up.copy(from.up).lerp(to.up, e).normalize();
      return poseOut;
    }
    default:
      return spotPose(BOARD_POINT); // station, waiting
  }
}

let lastCrashes = 0;
let shake = 0;
function updateRider(dt: number) {
  const pose = currentPose();
  const { x, z, heading } = pose;
  const y = pose.y;
  if ((mode === 'riding') !== modelIsSeated) applyModel();

  fwd.set(Math.sin(heading), 0, Math.cos(heading));
  fwd.addScaledVector(pose.up, -fwd.dot(pose.up)).normalize();
  right.crossVectors(pose.up, fwd).normalize();
  basis.makeBasis(right, pose.up, fwd);
  riderRoot.quaternion.setFromRotationMatrix(basis);
  riderRoot.position.set(x, y, z);

  // 타는 연출: 턴 쪽으로 기울고, 빠를수록 웅크리며, 턴 쪽으로 어깨가 먼저 돈다 (파라미터는 equipment.ts 의 look)
  const look = EQUIPMENT[equipment].look;
  const riding = mode === 'ski' && player.status === 'ride';
  const targetLean = riding ? THREE.MathUtils.clamp(-player.turnVel * look.leanPerTurn, -look.maxLean, look.maxLean) : 0;
  const targetTuck = riding ? look.tuckAtTop * Math.min(1, player.speed / EQUIPMENT[equipment].maxSpeed) : 0;
  const targetTwist = riding ? THREE.MathUtils.clamp(player.turnVel * look.twistPerTurn, -0.4, 0.4) : 0;
  const k = Math.min(1, dt * look.response);
  lean += (targetLean - lean) * k;
  tuck += (targetTuck - tuck) * k;
  twist += (targetTwist - twist) * k;
  if (mode === 'ski' && player.status !== 'ride') {
    applyFallPose(riderLean, player.status, player.statusT, player.crashes);
  } else {
    riderLean.rotation.set(tuck, twist, lean);
    riderLean.position.y = 0;
  }
  const crashed = player.crashes > lastCrashes;
  snowFx.update(
    dt,
    riderRoot.position,
    fwd,
    right,
    pose.up,
    mode === 'ski' && player.status === 'ride',
    player.speed,
    player.turnVel,
    crashed ? SNOW_FX.crashBurst : 0,
    player.status === 'fallen' && player.speed > SNOW_FX.fallenMinSpeed,
  );
  tracks.update(x, z, heading, mode === 'ski' && player.status === 'ride' && player.speed > 3, equipment);
  if (player.crashes !== lastCrashes) {
    if (player.crashes > lastCrashes) shake = 1; // 부딪힌 순간 화면이 크게 흔들림
    lastCrashes = player.crashes;
  }

  if (freeCam) return;
  // 카메라: 진행 방향 뒤쪽에서 따라가되 방향 변화는 부드럽게
  const follow = 1 - Math.exp(-dt * 3.2);
  camHeading += wrapAngle(heading - camHeading) * follow;
  const viewSpeed = mode === 'ski' ? player.speed : 0;
  const speedK = Math.min(1, viewSpeed / TOP_SPEED);
  let dist = 9 + speedK * 3;
  let h = 4.2 + speedK * 0.8;
  let lateral = 0; // 코스 쪽으로 카메라를 옮겨 케이블이 화면 중앙을 가로지르지 않게 함
  if (mode === 'riding') {
    // 의자에 앉아 코스(왼쪽)를 바라본다: 시선 = 진행 방향 앞쪽 코스 중앙선 위의 점 → 활강하는 사람들이 보인다
    dist = 4.2;
    h = 2.2;
    lateral = 0.8;
    const zt = z + Math.cos(camHeading) * RIDE_LOOK_AHEAD;
    const xt = centerX(zt);
    lookTarget.set(xt, height(xt, zt) + 2.5, zt);
  } else if (mode !== 'ski') {
    dist = 8.5;
    h = 3.6;
    lateral = 2.8;
    lookTarget.set(x + Math.sin(camHeading) * 7, y + 1.6, z + Math.cos(camHeading) * 7);
  } else {
    lookTarget.set(x + Math.sin(camHeading) * 6, y + 1.3, z + Math.cos(camHeading) * 6);
  }
  camPos.set(x - Math.sin(camHeading) * dist, y + h, z - Math.cos(camHeading) * dist);
  camPos.x -= LIFT.side * lateral;
  camPos.y = Math.max(camPos.y, height(camPos.x, camPos.z) + 1.8);
  camera.position.lerp(camPos, 1 - Math.exp(-dt * 12));
  if (shake > 0.01) {
    camera.position.x += (Math.random() - 0.5) * shake * 0.9;
    camera.position.y += (Math.random() - 0.5) * shake * 0.9;
    shake *= Math.exp(-dt * 5);
  }
  if (mode === 'riding') {
    const dh = Math.hypot(lookTarget.x - camera.position.x, lookTarget.z - camera.position.z);
    lookTarget.y = Math.max(lookTarget.y, camera.position.y - dh * Math.tan(RIDE_MAX_PITCH));
  }
  // 시선도 부드럽게 따라가야 모드가 바뀔 때(승강장 → 의자 → 활강) 화면이 휙 돌지 않는다
  if (!lookInit) {
    lookSmooth.copy(lookTarget);
    lookInit = true;
  }
  lookSmooth.lerp(lookTarget, 1 - Math.exp(-dt * (mode === 'ski' ? 18 : 5)));
  camera.lookAt(lookSmooth);

  const fov = mode === 'riding' ? 72 : 62 + speedK * 14;
  if (Math.abs(camera.fov - fov) > 0.05) {
    camera.fov += (fov - camera.fov) * Math.min(1, dt * 4);
    camera.updateProjectionMatrix();
  }
}

// ---------- 루프 (고정 1/60초 시뮬레이션) ----------
const STEP = 1 / 60;
let acc = 0;
let last = performance.now();

function stepSim(steer = input.steer()) {
  const prevT = liftT;
  liftT += STEP;
  switch (mode) {
    case 'ski':
      stepPlayer(player, steer, EQUIPMENT[equipment], STEP, liftT);
      break;
    case 'waiting':
      // 탑승 지점을 지나는 의자에 자동 탑승
      for (let i = 0; i < CHAIR_COUNT; i++) {
        if (crossed(chairS(i, prevT), chairS(i, liftT), BOARD_S)) {
          // 동승자가 이미 앉아 있으면 남는 좌석에 탄다. 만석이면 이 의자는 보내고 다음 의자를 기다림
          const seat = freeSeat(ambientMask(i, chairCycle(i, liftT)));
          if (seat < 0) continue;
          chair = i;
          mySeat = seat;
          mode = 'riding';
          break;
        }
      }
      break;
    case 'riding':
      if (crossed(chairS(chair, prevT), chairS(chair, liftT), UNLOAD_S)) {
        const np = createPlayer();
        startTransfer(spotPose(UNLOAD_POINT), skiPose(np), 1.5, 'ski', np);
        chair = -1;
      }
      break;
    case 'transfer':
      tr!.t += STEP;
      if (tr!.t >= tr!.dur) {
        if (tr!.next === 'ski' && tr!.nextPlayer) player = tr!.nextPlayer;
        mode = tr!.next;
        tr = null;
      }
      break;
    default:
      break;
  }
}

function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += dt;
  while (acc >= STEP) {
    if (!paused) stepSim();
    acc -= STEP;
  }
  renderT = liftT + acc;
  liftView.update(renderT);
  obstacleView.update(renderT);
  updateRider(dt);
  net.tick(dt, now, buildMyView, camera.position);
  updateNetHud();
  snowfall.update(dt, now / 1000, camera.position);
  updateHud();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

setEquipment('ski');
camHeading = BOARD_POINT.heading;
camera.position.set(BOARD_POINT.x, BOARD_POINT.y + 6, BOARD_POINT.z + 12);
requestAnimationFrame(frame);

// 테스트·디버그용 (개발 서버에서만 노출: advance() 는 치트로 쓸 수 있으므로 프로덕션 빌드에는 넣지 않는다)
if (import.meta.env.DEV) {
  (window as unknown as { __game: unknown }).__game = {
    get player() {
      return player;
    },
    get equipment() {
      return equipment;
    },
    get mode() {
      return mode;
    },
    get liftT() {
      return liftT;
    },
    camera,
    tracks,
    riderLean,
    net,
    set freeCam(v: boolean) {
      freeCam = v;
    },
    set paused(v: boolean) {
      paused = v;
    },
    setEquipment,
    reset,
    action,
    fallLine,
    /** 렌더링 없이 시뮬레이션만 sec 초 진행 */
    advance(sec: number, steer = 0) {
      const n = Math.round(sec / STEP);
      for (let i = 0; i < n; i++) stepSim(steer);
    },
  };
}
