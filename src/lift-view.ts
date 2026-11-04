// 리프트 렌더링: 케이블, 철탑, 승강장, 순환하는 의자 (위치 계산은 sim/lift.ts)
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { centerX } from './sim/terrain';
import { loadSeatedGeometry } from './rider';
import type { EquipmentId } from './sim/equipment';
import {
  LIFT, STATIONS, TOWERS, CHAIR_COUNT, PATH_LENGTH, AMBIENT_END_S, chairS, chairCycle, ambientMask, ambientColor,
  seatLateral, lateralShift, poseAt, cableVertices, type Station, type LiftPose,
} from './sim/lift';

const MID = (LIFT.upOffset + LIFT.downOffset) / 2;
const R = (LIFT.downOffset - LIFT.upOffset) / 2;
const mat = (c: number) => new THREE.MeshLambertMaterial({ color: c });

function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  return mesh;
}

function boxGeo(w: number, h: number, d: number, x: number, y: number, z: number) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

export function buildLift(scene: THREE.Scene) {
  const group = new THREE.Group();
  group.add(buildCable(), buildTowers(), buildStation(STATIONS.bottom, LIFT.bottomZ), buildStation(STATIONS.top, LIFT.topZ));
  const chairs = buildChairs();
  group.add(chairs.group);
  scene.add(group);
  return { update: chairs.update };
}

/** 케이블: 정점 사이를 얇은 상자로 이어 붙인다 */
function buildCable(): THREE.InstancedMesh {
  const v = cableVertices();
  const geo = new THREE.BoxGeometry(0.1, 0.1, 1);
  const mesh = new THREE.InstancedMesh(geo, mat(0x2b3138), v.length);
  const dummy = new THREE.Object3D();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  for (let i = 0; i < v.length; i++) {
    const n = v[(i + 1) % v.length];
    a.set(v[i].x, v[i].y, v[i].z);
    b.set(n.x, n.y, n.z);
    dummy.position.copy(a).add(b).multiplyScalar(0.5);
    dummy.lookAt(b);
    dummy.scale.set(1, 1, a.distanceTo(b) + 0.02);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.frustumCulled = false;
  return mesh;
}

function buildTowers(): THREE.Group {
  const g = new THREE.Group();
  const steel = mat(0x59626b);
  for (const t of TOWERS) {
    const tower = new THREE.Group();
    const base = t.groundY - 1;
    const top = t.cableY + 0.6;
    tower.add(box(0.5, top - base, 0.5, steel, 0, (top - base) / 2, 0));
    tower.add(box(R * 2 + 1.2, 0.3, 0.4, steel, 0, top - base, 0)); // 가로대
    for (const s of [-1, 1]) tower.add(box(0.2, 0.7, 0.2, steel, s * R, top - base - 0.35, 0)); // 케이블 받침
    tower.position.set(t.x, base, t.z);
    tower.rotation.y = t.heading;
    g.add(tower);
  }
  return g;
}

function buildStation(st: Station, turnZ: number): THREE.Group {
  const g = new THREE.Group();
  const concrete = mat(0xb9c1c8);
  const steel = mat(0x59626b);
  const deck = new THREE.Group();
  const h = st.deckY - st.floorY;
  deck.add(box(st.width, h, st.length, concrete, 0, st.floorY - st.deckY + h / 2, 0));
  deck.add(box(st.width - 0.4, 0.06, st.length - 0.4, mat(0xdfe6ea), 0, 0.03, 0)); // 윗면 얇은 판 (z-fighting 방지용 약간 위)
  deck.position.set(st.x, st.deckY, st.z);
  deck.rotation.y = st.heading;
  g.add(deck);

  // 회전 바퀴(불휠)와 받침
  const cx = centerX(turnZ) + LIFT.side * MID;
  const wheel = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.3, 28), steel);
  wheel.position.set(cx, st.cableY - 0.2, turnZ);
  g.add(wheel);
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, st.cableY - 0.4 - st.deckY, 10), steel);
  col.position.set(cx, (st.cableY - 0.4 + st.deckY) / 2, turnZ);
  g.add(col);

  // 관리실: 코스 반대편(바깥쪽) 끝
  const hz = st.z + (turnZ === LIFT.topZ ? 2 : 0);
  const hutX = centerX(hz) + LIFT.side * (MID + st.width / 2 - 1.8);
  const hut = new THREE.Group();
  hut.add(box(2.6, 2.6, 3.2, mat(0xe8eef2), 0, 1.3, 0));
  hut.add(box(3.1, 0.25, 3.7, mat(0xd8342c), 0, 2.7, 0));
  hut.position.set(hutX, st.deckY, hz);
  hut.rotation.y = st.heading;
  g.add(hut);
  return g;
}

const JACKET_COLORS = [0xf2b630, 0x2f8f6b, 0x7b5cd6, 0xe0573d, 0x2b7fd0, 0xd04f8a, 0x38b6c4, 0x8a9a3a].map((c) => new THREE.Color(c));

