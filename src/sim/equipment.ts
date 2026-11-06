// 장비별 조작 파라미터. 감각 조정은 이 파일의 숫자만 바꾸면 됩니다.

export type EquipmentId = 'ski' | 'board' | 'sled';

export interface Equipment {
  id: EquipmentId;
  label: string;
  /** rate: 좌우 입력으로 방향이 회전 / angle: 폴라인 기준 제한된 각도만 조절 */
  steerMode: 'rate' | 'angle';
  /** rate 모드: 최대 회전 속도 (rad/s) */
  turnRate: number;
  /** angle 모드: 폴라인 기준 최대 조절 각 (rad) */
  maxAngle: number;
  /** 입력이 방향에 반영되는 관성 시간(초). 클수록 둔하게 따라옴 */
  turnInertia: number;
  /** 최고 속도 (m/s), 폴라인 방향으로 곧장 내려갈 때 */
  maxSpeed: number;
  /** 폴라인과 직각으로 가로지를 때 유지되는 속도 비율 (0~1) */
  sideFactor: number;
  /** 가속 시간(초) */
  accelTime: number;
  /** 감속 시간(초) */
  brakeTime: number;
  /** 입력이 없을 때 폴라인으로 돌아오려는 힘 (1/s) */
  fallPull: number;
  /** 라이더 연출 (시뮬레이션에는 영향 없음) */
  look: RideLook;
}

/** 타는 동안 몸 연출 파라미터 (rad 단위). 감각 조정은 여기 숫자만 바꾸면 된다 */
export interface RideLook {
  /** 턴 속도 1 rad/s 당 옆으로 기우는 각 */
  leanPerTurn: number;
  /** 옆으로 기우는 최대 각 */
  maxLean: number;
  /** 최고 속도에서 앞으로 숙이는 각 (속도 비례, 웅크림) */
  tuckAtTop: number;
  /** 턴 속도 1 rad/s 당 몸이 진행 방향에서 비틀리는 각 (턴 쪽으로 어깨가 먼저 돈다) */
  twistPerTurn: number;
  /** 기울기가 목표를 따라가는 빠르기 (1/s). 클수록 즉각 반응 */
  response: number;
}

const DEG = Math.PI / 180;

export const EQUIPMENT: Record<EquipmentId, Equipment> = {
  // 턴이 쉽고 속도는 중간
  ski: {
    id: 'ski',
    label: '스키',
    steerMode: 'rate',
    turnRate: 2.4,
    maxAngle: 0,
    turnInertia: 0.12,
    maxSpeed: 48,
    sideFactor: 0.45,
    accelTime: 2.0,
    brakeTime: 0.9,
    fallPull: 0.6,
    look: { leanPerTurn: 0.22, maxLean: 0.5, tuckAtTop: 0.32, twistPerTurn: 0.12, response: 9 },
  },
  // 턴이 어렵고(둔하고) 속도는 빠름
  board: {
    id: 'board',
    label: '보드',
    steerMode: 'rate',
    turnRate: 1.3,
    maxAngle: 0,
    turnInertia: 0.35,
    maxSpeed: 60,
    sideFactor: 0.6,
    accelTime: 1.6,
    brakeTime: 1.4,
    fallPull: 0.35,
    // 보드는 둔한 대신 크게 눕듯이 기울고, 몸이 많이 비틀린다
    look: { leanPerTurn: 0.34, maxLean: 0.65, tuckAtTop: 0.22, twistPerTurn: 0.2, response: 6 },
  },
  // 회전 없음, 약간의 각도 조절만. 속도는 최상
  sled: {
    id: 'sled',
    label: '썰매',
    steerMode: 'angle',
    turnRate: 0,
    maxAngle: 15 * DEG,
    turnInertia: 0.25,
    maxSpeed: 76,
    sideFactor: 0.9,
    accelTime: 1.4,
    brakeTime: 2.0,
    fallPull: 0,
    // 썰매는 거의 안 기울고 속도가 빠르면 낮게 엎드린다
    look: { leanPerTurn: 0.12, maxLean: 0.22, tuckAtTop: 0.18, twistPerTurn: 0.05, response: 7 },
  },
};

export const EQUIPMENT_ORDER: EquipmentId[] = ['ski', 'board', 'sled'];

/** 장비 중 가장 빠른 최고 속도 (카메라 연출 등 속도 비율 계산용) */
export const TOP_SPEED = Math.max(...EQUIPMENT_ORDER.map((id) => EQUIPMENT[id].maxSpeed));

/**
 * 장애물 충돌 → 넘어짐 → 미끄러짐 → 일어나 재탑승 파라미터 (모든 장비 공통).
 * 미끄러지는 거리는 충돌 순간 속도에 따라 달라진다: 속도 v 에서 dv/dt = −(slideDecel + slideDrag·v)
 */
export const CRASH = {
  /** 충돌 순간 속도가 유지되는 비율 (부딪히며 잃는 속도) */
  impactKeep: 0.85,
  /** 넘어져 미끄러질 때 일정한 감속 (m/s²) */
  slideDecel: 6,
  /** 속도에 비례하는 감속 계수 (1/s) — 빠를수록 더 크게 줄어든다 */
  slideDrag: 0.5,
  /** 이 속도(km/h) 이하로 떨어지면 일어나서 다시 탑승한다 */
  recoverKmh: 20,
  /** 넘어지는 동작(굴러 넘어짐)이 보이는 최소 시간 (s). 이 동안은 속도가 낮아도 일어나지 않는다 */
  tumbleTime: 0.7,
  /** 일어나서 장비에 다시 올라타는 데 걸리는 시간 (s) */
  getupTime: 0.9,
  /** 다시 탑승한 뒤 장애물에 다시 걸리지 않는 보호 시간 (s) */
  invulnTime: 1.5,
  /** 미끄러지는 동안 폴라인 쪽으로 방향이 돌아가는 정도 (1/s) */
  pullToFallLine: 0.8,
};
