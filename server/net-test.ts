// 서버 통합 테스트: 실제 WebSocket 클라이언트 여러 개로 릴레이/검증/퇴장 처리를 확인한다. npm run nettest
import { WebSocket } from 'ws';
import { startServer } from './index';
import { ANOMALY, MoveTracker } from './anomaly';
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
  name = '';
  msgs: ServerMsg[] = [];
  constructor(port: number) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}`);
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as ServerMsg;
      if (m.t === 'hello') {
        this.id = m.id;
        this.name = m.name;
      }
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
  await sleep(50);
  ok(a.msgs.some((m) => m.t === 'join' && m.id === b.id && m.name === b.name), '기존 접속자는 새 접속자의 join(닉네임)을 받는다');
  ok(!b.msgs.some((m) => m.t === 'join' && m.id === b.id), 'join 은 본인에게는 가지 않는다');
  await sleep(100);
  ok(a.id > 0 && b.id > 0 && a.id !== b.id, '접속하면 서로 다른 id 를 받는다');

  ok(/^\S+ \S+ \S+$/.test(a.name) && a.name !== b.name, '접속하면 서로 다른 랜덤 닉네임(사물 색 동물)을 받는다');
  ok(b.msgs.some((m) => m.t === 'hello' && m.names.some((n) => n.id === a.id && n.name === a.name)), '새로 들어온 사람은 기존 사람들의 닉네임을 받는다');

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

  // 이상 이동 감지 (통합): 순간이동을 계속하는 클라이언트는 서버가 끊고, 그동안 다른 사람에게는 이전 위치만 보인다
  {
    const srv4 = startServer(0, 'no-such-dir');
    const good = new TestClient(srv4.port);
    const cheat = new TestClient(srv4.port);
    await Promise.all([good.open(), cheat.open()]);
    cheat.sendView(view({ x: 0 }));
    await sleep(120);
    for (let i = 1; i <= 12; i++) cheat.sendView(view({ x: i * 400 })); // 5번은 허용, 그 뒤는 고정
    await sleep(250);
    const seen = good.snaps().flatMap((m) => m.p).filter((p) => p.id === cheat.id).map((p) => p.v.x);
    ok(seen.length > 0 && Math.max(...seen) <= 2000, '이상 이동 감지(통합): 허용 횟수를 넘은 순간이동은 다른 사람에게 보이지 않는다');
    for (let i = 0; i < 40; i++) cheat.sendView(view({ x: 4900, sp: 250 })); // 속도를 속이면 금방 끊긴다
    await sleep(300);
    ok(cheat.ws.readyState !== WebSocket.OPEN, '이상 이동 감지(통합): 계속 속이는 클라이언트는 연결이 끊긴다');
    ok(good.ws.readyState === WebSocket.OPEN && srv4.count() === 1, '이상 이동 감지(통합): 정상 클라이언트는 영향이 없다');
    good.ws.close();
    await srv4.close();
  }

  // 이상 이동 감지 (단위): 시간을 직접 넣어 확인한다
  {
    const tr = new MoveTracker();
    let t = 1000;
    const step = (v: PlayerView, dtMs = 66) => tr.check(v, (t += dtMs));
    // 정상 활강: 스키가 초당 40m 로 내려오는 흐름
    let normal = true;
    for (let i = 0; i < 60; i++) {
      const r = step(view({ x: i * 2.6, sp: 40 }));
      if (r.flags.length || r.kick || r.view.x !== i * 2.6) normal = false;
    }
    ok(normal, '이상 이동 감지: 정상적인 이동은 그대로 통과한다');
    const fast = step(view({ x: 160, sp: 500 }));
    ok(fast.flags.includes('speed') && fast.view.sp < 80, '이상 이동 감지: 최고 속도를 넘는 속도 주장은 깎인다');

    // 점프(리프트 건너뛰기 등)는 몇 번까지 허용, 그 이상은 이전 위치로 고정
    const tr2 = new MoveTracker();
    let t2 = 0;
    const s2 = (x: number) => tr2.check(view({ x }), (t2 += 66));
    s2(0);
    const allowed = [500, 1000, 1500, 2000, 2500].map(s2);
    ok(allowed.every((r) => r.flags.includes('jump') && !r.kick), '이상 이동 감지: 정상 순간이동은 정해진 횟수까지 허용한다');
    const blocked = s2(3000);
    ok(blocked.flags.includes('frozen') && blocked.view.x === 2500, '이상 이동 감지: 횟수를 넘은 순간이동은 이전 위치로 고정된다');
    // 시간이 지나면 허용 거리가 늘어 따라잡고, 점프 횟수도 회복된다
    t2 += 10_000;
    const later = s2(2600);
    ok(!later.flags.includes('frozen') && later.view.x === 2600, '이상 이동 감지: 시간이 지나면 정상 이동으로 다시 받아들인다');

    // 리프트 건너뛰기: 연출 중에는 출발 위치를 보내다가 도착하면 새 위치 1회 → 순간이동 1회로 보이고 이후 정상 이동은 통과
    const trs = new MoveTracker();
    let tt = 0;
    trs.check(view({ x: 0 }), (tt += 66));
    for (let i = 0; i < 14; i++) trs.check(view({ x: 0 }), (tt += 66)); // 연출 중 (제자리)
    const arrive = trs.check(view({ x: 1500 }), (tt += 66));
    let after = true;
    for (let i = 1; i <= 90; i++) {
      const r = trs.check(view({ x: 1500 + i * 2.6, sp: 40 }), (tt += 66));
      if (r.flags.length || r.view.x !== 1500 + i * 2.6) after = false;
    }
    ok(arrive.flags.length === 1 && arrive.flags[0] === 'jump' && after, '이상 이동 감지: 리프트 건너뛰기(도착 시 순간이동 1회)는 이후 정상 이동까지 문제없이 통과한다');

    // 매 메시지마다 조금씩 넘게 움직이는 스피드핵: 누적 예산 때문에 통과하지 못한다
    const sh = new MoveTracker();
    let ts = 0;
    sh.check(view({ x: 0 }), (ts += 66));
    let hackerShown = 0;
    let hackerKicked = false;
    for (let i = 1; i <= 250 && !hackerKicked; i++) {
      const r = sh.check(view({ x: i * 44 }), (ts += 66)); // 약 667m/s
      hackerShown = r.view.x;
      hackerKicked = r.kick;
    }
    ok(hackerShown < 44 * 25 && hackerKicked, '이상 이동 감지: 메시지마다 조금씩 넘는 스피드핵은 누적 예산에 걸려 고정되고 결국 끊긴다');

    // 점프 허용량이 회복된다 (20초에 1회)
    const rc = new MoveTracker();
    let tc = 0;
    rc.check(view({ x: 0 }), (tc += 66));
    for (let i = 1; i <= 5; i++) rc.check(view({ x: i * 500 }), (tc += 66)); // 5회 소진
    tc += 21_000;
    const refilled = rc.check(view({ x: 4000 }), (tc += 66));
    ok(refilled.flags.includes('jump') && refilled.view.x === 4000, '이상 이동 감지: 20초가 지나면 점프 허용량이 1회 회복된다');

    // 순간이동을 계속 시도하면 연결을 끊는다
    const tr3 = new MoveTracker();
    let t3 = 0;
    tr3.check(view({ x: 0 }), (t3 += 66));
    let kicked = false;
    for (let i = 1; i < 400 && !kicked; i++) kicked = tr3.check(view({ x: i * 1000 }), (t3 += 66)).kick;
    ok(kicked, '이상 이동 감지: 순간이동을 계속하면 연결을 끊는다');
    // 속도를 계속 속이면 끊는다
    const tr4 = new MoveTracker();
    let t4 = 0;
    let kicked2 = false;
    for (let i = 0; i < 60 && !kicked2; i++) kicked2 = tr4.check(view({ sp: 900, x: i }), (t4 += 66)).kick;
    ok(kicked2 && ANOMALY.strikeLimit > 0, '이상 이동 감지: 속도를 계속 속이면 연결을 끊는다');
  }

  // 정적 파일: dist 를 내보내되 목록에 없는 경로(폴더 밖, 심볼릭 링크 포함)는 주지 않는다
  const { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const parent = mkdtempSync(join(tmpdir(), 'snowhaven-static-'));
  try {
    const dir = join(parent, 'dist');
    mkdirSync(join(dir, 'assets'), { recursive: true });
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>t</title>');
    writeFileSync(join(dir, 'assets', 'a.js'), 'x'.repeat(5000));
    writeFileSync(join(parent, 'secret.txt'), 'secret');
    symlinkSync(join(parent, 'secret.txt'), join(dir, 'link.txt'));
    const srv3 = startServer(0, dir);
    const get = (path: string, headers: Record<string, string> = {}) => fetch(`http://127.0.0.1:${srv3.port}${path}`, { headers });
    const r1 = await get('/'); // 시작 직후 첫 요청도 정적 파일이어야 한다
    ok(r1.status === 200 && (await r1.text()).includes('<title>t</title>'), '정적 서버: 시작 직후 / 에서 index.html 을 준다');
    ok(r1.headers.get('cache-control') === 'no-cache' && r1.headers.get('x-content-type-options') === 'nosniff', '정적 서버: html 은 no-cache, nosniff 헤더');
    ok((await get('/health')).status === 200, '정적 서버: /health 는 그대로 동작한다');
    ok((await get('/nope')).status === 404, '정적 서버: 없는 파일은 404');
    const net = await import('node:net');
    const raw = (reqPath: string) =>
      new Promise<string>((res) => {
        const sock = net.connect(srv3.port, '127.0.0.1', () => sock.write(`GET ${reqPath} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`));
        let out = '';
        sock.on('data', (d) => (out += d.toString()));
        sock.on('close', () => res(out));
      });
    const bad = await Promise.all(['/../secret.txt', '/%2e%2e/secret.txt', '/link.txt', '/assets/..%2f..%2fsecret.txt', '/a%00.js'].map(raw));
    ok(bad.every((t) => !t.includes('secret') && !t.includes(' 200 ')), '정적 서버: 폴더 밖/심볼릭 링크/널바이트 경로는 막는다');
    const gz = await get('/assets/a.js', { 'accept-encoding': 'gzip' });
    ok(gz.headers.get('content-encoding') === 'gzip' && gz.headers.get('vary') === 'accept-encoding', '정적 서버: 큰 텍스트 파일은 gzip 으로 준다');
    const plain = await get('/assets/a.js', { 'accept-encoding': 'gzip;q=0' });
    ok(!plain.headers.get('content-encoding'), '정적 서버: gzip;q=0 이면 압축하지 않는다');
    const et = r1.headers.get('etag')!;
    ok((await get('/', { 'if-none-match': et })).status === 304, '정적 서버: ETag 가 같으면 304');
    ok((await fetch(`http://127.0.0.1:${srv3.port}/`, { method: 'HEAD' })).status === 200, '정적 서버: HEAD 요청');
    await srv3.close();
  } finally {
    rmSync(parent, { recursive: true, force: true }); // 임시 파일 정리
  }
  console.log(fails === 0 ? '네트워크 검증: 통과' : `네트워크 검증: 실패 ${fails}건`);
  process.exit(fails === 0 ? 0 : 1);
}
main();
