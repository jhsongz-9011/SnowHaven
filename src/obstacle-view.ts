// 장애물 렌더링: 싱크홀, 공사 구간(고깔 + 안전제일 판), 고라니, 토끼 (위치/충돌은 sim/obstacles.ts)
import * as THREE from 'three';
import { height, normal } from './sim/terrain';
import { FIXED, MOVING, movingPose, type FixedObstacle, type MovingObstacle } from './sim/obstacles';

const mat = (c: number) => new THREE.MeshLambertMaterial({ color: c });
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  return mesh;
}

/** 지형 법선에 맞춰 기울이고, heading 방향(+z 가 진행 방향)을 바라보게 배치 */
const _up = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _m = new THREE.Matrix4();
function placeOnTerrain(obj: THREE.Object3D, x: number, z: number, heading: number, lift = 0) {
  const [nx, ny, nz] = normal(x, z);
  _up.set(nx, ny, nz);
  _fwd.set(Math.sin(heading), 0, Math.cos(heading));
  _fwd.addScaledVector(_up, -_fwd.dot(_up)).normalize();
  _right.crossVectors(_up, _fwd).normalize();
  _m.makeBasis(_right, _up, _fwd);
  obj.quaternion.setFromRotationMatrix(_m);
  obj.position.set(x, height(x, z) + lift, z);
}

export function buildObstacles(scene: THREE.Scene) {
  const group = new THREE.Group();
  scene.add(group);
  for (const o of FIXED) group.add(o.kind === 'sinkhole' ? buildSinkhole(o) : buildConstruction(o));
  const movers = MOVING.map((m) => {
    const obj = m.kind === 'deer' ? buildDeer() : buildRabbit();
    group.add(obj.root);
    return { m, ...obj, heading: 0 };
  });

  const update = (t: number) => {
    for (const mv of movers) {
      const p = movingPose(mv.m, t);
      const target = p.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      // 끝에서 방향을 바꿀 때 몸이 부드럽게 돈다 (첫 프레임은 바로 맞춤)
      mv.heading = mv.heading === 0 ? target : mv.heading + wrapAngle(target - mv.heading) * 0.15;
      const hop = mv.animate(t, mv.m);
      placeOnTerrain(mv.root, p.x, p.z, mv.heading, hop);
    }
  };
  update(0);
  return { update };
}

// ---------- 고정 장애물 ----------
function buildSinkhole(o: FixedObstacle): THREE.Group {
  const g = new THREE.Group();
  const flat = (geo: THREE.BufferGeometry, color: number, lift: number) => {
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    m.position.y = lift;
    return m;
  };
  g.add(flat(new THREE.RingGeometry(o.radius * 0.95, o.radius * 1.25, 28), 0x9aa7b2, 0.04)); // 무너진 가장자리
  g.add(flat(new THREE.CircleGeometry(o.radius * 0.95, 28), 0x20252b, 0.06)); // 구멍
  g.add(flat(new THREE.CircleGeometry(o.radius * 0.6, 24), 0x07090b, 0.08)); // 깊은 곳
  // 무너져 내린 흙/얼음 덩어리: 크게 만들어 멀리서도 실루엣이 보이게 한다
  const chunk = mat(0x857b70);
  const chunkLight = mat(0xb8b0a6);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + 0.3;
    const r = o.radius * (1.05 + 0.25 * (((i * 37) % 5) / 5));
    const big = i % 3 === 0;
    const c = box(0.9 + 0.3 * (i % 3), big ? 0.9 : 0.55, 0.8 + 0.2 * (i % 2), i % 2 ? chunk : chunkLight, Math.cos(a) * r, big ? 0.45 : 0.28, Math.sin(a) * r);
    c.rotation.set(0.2 * (i % 2), a * 2, 0.18);
    g.add(c);
  }
  placeOnTerrain(g, o.x, o.z, 0);
  return g;
}

function signTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffd400';
  ctx.fillRect(0, 0, 512, 256);
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 12;
  ctx.strokeRect(6, 6, 500, 244);
  // 아래쪽 경고 사선
  ctx.fillStyle = '#111';
  for (let x = -40; x < 540; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x, 256);
    ctx.lineTo(x + 32, 256);
    ctx.lineTo(x + 64, 206);
    ctx.lineTo(x + 32, 206);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = '#111';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '800 110px "Apple SD Gothic Neo","Noto Sans KR","Malgun Gothic",sans-serif';
  ctx.fillText('안전제일', 256, 105);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

let _signTex: THREE.CanvasTexture | null = null;

