// 멀티플레이어 서버: 각 클라이언트가 보내는 자기 상태를 모아 주기적으로 모두에게 뿌린다 (릴레이, 서버 시뮬레이션 없음).
import type { IncomingMessage } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { NET, parsePlayerView, randomNickname, type PlayerView, type ServerMsg } from '../src/net/protocol';

interface Conn {
  id: number;
  ip: string;
  name: string;
  ws: WebSocket;
  view: PlayerView | null;
  lastSeen: number;
  winStart: number; // 속도 제한 창 시작
  winCount: number;
}

/** 리버스 프록시 뒤에서는 X-Forwarded-For 의 첫 주소를 쓴다 */
function clientIp(req: IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
  return first || req.socket.remoteAddress || '';
}

export function startServer(port = Number(process.env.PORT ?? NET.port)) {
  const wss = new WebSocketServer({ port, maxPayload: 2048 });
  const conns = new Map<number, Conn>();
  let nextId = 1;
  let dirty = false;

  const ipCount = (ip: string) => {
    let n = 0;
    for (const c of conns.values()) if (c.ip === ip) n++;
    return n;
  };
  const send = (ws: WebSocket, m: ServerMsg) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
  };
  const broadcast = (m: ServerMsg, except?: number) => {
    const s = JSON.stringify(m);
    for (const c of conns.values()) {
      if (c.id === except || c.ws.readyState !== c.ws.OPEN) continue;
      if (c.ws.bufferedAmount > NET.maxBuffered) c.ws.terminate(); // 받지 않고 쌓기만 하는 클라이언트
      else c.ws.send(s);
    }
  };
  const drop = (c: Conn) => {
    if (!conns.delete(c.id)) return;
    broadcast({ t: 'left', id: c.id });
  };

  wss.on('error', (e) => console.error('서버 오류:', e.message));

  wss.on('connection', (ws, req) => {
    ws.on('error', () => {}); // 닫는 중인 소켓에서도 오류가 날 수 있다 (리스너가 없으면 프로세스가 죽는다)
    const ip = clientIp(req);
    if (conns.size >= NET.maxPlayers || ipCount(ip) >= NET.maxPerIp) {
      ws.close(1013, 'full');
      return;
    }
    const now = Date.now();
    const taken = new Set([...conns.values()].map((o) => o.name));
    let name = randomNickname();
    for (let i = 0; i < 20 && taken.has(name); i++) name = randomNickname(); // 겹치면 다시 뽑는다
    const c: Conn = { id: nextId++, ip, name, ws, view: null, lastSeen: now, winStart: now, winCount: 0 };
    conns.set(c.id, c);
    send(ws, { t: 'hello', id: c.id, name, names: [...conns.values()].map((o) => ({ id: o.id, name: o.name })) });
    broadcast({ t: 'join', id: c.id, name }, c.id);

    ws.on('message', (data) => {
      const t = Date.now();
      if (t - c.winStart >= 1000) {
        c.winStart = t;
        c.winCount = 0;
      }
      if (++c.winCount > NET.maxMsgPerSec) return; // 과다 전송은 버린다
      let msg: unknown;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (typeof msg !== 'object' || msg === null || (msg as { t?: unknown }).t !== 's') return;
      const v = parsePlayerView((msg as { v?: unknown }).v);
      if (!v) return;
      c.view = v;
      c.lastSeen = t;
      dirty = true;
    });
    ws.on('close', () => drop(c));
    ws.on('error', () => drop(c));
  });

  const timer = setInterval(() => {
    const now = Date.now();
    for (const c of conns.values()) {
      const limit = c.view ? NET.idleTimeout : NET.firstViewTimeout; // 처음 상태를 빨리 안 보내는 연결은 일찍 끊는다
      if (now - c.lastSeen > limit * 1000) c.ws.terminate();
    }
    if (!dirty) return;
    dirty = false;
    const p: Array<{ id: number; v: PlayerView }> = [];
    for (const c of conns.values()) if (c.view) p.push({ id: c.id, v: c.view });
    broadcast({ t: 'snap', p });
  }, NET.snapInterval * 1000);

  return {
    port: (wss.address() as { port: number }).port,
    count: () => conns.size,
    close: () =>
      new Promise<void>((res) => {
        clearInterval(timer);
        for (const c of conns.values()) c.ws.terminate();
        wss.close(() => res());
      }),
  };
}

// 직접 실행했을 때만 서버를 띄운다 (테스트에서는 startServer 를 import)
process.on('uncaughtException', (e) => console.error('예외:', e));
if (process.argv[1] && /server[\\/]index\.ts$/.test(process.argv[1])) {
  const s = startServer();
  console.log(`SnowHaven 서버 시작: ws://localhost:${s.port}`);
}
