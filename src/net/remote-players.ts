// 다른 플레이어를 화면에 그린다: 받은 상태를 목표로 부드럽게 따라가고, 모델·기울기·넘어짐을 내 캐릭터와 같은 방식으로 연출
import * as THREE from 'three';
import { buildRider, buildSeatedRider } from '../rider';
import { applyFallPose } from '../rider-motion';
import { EQUIPMENT } from '../sim/equipment';
import { height } from '../sim/terrain';
import { wrapAngle } from '../sim/physics';
import { parsePlayerView, type EquipId, type PlayerView } from './protocol';

/** 감각 조정용 값 */
export const REMOTE = {
  follow: 14, // 목표 위치를 따라가는 빠르기 (1/s). 클수록 즉각, 작을수록 부드럽지만 늦음
  maxExtrapolate: 0.15, // 마지막 상태 이후 속도로 앞질러 그리는 최대 시간 (s)
  teleportDist: 25, // 이보다 멀어지면 보간하지 않고 바로 이동 (리스폰 등)
};

class Remote {
  readonly root = new THREE.Group();
  private readonly lean = new THREE.Group();
  private model: THREE.Group | null = null;
  private modelKey = '';
  private v: PlayerView;
  private recvAt = 0;
  private fresh = true;
  // 부드럽게 따라가는 현재 값
  private pos = new THREE.Vector3();
  private heading = 0;
  private up = new THREE.Vector3(0, 1, 0);
  private roll = 0;
  private tuck = 0;
  private twist = 0;
  private readonly fwd = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly basis = new THREE.Matrix4();
  private readonly tmp = new THREE.Vector3();

  constructor(v: PlayerView, now: number) {
    this.v = v;
    this.recvAt = now;
    this.root.add(this.lean);
  }

  setTarget(v: PlayerView, now: number) {
    this.v = v;
    this.recvAt = now;
  }

  private ensureModel() {
    const key = `${this.v.eq}:${this.v.seated}`;
    if (key === this.modelKey) return;
    this.modelKey = key;
    if (this.model) this.lean.remove(this.model);
    this.model = this.v.seated ? buildSeatedRider(this.v.eq) : buildRider(this.v.eq);
    this.lean.add(this.model);
  }

  update(dt: number, now: number) {
    this.ensureModel();
    const v = this.v;
    // 마지막 상태 이후 시간만큼 진행 방향으로 앞질러 그려 네트워크 주기(15Hz)의 끊김을 가린다
    const e = v.seated || v.st !== 'ride' ? 0 : Math.min(REMOTE.maxExtrapolate, (now - this.recvAt) / 1000);
    const tx = v.x + Math.sin(v.h) * v.sp * e;
    const tz = v.z + Math.cos(v.h) * v.sp * e;
    const ty = e > 0 ? v.y + (height(tx, tz) - height(v.x, v.z)) : v.y;

    const k = this.fresh ? 1 : 1 - Math.exp(-dt * REMOTE.follow);
    const far = this.pos.distanceToSquared(this.tmp.set(tx, ty, tz)) > REMOTE.teleportDist * REMOTE.teleportDist;
    const kk = far ? 1 : k;
    this.pos.lerp(this.tmp.set(tx, ty, tz), kk);
    this.heading += wrapAngle(v.h - this.heading) * kk;
    this.up.lerp(this.tmp.set(v.ux, v.uy, v.uz), kk);
    if (this.up.lengthSq() < 1e-6) this.up.set(v.ux, v.uy, v.uz); // 반대 방향 보간으로 0이 된 경우
    this.up.normalize();
    this.fresh = false;

    this.fwd.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    this.fwd.addScaledVector(this.up, -this.fwd.dot(this.up));
    if (this.fwd.lengthSq() < 1e-6) this.fwd.set(0, 0, 1).addScaledVector(this.up, -this.up.z); // 바로 위/아래를 볼 때
    this.fwd.normalize();
    this.right.crossVectors(this.up, this.fwd).normalize();
    this.basis.makeBasis(this.right, this.up, this.fwd);
    this.root.quaternion.setFromRotationMatrix(this.basis);
    this.root.position.copy(this.pos);

    if (v.st !== 'ride' && !v.seated) {
      applyFallPose(this.lean, v.st, v.stT + (now - this.recvAt) / 1000, v.crashes);
      this.roll = this.tuck = this.twist = 0;
      return;
    }
    // 타는 연출: 내 캐릭터와 같은 파라미터 (equipment.ts 의 look)
    const look = EQUIPMENT[v.eq as EquipId].look;
    const on = !v.seated;
    const tl = on ? THREE.MathUtils.clamp(-v.tv * look.leanPerTurn, -look.maxLean, look.maxLean) : 0;
    const tt = on ? look.tuckAtTop * Math.min(1, v.sp / EQUIPMENT[v.eq as EquipId].maxSpeed) : 0;
    const tw = on ? THREE.MathUtils.clamp(v.tv * look.twistPerTurn, -0.4, 0.4) : 0;
    const a = Math.min(1, dt * look.response);
    this.roll += (tl - this.roll) * a;
    this.tuck += (tt - this.tuck) * a;
    this.twist += (tw - this.twist) * a;
    this.lean.rotation.set(this.tuck, this.twist, this.roll);
    this.lean.position.y = 0;
  }
}

/** 원격 플레이어 전체를 관리한다 */
export class RemotePlayers {
  readonly group = new THREE.Group();
  private readonly map = new Map<number, Remote>();

  /** 서버 스냅샷 반영. selfId 는 제외한다 */
  applySnapshot(list: Array<{ id: number; v: PlayerView }>, selfId: number, now: number) {
    const alive = new Set<number>();
    for (const e of list) {
      if (typeof e !== 'object' || e === null || typeof e.id !== 'number') continue;
      const id = e.id;
      const v = parsePlayerView(e.v); // 서버/버전이 달라도 안전하게
      if (!v || id === selfId) continue;
      alive.add(id);
      const r = this.map.get(id);
      if (r) r.setTarget(v, now);
      else {
        const n = new Remote(v, now);
        this.map.set(id, n);
        this.group.add(n.root);
      }
    }
    // 스냅샷에 없는 사람은 나갔다고 본다 (left 메시지를 놓쳤을 때의 안전장치)
    for (const id of [...this.map.keys()]) if (!alive.has(id)) this.remove(id);
  }

  remove(id: number) {
    const r = this.map.get(id);
    if (!r) return;
    this.group.remove(r.root);
    this.map.delete(id);
  }

  clear() {
    for (const id of [...this.map.keys()]) this.remove(id);
  }

  update(dt: number, now: number) {
    for (const [id, r] of this.map) {
      try {
        r.update(dt, now);
      } catch {
        this.remove(id); // 한 명의 오류가 렌더 루프를 멈추지 않게
      }
    }
  }

  get count() {
    return this.map.size;
  }
}