function buildConstruction(o: FixedObstacle): THREE.Group {
  const g = new THREE.Group(); // 월드 좌표 기준으로 각 부품의 높이를 지형에 맞춘다
  const orange = mat(0xff6a13);
  const white = mat(0xf5f5f5);
  const dark = mat(0x2a2d31);
  // 고깔 (충돌 원과 같은 위치)
  for (const p of o.parts.filter((q) => q.r < 0.5)) {
    const x = o.x + p.dx;
    const z = o.z + p.dz;
    const cone = new THREE.Group();
    cone.add(box(0.6, 0.05, 0.6, dark, 0, 0.025, 0));
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.8, 12), orange);
    body.position.y = 0.45;
    cone.add(body);
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.19, 0.1, 12), white);
    stripe.position.y = 0.4;
    cone.add(stripe);
    cone.position.set(x, height(x, z), z);
    g.add(cone);
  }
  // 안전제일 판: 다리 2개 + 판. 달려오는 쪽(−z)을 본다
  if (!_signTex) _signTex = signTexture();
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(2.1, 1.05),
    new THREE.MeshLambertMaterial({ map: _signTex, side: THREE.DoubleSide }),
  );
  const gy = Math.max(height(o.x - 0.7, o.z), height(o.x + 0.7, o.z));
  board.position.set(o.x, gy + 1.45, o.z);
  board.rotation.y = Math.PI; // 평면의 앞면(+z)이 −z 쪽을 향하게
  g.add(board);
  for (const dx of [-0.7, 0.7]) {
    const x = o.x + dx;
    const h = height(x, o.z);
    const leg = box(0.09, gy + 1.0 - h, 0.09, dark, x, (h + gy + 1.0) / 2, o.z + 0.06);
    g.add(leg);
  }
  // 경광등 느낌의 주황 박스
  g.add(box(0.3, 0.2, 0.3, orange, o.x, gy + 2.1, o.z));
  return g;
}

// ---------- 이동 장애물 ----------
interface Mover {
  root: THREE.Group;
  /** 걷기/뛰기 애니메이션을 갱신하고, 몸 전체를 띄울 높이(m)를 돌려준다 */
  animate: (t: number, m: MovingObstacle) => number;
}

function buildDeer(): Mover {
  const root = new THREE.Group();
  const fur = mat(0x9c6b3c);
  const light = mat(0xd9c3a0);
  const dark = mat(0x2a1f17);
  const body = new THREE.Group();
  root.add(body);
  body.add(box(0.55, 0.6, 1.3, fur, 0, 0.9, 0));
  body.add(box(0.45, 0.2, 1.1, light, 0, 0.62, 0.02)); // 배
  const neck = box(0.24, 0.55, 0.28, fur, 0, 1.3, 0.62);
  neck.rotation.x = 0.55;
  body.add(neck);
  body.add(box(0.26, 0.28, 0.46, fur, 0, 1.55, 0.95)); // 머리
  body.add(box(0.12, 0.1, 0.1, dark, 0, 1.5, 1.2)); // 코
  for (const s of [-1, 1]) {
    const ear = box(0.08, 0.28, 0.1, fur, s * 0.14, 1.78, 0.82);
    ear.rotation.z = s * -0.25;
    body.add(ear);
    // 고라니의 아래로 난 송곳니
    body.add(box(0.03, 0.14, 0.03, mat(0xf2efe6), s * 0.06, 1.38, 1.14));
  }
  body.add(box(0.1, 0.14, 0.1, mat(0xffffff), 0, 1.0, -0.68)); // 꼬리
  const legs: THREE.Group[] = [];
  for (const [lx, lz] of [[-0.18, 0.5], [0.18, 0.5], [-0.18, -0.5], [0.18, -0.5]]) {
    const leg = new THREE.Group();
    leg.position.set(lx, 0.62, lz);
    leg.add(box(0.1, 0.72, 0.1, dark, 0, -0.36, 0));
    body.add(leg);
    legs.push(leg);
  }
  return {
    root,
    animate: (t, m) => {
      const ph = t * m.speed * 1.6;
      legs.forEach((l, i) => (l.rotation.x = Math.sin(ph + (i % 2 === 0 ? 0 : Math.PI) + (i > 1 ? Math.PI / 2 : 0)) * 0.7));
      body.rotation.x = Math.sin(ph * 2) * 0.04;
      return Math.abs(Math.sin(ph)) * 0.08;
    },
  };
}

function buildRabbit(): Mover {
  const root = new THREE.Group();
  const fur = mat(0xd9cdbb);
  const white = mat(0xffffff);
  const body = new THREE.Group();
  root.add(body);
  const torso = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), fur);
  torso.scale.set(0.8, 0.75, 1.2);
  torso.position.set(0, 0.28, 0);
  body.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), fur);
  head.position.set(0, 0.45, 0.36);
  body.add(head);
  for (const s of [-1, 1]) {
    const ear = box(0.06, 0.34, 0.05, fur, s * 0.07, 0.72, 0.3);
    ear.rotation.x = -0.25;
    ear.rotation.z = s * 0.1;
    body.add(ear);
    body.add(box(0.04, 0.04, 0.04, mat(0x111111), s * 0.09, 0.5, 0.5)); // 눈
  }
  const tail = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), white);
  tail.position.set(0, 0.3, -0.4);
  body.add(tail);
  body.add(box(0.12, 0.1, 0.3, fur, -0.14, 0.1, -0.2)); // 뒷다리
  body.add(box(0.12, 0.1, 0.3, fur, 0.14, 0.1, -0.2));
  return {
    root,
    animate: (t, m) => {
      const ph = t * m.speed * 0.9; // 깡충깡충
      const h = Math.abs(Math.sin(ph));
      body.rotation.x = -0.3 * Math.cos(ph) * (h > 0.05 ? 1 : 0);
      return h * 0.4;
    },
  };
}
