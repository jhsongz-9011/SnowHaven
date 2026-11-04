// 장비별 라이더 모델 (단순한 저폴리 캐릭터)
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { EquipmentId } from './sim/equipment';

// ── GLB 캐릭터 (Blender 제작) ─────────────────────────────
/** 모델 크기 배율 (감각 조정용) */
export const MODEL_SCALE = 1.25;
/** 리프트 착석 모델 오프셋: 모델 골반이 좌석 바닥보다 얼마나 위/앞에 오는지 */
const SEAT_OFFSET = { y: -0.34, z: 0.2 };

const loader = new GLTFLoader();
const gltfCache = new Map<string, Promise<THREE.Group>>();

/** GLB 는 파츠마다 메시가 따로라 라이더 하나가 드로우콜 40여 개가 된다. 같은 재질끼리 합쳐 드로우콜을 줄인다 (변환은 정점에 구워 넣음) */
function mergeByMaterial(scene: THREE.Group): THREE.Group {
  scene.updateMatrixWorld(true);
  const groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    g.applyMatrix4(mesh.matrixWorld);
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    const list = groups.get(mesh.material) ?? [];
    list.push(g);
    groups.set(mesh.material, list);
  });
  const out = new THREE.Group();
  for (const [material, geos] of groups) {
    const merged = mergeGeometries(geos);
    if (merged) out.add(new THREE.Mesh(merged, material));
  }
  if (out.children.length === 0) throw new Error('GLB 에 메시가 없음');
  return out;
}
function loadGlb(name: string): Promise<THREE.Group> {
  let p = gltfCache.get(name);
  if (!p) {
    p = loader
      .loadAsync(`${import.meta.env.BASE_URL}models/${name}.glb`)
      .then((g) => mergeByMaterial(g.scene))
      .catch((e) => {
        gltfCache.delete(name); // 실패한 로드는 캐시하지 않는다 (다음 요청에서 재시도)
        throw e;
      });
    gltfCache.set(name, p);
  }
  return p;
}
/** GLB 가 로드되면 holder 에 넣는다. 로드 중에는 비어 있고(깜빡임 방지), 실패하면 onFail 로 임시 모델을 넣는다 */
function swapInGlb(holder: THREE.Group, name: string, place: (m: THREE.Object3D) => void, onFail: () => void) {
  loadGlb(name)
    .then((src) => {
      const m = src.clone(true); // geometry/material 은 공유, 노드만 복제
      m.scale.setScalar(MODEL_SCALE);
      place(m);
      holder.clear();
      holder.add(m);
    })
    .catch((e) => {
      console.warn('GLB 로드 실패, 임시 모델 사용:', name, e);
      onFail();
    });
}

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
  const holder = new THREE.Group();
  swapInGlb(holder, `rider_${kind}_ride`, () => {}, () => holder.add(buildRiderPlaceholder(kind)));
  return holder;
}

function buildRiderPlaceholder(kind: EquipmentId): THREE.Group {
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
  const holder = new THREE.Group();
  swapInGlb(holder, `rider_${kind}_lift`, (m) => m.position.set(0, SEAT_OFFSET.y, SEAT_OFFSET.z), () => holder.add(buildSeatedPlaceholder(kind)));
  return holder;
}

function buildSeatedPlaceholder(kind: EquipmentId): THREE.Group {
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

/** 배경 동승자(인스턴싱)용: 리프트 착석 모델을 정점 색이 구워진 지오메트리 하나로 합친다. 좌석 오프셋·크기 적용 완료. 실패하면 reject */
export function loadSeatedGeometry(kind: EquipmentId): Promise<THREE.BufferGeometry> {
  return loadGlb(`rider_${kind}_lift`).then((src) => {
    const root = src.clone(true);
    root.scale.setScalar(MODEL_SCALE);
    root.position.set(0, SEAT_OFFSET.y, SEAT_OFFSET.z);
    root.updateMatrixWorld(true);
    const parts: THREE.BufferGeometry[] = [];
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const g = mesh.geometry.clone();
      g.applyMatrix4(mesh.matrixWorld);
      const c = (mesh.material as THREE.MeshStandardMaterial).color ?? new THREE.Color(0xffffff);
      const col = new Float32Array(g.attributes.position.count * 3);
      for (let i = 0; i < col.length; i += 3) {
        col[i] = c.r;
        col[i + 1] = c.g;
        col[i + 2] = c.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      parts.push(g);
    });
    const merged = mergeGeometries(parts);
    if (!merged) throw new Error(`착석 지오메트리 병합 실패: ${kind}`);
    return merged;
  });
}
