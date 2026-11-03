// 눈 덮인 산: 지형 메시, 나무, 코스 표시 폴, 출발/결승 게이트
import * as THREE from 'three';
import { COURSE, centerX, height } from './sim/terrain';
import { LIFT } from './sim/lift';

/** 재현 가능한 난수 */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function buildWorld(scene: THREE.Scene) {
  scene.add(buildTerrain());
  scene.add(buildTrees());
  scene.add(buildPoles());
  scene.add(buildGate(COURSE.startZ - 4, 0x2d8f4e));
  scene.add(buildGate(COURSE.finishZ, 0xd8342c));
}

function buildTerrain(): THREE.Mesh {
  const width = 260;
  const z0 = -60;
  const length = COURSE.endZ - z0;
  const cell = 2.5;
  const nx = Math.round(width / cell);
  const nz = Math.round(length / cell);

  const geo = new THREE.PlaneGeometry(width, length, nx, nz);
  geo.rotateX(-Math.PI / 2); // xz 평면으로 눕힘
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const snow = new THREE.Color(0xf6fafd);
  const shade = new THREE.Color(0xc4d8e8);
  const rock = new THREE.Color(0x8d9aa5);
  const tmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i) + z0 + length / 2;
    pos.setZ(i, z);
    pos.setY(i, height(x, z));
    const d = Math.abs(x - centerX(z));
    const edge = THREE.MathUtils.smoothstep(d, COURSE.halfWidth - 6, COURSE.halfWidth + 6);
    const high = THREE.MathUtils.smoothstep(d, COURSE.halfWidth + 20, COURSE.halfWidth + 55);
    tmp.copy(snow).lerp(shade, edge * 0.55).lerp(rock, high * 0.7);
    colors.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  return new THREE.Mesh(geo, mat);
}

function buildTrees(): THREE.Group {
  const group = new THREE.Group();
  const rand = rng(7);
  const count = 900;
  const coneGeo = new THREE.ConeGeometry(2.2, 7, 7);
  coneGeo.translate(0, 5.5, 0);
  const trunkGeo = new THREE.CylinderGeometry(0.3, 0.4, 2.2, 6);
  trunkGeo.translate(0, 1.1, 0);
  const cones = new THREE.InstancedMesh(coneGeo, new THREE.MeshLambertMaterial({ color: 0x2f6b4a }), count);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x5b4331 }), count);
  let placed = 0;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    const z = COURSE.startZ - 30 + rand() * (COURSE.endZ - COURSE.startZ + 20);
    const side = rand() < 0.5 ? -1 : 1;
    const off = COURSE.halfWidth + 6 + rand() * 45;
    const x = centerX(z) + side * off;
    const s = 0.8 + rand() * 0.9;
    const sy = s * (0.9 + rand() * 0.4);
    // 리프트 라인(과 승강장) 아래는 나무를 심지 않는다
    if (side === LIFT.side && off > LIFT.upOffset - 8 && off < LIFT.downOffset + 9) continue;
    p.set(x, height(x, z) - 0.2, z);
    sc.set(s, sy, s);
    m.compose(p, q, sc);
    cones.setMatrixAt(placed, m);
    trunks.setMatrixAt(placed, m);
    placed++;
  }
  cones.count = placed;
  trunks.count = placed;
  group.add(cones, trunks);
  return group;
}

/** 코스 양쪽 가장자리에 붉은/푸른 폴을 세워 속도감과 방향을 준다 */
function buildPoles(): THREE.Group {
  const group = new THREE.Group();
  const step = 25;
  const n = Math.floor((COURSE.finishZ - COURSE.startZ) / step);
  const geo = new THREE.CylinderGeometry(0.12, 0.12, 3.2, 6);
  geo.translate(0, 1.6, 0);
  const red = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xd8342c }), n * 2);
  const blue = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0x1f6fd0 }), n * 2);
  const m = new THREE.Matrix4();
  let ri = 0;
  let bi = 0;
  for (let i = 0; i < n; i++) {
    const z = COURSE.startZ + i * step;
    for (const side of [-1, 1]) {
      const x = centerX(z) + side * (COURSE.halfWidth - 4);
      m.makeTranslation(x, height(x, z), z);
      if ((i + (side > 0 ? 1 : 0)) % 2 === 0) red.setMatrixAt(ri++, m);
      else blue.setMatrixAt(bi++, m);
    }
  }
  red.count = ri;
  blue.count = bi;
  group.add(red, blue);
  return group;
}

function buildGate(z: number, color: number): THREE.Group {
  const g = new THREE.Group();
  const w = COURSE.halfWidth - 8;
  const cx = centerX(z);
  const mat = new THREE.MeshLambertMaterial({ color });
  for (const side of [-1, 1]) {
    const x = cx + side * w;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 9, 8), mat);
    pole.position.set(x, height(x, z) + 4.5, z);
    g.add(pole);
  }
  const beamY = Math.max(height(cx - w, z), height(cx + w, z)) + 8.6;
  const beam = new THREE.Mesh(new THREE.BoxGeometry(w * 2 + 0.7, 1.2, 0.5), mat);
  beam.position.set(cx, beamY, z);
  g.add(beam);
  return g;
}
