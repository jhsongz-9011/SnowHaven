// 서버 연결: 내 상태를 주기적으로 보내고, 받은 스냅샷을 원격 플레이어로 반영한다. 서버가 없어도 게임은 혼자 정상 동작한다.
import type * as THREE from 'three';
import { NET, type ClientMsg, type PlayerView, type ServerMsg } from './protocol';
import { RemotePlayers } from './remote-players';

function serverUrl(): string {
  const env = import.meta.env.VITE_WS_URL as string | undefined;
  if (env) return env;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const host = location.hostname.includes(':') ? `[${location.hostname}]` : location.hostname; // IPv6
  return `${proto}://${host}:${NET.port}`;
}

export class Net {
  readonly remotes = new RemotePlayers();
  selfId = 0;
  selfName = '';
  private ws: WebSocket | null = null;
  private lastSend = 0;
  private retry = 0;
  private reconnectAt = 0;
  private readonly url = serverUrl();

  get connected() {
    return this.selfId > 0 && this.ws?.readyState === WebSocket.OPEN;
  }

  private open(now: number) {
    this.reconnectAt = Infinity; // 연결 시도 중에는 다시 시도하지 않는다
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleRetry(now);
      return;
    }
    this.ws = ws;
    ws.onmessage = (ev) => {
      let m: ServerMsg;
      try {
        m = JSON.parse(String(ev.data)) as ServerMsg;
        if (typeof m !== 'object' || m === null) return;
      } catch {
        return;
      }
      const t = performance.now();
      if (m.t === 'hello') {
        this.selfId = m.id;
        this.selfName = String(m.name ?? '').slice(0, 40);
        this.retry = 0;
        if (Array.isArray(m.names))
          for (const n of m.names.slice(0, 64)) {
            if (typeof n === 'object' && n !== null && typeof n.id === 'number' && n.id !== m.id && typeof n.name === 'string') this.remotes.setName(n.id, n.name.slice(0, 40));
          }
      } else if (m.t === 'join') {
        if (typeof m.id === 'number' && m.id !== this.selfId && typeof m.name === 'string') this.remotes.setName(m.id, m.name.slice(0, 40));
      } else if (m.t === 'snap') {
        if (Array.isArray(m.p)) this.remotes.applySnapshot(m.p, this.selfId, t);
      } else if (m.t === 'left') this.remotes.remove(m.id);
    };
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      this.selfId = 0;
      this.remotes.clear();
      this.scheduleRetry(performance.now());
    };
    ws.onerror = () => ws.close();
  }

  private scheduleRetry(now: number) {
    this.retry++;
    this.reconnectAt = now + Math.min(30000, 1000 * 2 ** Math.min(this.retry, 5)); // 2,4,8,16,30초…
  }

  /** 매 프레임 호출. getView 는 보낼 때만 불린다 (불필요한 계산 방지) */
  tick(dt: number, now: number, getView: () => PlayerView, camPos?: THREE.Vector3) {
    if (!this.ws && now >= this.reconnectAt) this.open(now);
    if (this.connected && now - this.lastSend >= NET.sendInterval * 1000) {
      this.lastSend = now;
      const msg: ClientMsg = { t: 's', v: getView() };
      this.ws!.send(JSON.stringify(msg));
    }
    this.remotes.update(dt, now, camPos);
  }
}
