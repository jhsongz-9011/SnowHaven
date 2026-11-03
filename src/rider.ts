// 장비별 라이더 모델 (단순한 저폴리 캐릭터)
import * as THREE from 'three';
import type { EquipmentId } from './sim/equipment';

const skin = new THREE.MeshLambertMaterial({ color: 0xe8a06a });
const jacket = new THREE.MeshLambertMaterial({ color: 0xf2b630 });
const pants = new THREE.MeshLambertMaterial({ color: 0x2c4a7a });
const gearDark = new THREE.MeshLambertMaterial({ color: 0x23272e });
const gearRed = new THREE.MeshLambertMaterial({ color: 0xd8342c });
const gearBlue = new THREE.MeshLambertMaterial({ color: 0x1f6fd0 });
const wood = new THREE.MeshLambertMaterial({ color: 0xa8743c });

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

function body(sitting: boolean, y0: number): THREE.Group {
  const g = new THREE.Group();
  const legH = sitting ? 0.25 : 0.55;
  g.add(box(0.42, legH, 0.3, pants, 0, y0 + legH / 2, sitting ? -0.1 : 0));
  const torsoY = y0 + legH + 0.32;
  g.add(box(0.5, 0.64, 0.34, jacket, 0, torsoY, 0));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 12), skin);
  head.position.set(0, torsoY + 0.62, 0);
  g.add(head);
  // 고글
  g.add(box(0.36, 0.1, 0.1, gearDark, 0, torsoY + 0.66, 0.24));
  return g;
}

/** 원점 = 발 아래 표면, +z = 진행 방향 */
export function buildRider(kind: EquipmentId): THREE.Group {
  const g = new THREE.Group();
  if (kind === 'ski') {
    g.add(box(0.12, 0.05, 1.9, gearRed, -0.2, 0.03, 0.1));
    g.add(box(0.12, 0.05, 1.9, gearRed, 0.2, 0.03, 0.1));
    g.add(body(false, 0.06));
  } else if (kind === 'board') {
    g.add(box(0.38, 0.06, 1.7, gearBlue, 0, 0.04, 0));
    const b = body(false, 0.07);
    b.rotation.y = Math.PI / 2; // 보드는 옆으로 선다
    g.add(b);
  } else {
    g.add(box(0.8, 0.1, 1.5, wood, 0, 0.16, 0));
    g.add(box(0.06, 0.08, 1.7, gearDark, -0.38, 0.05, 0.05));
    g.add(box(0.06, 0.08, 1.7, gearDark, 0.38, 0.05, 0.05));
    g.add(box(0.8, 0.22, 0.1, wood, 0, 0.3, 0.75));
    const b = body(true, 0.2);
    g.add(b);
  }
  return g;
}

/** 리프트 의자에 앉은 모습. 원점 = 좌석 바닥 (의자 경로점에서 앞쪽으로 0.3m 이동해 앉는다), +z = 진행 방향 */
export function buildSeatedRider(kind: EquipmentId): THREE.Group {
  const g = new THREE.Group();
  g.add(box(0.42, 0.2, 0.55, pants, 0, 0.2, 0.05)); // 허벅지
  g.add(box(0.4, 0.55, 0.22, pants, 0, -0.17, 0.32)); // 정강이가 아래로 늘어짐
  g.add(box(0.5, 0.64, 0.34, jacket, 0, 0.62, -0.03)); // 몸통
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 12), skin);
  head.position.set(0, 1.24, -0.03);
  g.add(head);
  g.add(box(0.36, 0.1, 0.1, gearDark, 0, 1.28, 0.2)); // 고글
  // 장비는 발 아래에 매달거나 무릎에 올린다
  if (kind === 'ski') {
    g.add(box(0.12, 0.05, 1.9, gearRed, -0.2, -0.52, 0.55));
    g.add(box(0.12, 0.05, 1.9, gearRed, 0.2, -0.52, 0.55));
  } else if (kind === 'board') {
    g.add(box(0.38, 0.06, 1.7, gearBlue, 0, -0.55, 0.55));
  } else {
    const sled = box(0.8, 0.1, 1.5, wood, 0, 0.55, 0.55);
    sled.rotation.x = -1.2; // 무릎 앞에 세워서 안고 탄다
    g.add(sled);
  }
  g.position.z = 0.3;
  const root = new THREE.Group();
  root.add(g);
  return root;
}
