// 서버 통합 테스트: 실제 WebSocket 클라이언트 여러 개로 릴레이/검증/퇴장 처리를 확인한다. npm run nettest
import { WebSocket } from 'ws';
import { startServer } from './index';
import { NET, type PlayerView, type ServerMsg } from '../src/net/protocol';

let fails = 0;
const ok = (cond: boolean, name: string) => {
  console.log(`${cond ? '통과' : '실패'}: ${name}`);
  if (!cond) fails++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const view = (over: Partial<PlayerView> = {}): PlayerView => ({
  eq: 'ski', seated: false, st: 'ride', stT: 0, crashes: 0,
  x: 1, y: 2, z: 3, h: 0.5, ux: 0, uy: 1, uz: 0, sp: 10, tv: 0, ...over,
});

class TestClient {
  ws: WebSocket;
  id = 0;
  msgs: ServerMsg[] = [];
  constructor(port: number) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}`);
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as ServerMsg;
      if (m.t === 'hello') this.id = m.id;
      this.msgs.push(m);
    });
  }
  open() { return new Promise<void>((r) => this.ws.once('open', () => r())); }
  sendRaw(s: string) { this.ws.send(s); }
  sendView(v: PlayerView) { this.ws.send(JSON.stringify({ t: 's', v })); }
  snaps() { return this.msgs.filter((m): m is Extract<ServerMsg, { t: 'snap' }> => m.t === 'snap'); }
}

async function main() {
  const srv = startServer(0);
  const a = new TestClient(srv.port);
  const b = new TestClient(srv.port);
  await Promise.all([a.open(), b.open()]);
  await sleep(100);
  ok(a.id > 0 && b.id > 0 && a.id !== b.id, '접속하면 서로 다른 id 를 받는다');

  a.sendView(view({ x: 42 }));
  await sleep(200);
  const seen = b.snaps().at(-1)?.p.find((p) => p.id === a.id);
  ok(seen?.v.x === 42, '한 클라이언트의 상태가 다른 클라이언트에 전달된다');

  b.msgs.length = 0;
  a.sendRaw('not json');
  a.sendRaw(JSON.stringify({ t: 's', v: view({ x: Number.NaN as unknown as number }) }));
  a.sendRaw(JSON.stringify({ t: 's', v: { ...view(), eq: 'rocket' } }));
  a.sendRaw(JSON.stringify({ t: 's', v: view({ x: 1e9 }) }));
  await sleep(200);
  ok(b.snaps().length === 0, '잘못된 메시지(깨진 JSON/NaN/알 수 없는 장비/범위 밖)는 무시된다');

  a.sendRaw(JSON.stringify({ t: 's', v: view({ ux: 0, uy: 0, uz: 0 }) }));
  await sleep(150);
  ok(b.snaps().length === 0, '길이가 0인 방향 벡터는 거부된다');
  a.sendView(view({ ux: 0, uy: 2 * 0.5, uz: 0, x: 8 }));
  a.sendView(view({ ux: 0.3, uy: 1.0, uz: 0, x: 9 }));
  await sleep(150);
  const upv = b.snaps().at(-1)?.p.find((p) => p.id === a.id)?.v;
  ok(!!upv && Math.abs(Math.hypot(upv.ux, upv.uy, upv.uz) - 1) < 1e-9, '방향 벡터는 길이 1로 정규화되어 전달된다');

  a.sendView(view({ x: 7 }));
  await sleep(150);
  b.msgs.length = 0;
  for (let i = 0; i < NET.maxMsgPerSec * 3; i++) a.sendView(view({ x: 100 + i }));
  await sleep(300);
  const xs = b.snaps().flatMap((s) => s.p.filter((p) => p.id === a.id).map((p) => p.v.x));
  ok(xs.length > 0 && Math.max(...xs) < 100 + NET.maxMsgPerSec * 3 - 1, '초당 메시지 한도를 넘는 전송은 버려진다');

  a.ws.close();
  await sleep(200);
  ok(b.msgs.some((m) => m.t === 'left' && m.id === a.id), '연결이 끊기면 다른 클라이언트에 퇴장이 알려진다');
  ok(srv.count() === 1, '끊긴 연결은 서버에서 정리된다');

  b.ws.close();
  await srv.close();

  // 가득 찬 서버/IP 한도 상태에서 큰 프레임을 보내도 서버가 죽지 않는다
  const srv2 = startServer(0);
  const many: TestClient[] = [];
  for (let i = 0; i < NET.maxPerIp; i++) {
    const c = new TestClient(srv2.port);
    await c.open();
    many.push(c);
  }
  const extra = new WebSocket(`ws://127.0.0.1:${srv2.port}`);
  extra.on('error', () => {});
  extra.on('open', () => extra.send('x'.repeat(5000)));
  await sleep(300);
  ok(srv2.count() === NET.maxPerIp, 'IP당 연결 수 한도를 넘는 접속은 거절된다');
  const probe = new TestClient(srv2.port);
  probe.ws.on('error', () => {});
  many[0].ws.close();
  await sleep(200);
  ok(srv2.count() === NET.maxPerIp - 1, '가득 찬 상태에서 큰 프레임을 보내도 서버가 살아 있다');
  probe.ws.close();
  for (const c of many) c.ws.close();
  await srv2.close();
  console.log(fails === 0 ? '네트워크 검증: 통과' : `네트워크 검증: 실패 ${fails}건`);
  process.exit(fails === 0 ? 0 : 1);
}
main();
