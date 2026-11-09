// 빌드된 클라이언트(dist)를 같은 서버가 내보낸다: 주소 하나로 게임 화면과 멀티플레이 서버가 모두 해결된다.
// 시작할 때 dist 를 한 번만 읽어 메모리에 올린다 (요청 경로로 파일 시스템을 건드리지 않으므로 경로 탈취/캐시 폭증/시작 경쟁이 없다).
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt']);
const MAX_FILE = 20 * 1024 * 1024; // 이보다 큰 파일은 올리지 않는다
const MAX_TOTAL = 100 * 1024 * 1024;

interface Entry {
  body: Buffer;
  gz: Buffer | null;
  compressible: boolean;
  type: string;
  cache: string;
  etag: string;
}

/** dir 아래 일반 파일만 (심볼릭 링크는 따라가지 않는다) 모은다. 키는 '/assets/a.js' 형태 */
function scan(root: string, rel: string, out: Map<string, Entry>, total: { n: number }) {
  for (const d of readdirSync(join(root, rel), { withFileTypes: true })) {
    const path = `${rel}/${d.name}`;
    const st = lstatSync(join(root, path));
    if (st.isDirectory()) scan(root, path, out, total);
    else if (st.isFile() && st.size <= MAX_FILE && total.n + st.size <= MAX_TOTAL) {
      total.n += st.size;
      const body = readFileSync(join(root, path));
      const ext = extname(d.name).toLowerCase();
      const compressible = COMPRESSIBLE.has(ext);
      out.set(path, {
        body,
        gz: compressible && body.length > 1024 ? gzipSync(body) : null,
        compressible,
        type: MIME[ext] ?? 'application/octet-stream',
        // 해시가 붙은 assets/ 는 영원히 캐시. html 은 재배포 때 옛 해시 파일을 찾지 않도록 매번 확인, 모델은 짧게
        cache: path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : ext === '.html' ? 'no-cache' : 'public, max-age=300',
        etag: `"${createHash('sha1').update(body).digest('base64url').slice(0, 20)}"`,
      });
    }
  }
}

/** dist 폴더에 index.html 이 있으면 정적 핸들러를, 없으면 null 을 돌려준다 (동기) */
export function createStaticHandler(dir: string) {
  const files = new Map<string, Entry>();
  try {
    scan(resolve(dir), '', files, { n: 0 });
  } catch {
    return null;
  }
  if (!files.has('/index.html')) return null;

  /** 처리했으면 true, 아니면 false (다른 핸들러로) */
  return (req: IncomingMessage, res: ServerResponse): boolean => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    let path: string;
    try {
      path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    } catch {
      return false;
    }
    if (path.endsWith('/')) path += 'index.html';
    const e = files.get(path); // 미리 올려 둔 목록에 있는 것만 준다
    if (!e) return false;

    const ae = String(req.headers['accept-encoding'] ?? '');
    const gz = !!e.gz && /\bgzip\b(?!\s*;\s*q=0(?:\.0*)?\s*(?:,|$))/i.test(ae);
    const headers: Record<string, string | number> = {
      'content-type': e.type,
      'cache-control': e.cache,
      etag: gz ? e.etag.replace(/"$/, '-gz"') : e.etag,
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    };
    if (e.compressible) headers.vary = 'accept-encoding';
    if (req.headers['if-none-match'] === headers.etag) {
      res.writeHead(304, headers);
      res.end();
      return true;
    }
    const body = gz ? e.gz! : e.body;
    headers['content-length'] = body.length;
    if (gz) headers['content-encoding'] = 'gzip';
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  };
}