function colored(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function buildChairs() {
  const group = new THREE.Group();
  const seatGeo = mergeGeometries([
    boxGeo(1.7, 0.1, 0.6, 0, 0.05, 0.3), // 좌석 (2인승이라 폭 1.7m)
    boxGeo(1.7, 0.55, 0.08, 0, 0.38, 0.04), // 등받이
    boxGeo(1.7, 0.05, 0.05, 0, 0.62, 0.62), // 안전바
  ])!;
  const hangerGeo = mergeGeometries([
    boxGeo(0.08, LIFT.hang, 0.08, 0, LIFT.hang / 2, -0.02), // 행어
    boxGeo(0.3, 0.16, 0.3, 0, LIFT.hang, 0), // 케이블 집게
  ])!;
  const seats = new THREE.InstancedMesh(seatGeo, mat(0xd8342c), CHAIR_COUNT);
  const hangers = new THREE.InstancedMesh(hangerGeo, mat(0x2b3138), CHAIR_COUNT);
  seats.frustumCulled = false; // 매 프레임 위치가 바뀌므로 초기 경계 구가 맞지 않음
  hangers.frustumCulled = false;
  group.add(seats, hangers);

  // 배경 동승자: 좌석마다 (몸통=외투색 인스턴스 색) + (머리·다리·스키=고정 색) 두 메시
  const slots = CHAIR_COUNT * LIFT.seats;
  const jacketGeo = boxGeo(0.5, 0.64, 0.34, 0, 0.62, -0.03);
  const fixedGeo = mergeGeometries([
    colored(boxGeo(0.42, 0.2, 0.55, 0, 0.2, 0.05), 0x2c4a7a), // 허벅지
    colored(boxGeo(0.4, 0.55, 0.22, 0, -0.17, 0.32), 0x2c4a7a), // 정강이
    colored(new THREE.SphereGeometry(0.28, 10, 8).translate(0, 1.24, -0.03), 0xe8a06a), // 머리
    colored(boxGeo(0.36, 0.1, 0.1, 0, 1.28, 0.2), 0x23272e), // 고글
    colored(boxGeo(0.12, 0.05, 1.9, -0.2, -0.52, 0.55), 0xd8342c), // 스키
    colored(boxGeo(0.12, 0.05, 1.9, 0.2, -0.52, 0.55), 0xd8342c),
  ])!;
  const jackets = new THREE.InstancedMesh(jacketGeo, mat(0xffffff), slots);
  const fixed = new THREE.InstancedMesh(fixedGeo, new THREE.MeshLambertMaterial({ vertexColors: true }), slots);
  jackets.frustumCulled = false;
  fixed.frustumCulled = false;
  jackets.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(slots * 3), 3);
  group.add(jackets, fixed);

  // GLB 캐릭터가 로드되면 박스 동승자를 대체한다 (장비 3종 × 인스턴싱, 좌석마다 장비를 섞어 태움)
  const KINDS: EquipmentId[] = ['ski', 'board', 'sled'];
  let glb: THREE.InstancedMesh[] | null = null;
  Promise.all(KINDS.map(loadSeatedGeometry))
    .then((geos) => {
      const hideAll = new THREE.Matrix4().makeScale(0, 0, 0);
      // 전부 만든 뒤에 한 번에 붙인다 (중간에 실패해도 씬에 찌꺼기가 남지 않음)
      const meshes = geos.map((g) => {
        const m = new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }), slots);
        m.frustumCulled = false;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        for (let i = 0; i < slots; i++) m.setMatrixAt(i, hideAll);
        return m;
      });
      meshes.forEach((m) => group.add(m));
      glb = meshes;
      jackets.visible = false;
      fixed.visible = false;
    })
    .catch((e) => console.warn('동승자 GLB 로드 실패, 박스 모델 유지', e));

  const dummy = new THREE.Object3D();
  const hide = new THREE.Matrix4().makeScale(0, 0, 0);
  const pose: LiftPose = { x: 0, y: 0, z: 0, heading: 0 };
  const update = (t: number) => {
    for (let i = 0; i < CHAIR_COUNT; i++) {
      const raw = i * (PATH_LENGTH / CHAIR_COUNT) + t * LIFT.speed;
      poseAt(chairS(i, t), pose);
      dummy.position.set(pose.x, pose.y, pose.z);
      dummy.rotation.y = pose.heading;
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      seats.setMatrixAt(i, dummy.matrix);
      hangers.setMatrixAt(i, dummy.matrix);

      const onUp = raw % PATH_LENGTH <= AMBIENT_END_S;
      const cycle = chairCycle(i, t);
      const mask = onUp ? ambientMask(i, cycle) : 0;
      for (let k = 0; k < LIFT.seats; k++) {
        const slot = i * LIFT.seats + k;
        if (!(mask & (1 << k))) {
          if (glb) for (let j = 0; j < glb.length; j++) glb[j].setMatrixAt(slot, hide);
          else {
            jackets.setMatrixAt(slot, hide);
            fixed.setMatrixAt(slot, hide);
          }
          continue;
        }
        const [dx, dz] = lateralShift(pose.heading, seatLateral(k));
        dummy.position.set(
          pose.x + dx + Math.sin(pose.heading) * 0.3,
          pose.y,
          pose.z + dz + Math.cos(pose.heading) * 0.3,
        );
        dummy.updateMatrix();
        const ci = ambientColor(i, cycle, k);
        if (glb) {
          const pick = ci % 3; // 장비 종류는 좌석·주기마다 고정된 해시값으로 정한다
          for (let j = 0; j < glb.length; j++) glb[j].setMatrixAt(slot, j === pick ? dummy.matrix : hide);
        } else {
          jackets.setMatrixAt(slot, dummy.matrix);
          fixed.setMatrixAt(slot, dummy.matrix);
          jackets.setColorAt(slot, JACKET_COLORS[ci]);
        }
      }
    }
    seats.instanceMatrix.needsUpdate = true;
    hangers.instanceMatrix.needsUpdate = true;
    if (glb) {
      for (let j = 0; j < glb.length; j++) glb[j].instanceMatrix.needsUpdate = true;
    } else {
      jackets.instanceMatrix.needsUpdate = true;
      fixed.instanceMatrix.needsUpdate = true;
      if (jackets.instanceColor) jackets.instanceColor.needsUpdate = true;
    }
  };
  update(0);
  return { group, update };
}
