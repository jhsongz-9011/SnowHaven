// 클라이언트 ↔ 서버 메시지 규약 (양쪽이 같이 import 한다. DOM/Three 의존 없음)

export const NET = {
  port: 8787,
  /** 클라이언트가 자기 상태를 보내는 주기 (초) */
  sendInterval: 1 / 15,
  /** 서버가 모두에게 스냅샷을 뿌리는 주기 (초) */
  snapInterval: 1 / 15,
  maxPlayers: 40, // 40명이면 서버 송신량 약 35Mbps (인원^2 로 늘어난다)
  maxPerIp: 8,
  maxBuffered: 256 * 1024,
  firstViewTimeout: 5,
  /** 연결당 초당 최대 수신 메시지 수 (넘으면 무시) */
  maxMsgPerSec: 40,
  /** 이 시간(초) 동안 상태가 안 오면 서버가 해당 플레이어를 정리한다 */
  idleTimeout: 15,
} as const;

export type EquipId = 'ski' | 'board' | 'sled';
export const EQUIP_IDS: readonly EquipId[] = ['ski', 'board', 'sled'];
export type RideStatus = 'ride' | 'fallen' | 'getup';
export const STATUS_IDS: readonly RideStatus[] = ['ride', 'fallen', 'getup'];

/** 한 플레이어의 보이는 상태. 월드 좌표 기준 (위치·방향·위쪽 벡터) */
export interface PlayerView {
  eq: EquipId;
  seated: boolean; // true: 리프트 의자에 앉은 모델
  st: RideStatus;
  stT: number; // 현재 status 경과 시간 (s)
  crashes: number; // 넘어지는 방향 번갈이용
  x: number;
  y: number;
  z: number;
  h: number; // 진행 방향각
  ux: number; // 위쪽 벡터
  uy: number;
  uz: number;
  sp: number; // 속도 (m/s)
  tv: number; // 회전 속도 (rad/s)
}

export type ClientMsg = { t: 's'; v: PlayerView };

export type ServerMsg =
  | { t: 'hello'; id: number; name: string; names: Array<{ id: number; name: string }> }
  | { t: 'join'; id: number; name: string }
  | { t: 'snap'; p: Array<{ id: number; v: PlayerView }> }
  | { t: 'left'; id: number };

const num = (v: unknown, lim: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim ? v : null;

/** 받은 JSON 이 올바른 상태면 정리된 PlayerView 를, 아니면 null 을 돌려준다 (서버는 클라이언트를 믿지 않는다) */
export function parsePlayerView(raw: unknown): PlayerView | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (!EQUIP_IDS.includes(o.eq as EquipId) || !STATUS_IDS.includes(o.st as RideStatus) || typeof o.seated !== 'boolean') return null;
  const stT = num(o.stT, 1000);
  const crashes = num(o.crashes, 1e6);
  const x = num(o.x, 5000), y = num(o.y, 5000), z = num(o.z, 5000);
  const h = num(o.h, 100);
  const ux = num(o.ux, 1.01), uy = num(o.uy, 1.01), uz = num(o.uz, 1.01);
  const sp = num(o.sp, 300), tv = num(o.tv, 50);
  if ([stT, crashes, x, y, z, h, ux, uy, uz, sp, tv].some((v) => v === null)) return null;
  const len = Math.hypot(ux!, uy!, uz!);
  if (len < 0.9 || len > 1.1) return null; // 방향 벡터는 단위 길이여야 한다
  return {
    eq: o.eq as EquipId, seated: o.seated, st: o.st as RideStatus,
    stT: stT!, crashes: Math.floor(crashes!), x: x!, y: y!, z: z!, h: h!, ux: ux! / len, uy: uy! / len, uz: uz! / len, sp: sp!, tv: tv!,
  };
}

// 닉네임: 서버가 접속할 때 랜덤으로 지어 준다 (색 + 사물 + 동물). 클라이언트가 정하지 않으므로 사칭/욕설 걱정이 없다.
const THINGS = ['우산', '냄비', '모자', '장갑', '썰매', '등대', '풍선', '망원경', '열쇠', '시계', '나침반', '촛불', '방울', '깃발', '주전자', '담요'];
export const COLORS = ['빨간', '파란', '노란', '초록', '보라', '하얀', '분홍', '주황', '하늘색', '검은'];
const ANIMALS = ['여우', '펭귄', '고래', '토끼', '곰', '수달', '부엉이', '다람쥐', '늑대', '고양이', '오리', '사슴', '판다', '물범'];

export function randomNickname(rnd: () => number = Math.random): string {
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length) % a.length];
  return `${pick(COLORS)} ${pick(THINGS)} ${pick(ANIMALS)}`;
}
