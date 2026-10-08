// render が Chromium に読ませる HTTP サーバー（127.0.0.1・空きポート・render の間だけ起動）
// 合成した HTML・スタジオのルートのファイル・エンジンアセット（/@engine/...）を配信する。
// file:// を使わないので、file:// を禁止したブラウザでも同じ手順・同じ結果で出力できる。
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { ENGINE_URL_PREFIX, contentTypeOf, resolveEngineRequest, resolveInRoot } from '../../design-engine/src/index.ts';

/** 合成した HTML 文書を配信する URL 接頭辞 */
const DOC_PREFIX = '/@doc/';

export interface ServedDocument {
  url: string;
  dispose(): void;
}

export interface StudioServer {
  /** スタジオのルート（絶対パス） */
  root: string;
  /** ルート URL（http://127.0.0.1:<port>/）。compose の baseUrl に渡す */
  baseUrl: string;
  /** HTML 文書を登録し、開く URL を返す */
  addDocument(html: string, name?: string): ServedDocument;
  /** このサーバーの URL を表示用のルート相対パスに戻す（ほかの URL はそのまま） */
  displayPath(url: string): string;
  close(): Promise<void>;
}

function notFound(res: http.ServerResponse): void {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end('not found');
}

/** ルート相対パスを配信するファイルに解決する（ルート外・存在しないもの・ディレクトリは null） */
function resolveRootFile(root: string, rel: string): string | null {
  let file: string;
  try {
    file = resolveInRoot(root, rel);
  } catch {
    return null;
  }
  return fs.existsSync(file) && fs.statSync(file).isFile() ? file : null;
}

export async function startStudioServer(root: string): Promise<StudioServer> {
  const absRoot = path.resolve(root);
  const docs = new Map<string, string>();

  const server = http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      res.end();
      return;
    }
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      notFound(res);
      return;
    }
    if (decoded.startsWith(DOC_PREFIX)) {
      const html = docs.get(decoded.slice(DOC_PREFIX.length));
      if (html === undefined) return notFound(res);
      const body = Buffer.from(html, 'utf8');
      res.writeHead(200, { 'Content-Type': contentTypeOf('page.html'), 'Content-Length': body.length, 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    const file = pathname.startsWith(ENGINE_URL_PREFIX) ? resolveEngineRequest(pathname) : resolveRootFile(absRoot, decoded.slice(1));
    if (!file) return notFound(res);
    const size = fs.statSync(file).size;
    res.writeHead(200, { 'Content-Type': contentTypeOf(file), 'Content-Length': size, 'Cache-Control': 'no-store' });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(file)
      .on('error', () => res.destroy())
      .pipe(res);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}/`;

  return {
    root: absRoot,
    baseUrl,
    addDocument(html, name = 'page.html') {
      const key = `${randomUUID()}/${name}`;
      docs.set(key, html);
      return { url: baseUrl + DOC_PREFIX.slice(1) + key, dispose: () => docs.delete(key) };
    },
    displayPath(url) {
      if (!url.startsWith(baseUrl)) return url;
      const rest = url.slice(baseUrl.length);
      try {
        return decodeURIComponent(rest);
      } catch {
        return rest;
      }
    },
    close() {
      return new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      });
    },
  };
}
