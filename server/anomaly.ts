// 이상 이동 감지: 클라이언트가 보낸 상태가 물리적으로 말이 되는지 서버가 확인한다 (서버는 시뮬레이션을 하지 않으므로 "있을 수 없는 값"만 걸러낸다).
//  - 주장한 속도가 장비 최고 속도를 넘으면 최고 속도로 깎고 위반 점수를 준다.
//  - 이동 거리는 "이동 예산"(미터)으로 관리한다: 예산은 최고 속도 x 1.5 로 시간에 따라 차오르고(상한 있음), 움직일 때마다 줄어든다.
//    메시지마다 여유를 새로 주면 스피드핵이 통과하므로, 여유는 누적 예산 하나뿐이다.
//  - 예산을 넘는 이동은 "점프". 리프트 건너뛰기, 다시 시작(R), 승강장 복귀처럼 정상적인 순간이동이 있으므로 점프는 일정 횟수까지 허용하고
//    (횟수는 시간이 지나며 회복), 초과분은 이전 위치로 고정한다. 고정이 오래 가면 연결을 끊는다.
//  - 클라이언트는 이동 연출(transfer) 중에는 출발 위치를 보내고 도착 후 새 위치를 보내므로, 연출은 점프 1회로 보인다.
//  - 위반 점수는 시간이 지나면 줄고, 한도를 넘으면 연결을 끊는다.
import { EQUIPMENT, TOP_SPEED } from '../src/sim/equipment';
import type { PlayerView } from '../src/net/protocol';

export const ANOMALY = {
  /** 이동 허용 속도 = 장비 최고 속도의 몇 배 (지형 가속, 네트워크 지연 여유) */
  speedFactor: 1.5,
  /** 이동 예산 상한 (m): 메시지가 몰려서 도착해도 이 정도까지는 허용 */
  slack: 60,
  /** 주장한 속도 허용 배수 */
  claimFactor: 1.25,
  /** 허용되는 점프 수 (한 번에 쌓아 둘 수 있는 양)와 1회 회복 시간 (초) */
  jumpBurst: 5,
  jumpRefillSec: 20,
  /** 위반 점수: 속도 거짓 주장 1회, 거부된 점프 메시지 1회 */
  claimStrike: 1,
  frozenStrike: 0.1,
  /** 이전 위치로 고정된 상태가 이 시간(초)을 넘으면 연결 종료 (살아만 있는 유령 아바타 방지) */
  frozenKickSec: 10,
  /** 이 점수를 넘으면 연결 종료. 점수는 초당 strikeDecay 만큼 줄어든다 */
  strikeLimit: 20,
  strikeDecay: 0.1,
} as const;

export interface CheckResult {
  /** 다른 사람들에게 전달할 상태 (속도를 깎거나 이전 위치로 고정했을 수 있다) */
  view: PlayerView;
  kick: boolean;
  /** 이번 메시지에서 걸린 항목 (로그/테스트용) */
  flags: Array<'speed' | 'jump' | 'frozen'>;
}

export class MoveTracker {
  private prev: PlayerView | null = null;
  private prevAt = 0;
  private jumps: number = ANOMALY.jumpBurst;
  private jumpAt = 0;
  private strikes = 0;
  private strikeAt = 0;
  private credit: number = ANOMALY.slack; // 이동 예산 (m)
  private creditAt = 0;
  private frozenSince = 0; // 0 이면 고정 아님

  /** now: 밀리초 */
  check(input: PlayerView, now: number): CheckResult {
    let v = input;
    const flags: CheckResult['flags'] = [];

    // 시간에 따라 점수는 줄고 점프 횟수는 회복된다
    this.strikes = Math.max(0, this.strikes - ((now - this.strikeAt) / 1000) * ANOMALY.strikeDecay);
    this.strikeAt = now;
    this.jumps = Math.min(ANOMALY.jumpBurst, this.jumps + (now - this.jumpAt) / 1000 / ANOMALY.jumpRefillSec);
    this.jumpAt = now;
    this.credit = Math.min(ANOMALY.slack, this.credit + TOP_SPEED * ANOMALY.speedFactor * ((now - this.creditAt) / 1000));
    this.creditAt = now;

    const maxClaim = EQUIPMENT[v.eq].maxSpeed * ANOMALY.claimFactor + 2;
    if (Math.abs(v.sp) > maxClaim) {
      v = { ...v, sp: Math.sign(v.sp) * maxClaim };
      this.strikes += ANOMALY.claimStrike;
      flags.push('speed');
    }

    if (this.prev) {
      const dist = Math.hypot(v.x - this.prev.x, v.y - this.prev.y, v.z - this.prev.z);
      // 고정된 동안은 "마지막으로 받아들인 때부터 흐른 시간" 만큼 움직일 수 있었다고 보고 따라잡게 한다
      const limit = this.frozenSince ? TOP_SPEED * ANOMALY.speedFactor * ((now - this.prevAt) / 1000) + ANOMALY.slack : this.credit;
      if (dist <= limit) {
        this.credit = Math.max(0, this.credit - dist);
        this.frozenSince = 0;
      } else if (this.jumps >= 1) {
        this.jumps -= 1; // 정상적인 순간이동으로 보고 한 번 허용
        this.credit = 0;
        this.frozenSince = 0;
        flags.push('jump');
      } else {
        // 점프 횟수 초과: 이전 상태로 고정한다 (prev/prevAt 은 그대로)
        if (!this.frozenSince) this.frozenSince = now;
        this.strikes += ANOMALY.frozenStrike;
        flags.push('frozen');
        const kick = this.strikes >= ANOMALY.strikeLimit || now - this.frozenSince > ANOMALY.frozenKickSec * 1000;
        return { view: this.prev, kick, flags };
      }
    }
    this.prev = v;
    this.prevAt = now;
    return { view: v, kick: this.strikes >= ANOMALY.strikeLimit, flags };
  }
}
