// 라이더 몸 연출 (내 캐릭터와 다른 플레이어가 같이 쓴다)
import * as THREE from 'three';
import { CRASH } from './sim/equipment';
import type { RideStatus } from './net/protocol';

const easeOut = (u: number) => 1 - (1 - u) * (1 - u);

/** 넘어진 모양: 앞으로 굴러 넘어지며(튕겨 오름) 옆으로 눕고, 일어날 때 다시 선다. rig 는 riderLean 그룹 */
export function applyFallPose(rig: THREE.Object3D, status: Exclude<RideStatus, 'ride'>, statusT: number, crashes: number) {
  const side = crashes % 2 === 0 ? 1 : -1; // 넘어지는 쪽은 번갈아
  const LIE = 1.45; // 옆으로 누운 각도 (rad)
  if (status === 'fallen') {
    const u = Math.min(1, statusT / CRASH.tumbleTime);
    // 앞으로 한 바퀴 굴러서(끝 자세 = 시작 자세) 옆으로 눕는다
    rig.rotation.set(-easeOut(u) * Math.PI * 2, 0, side * LIE * easeOut(u));
    rig.position.y = 0.3 * easeOut(u) + Math.sin(Math.PI * u) * 1.3; // 튕겨 오른 뒤 내려앉음
  } else {
    const u = Math.min(1, statusT / CRASH.getupTime);
    rig.rotation.set(0, 0, side * LIE * (1 - easeOut(u)));
    rig.position.y = 0.3 * (1 - easeOut(u)) + Math.sin(Math.PI * u) * 0.15;
  }
}
