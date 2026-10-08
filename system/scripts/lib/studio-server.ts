// render が Chromium に読ませる HTTP サーバー（127.0.0.1・空きポート・render の間だけ起動）
// 合成した HTML・スタジオのルートのファイル・エンジンアセット（/@engine/...）を配信する。
// file:// を使わないので、file:// を禁止したブラウザでも同じ手順・同じ結果で出力できる。
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { ENGINE_URL_PREFIX, contentTypeOf, isReferencePath, resolveEngineRequest, resolveInRoot } from '../../design-engine/src/index.ts';

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

function handle(absRoot: string, docs: Map<string, string>, req: http.IncomingMessage, res: http.ServerResponse): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end();
    return;
  }
  // req.url をそのまま使う（new URL() は "//books/..." の先頭をホスト名と解釈してしまう）
  const pathname = (req.url ?? '/').split(/[?#]/, 1)[0] || '/';
  // エンコードした区切り（%2F・%5C）は受け付けない（file:// の Chromium と同じ。references%2F... で参考資料の検査をすり抜けさせない）
  if (/%2f|%5c/i.test(pathname)) return notFound(res);
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return notFound(res);
  }
  if (decoded.startsWith(DOC_PREFIX)) {
    const html = docs.get(decoded.slice(DOC_PREFIX.length));
    if (html === undefined) return notFound(res);
    const body = Buffer.from(html, 'utf8');
    res.writeHead(200, { 'Content-Type': contentTypeOf('page.html'), 'Content-Length': body.length, 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : body);
    return;
  }
  let file: string | null;
  if (pathname.startsWith(ENGINE_URL_PREFIX)) {
    file = resolveEngineRequest(pathname);
  } else {
    const rel = decoded.replace(/^\/+/, '');
    // 参考資料は描画に使わない（読み込もうとしたこと自体は openComposed が記録し、render が失敗する）
    file = isReferencePath(rel) ? null : resolveRootFile(absRoot, rel);
  }
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
}

export async function startStudioServer(root: string): Promise<StudioServer> {
  const absRoot = path.resolve(root);
  const docs = new Map<string, string>();

  const server = http.createServer((req, res) => {
    // 想定外の例外で render ごと落ちないよう、応答のエラーにする
    try {
      handle(absRoot, docs, req, res);
    } catch {
      if (res.headersSent) {
        res.destroy();
      } else {
        res.writeHead(500, { 'Cache-Control': 'no-store' });
        res.end();
      }
    }
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
