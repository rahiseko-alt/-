// Vite 開発サーバー用プラグイン（ページプレビュー）
// ルート:
//   /                              BOOK とページの一覧
//   /preview/<bookId>/<pageId>     1 ページ（?guides=1 でガイド表示）
//   /preview/<bookId>              BOOK 全ページ
//   /@engine/...                   エンジン同梱アセット（base.css・フォント）
// company-data/・books/・shared/・エンジンの assets/ が変わったらフルリロードする。
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import { composeBook, composePage, escapeHtml } from './compose.ts';
import { contentTypeOf } from './content-types.ts';
import { ENGINE_URL_PREFIX, resolveEngineRequest } from './engine-assets.ts';
import { errorMessage } from './errors.ts';
import { listBooks, loadBook, loadPage } from './load.ts';
import { ENGINE_ASSETS_DIR, isInside, isValidBookId, isValidPageId, listInvalidBookDirs, resolveInRoot, resolveStudioRoot, toPosix } from './paths.ts';

export interface StudioPluginOptions {
  /** スタジオのルート。省略時は環境変数 STUDIO_ROOT、なければリポジトリルート */
  root?: string;
}

const VITE_CLIENT = '<script type="module" src="/@vite/client"></script>';
const WATCH_DIRS = ['company-data', 'books', 'shared'];

function injectClient(html: string): string {
  return html.includes('</head>') ? html.replace('</head>', `${VITE_CLIENT}\n</head>`) : VITE_CLIENT + html;
}

function send(res: ServerResponse, status: number, body: string | Buffer, type = 'text/html; charset=utf-8'): void {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: system-ui, "Noto Sans JP", sans-serif; margin: 2rem; color: #222; line-height: 1.6; }
  h1 { font-size: 1.4rem; } h2 { font-size: 1.1rem; margin-top: 1.6rem; }
  code, pre { font-family: ui-monospace, monospace; }
  pre.error { background: #fff0f0; border: 1px solid #e0a0a0; padding: 1rem; white-space: pre-wrap; }
  ul.warnings { color: #8a5a00; }
  table { border-collapse: collapse; } td, th { border-bottom: 1px solid #ddd; padding: .3rem .8rem; text-align: left; }
  .muted { color: #777; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

function errorPage(title: string, err: unknown): string {
  return shell(
    title,
    `<h1>${escapeHtml(title)}</h1>\n<pre class="error">${escapeHtml(errorMessage(err))}</pre>\n<p class="muted">ファイルを修正すると自動で再読み込みします。<a href="/">一覧へ戻る</a></p>`,
  );
}

function indexPage(root: string): string {
  const ids = listBooks(root);
  const parts: string[] = [
    '<h1>publishing-studio プレビュー</h1>',
    `<p class="muted">ルート: <code>${escapeHtml(root)}</code></p>`,
  ];
  const invalid = listInvalidBookDirs(root);
  if (ids.length === 0 && invalid.length === 0) {
    parts.push('<p>BOOK がまだありません。<code>npm run new:book -- &lt;bookId&gt;</code> で作成してください。</p>');
  }
  if (invalid.length > 0) {
    const items = invalid.map((d) => `<li><code>books/${escapeHtml(d)}</code></li>`).join('');
    parts.push(`<p>BOOK ID に使えない名前のため表示できない BOOK があります（英数字・-・_ を / で連結）:</p><ul class="warnings">${items}</ul>`);
  }
  for (const id of ids) {
    try {
      const book = loadBook(root, id);
      const base = `/preview/${id}`;
      const f = book.config.format;
      parts.push(
        `<h2>${escapeHtml(book.config.title)} <span class="muted">(${escapeHtml(id)} / ${escapeHtml(book.config.kind)} / ${escapeHtml(f.size)} ${escapeHtml(f.orientation)})</span></h2>`,
        `<p><a href="${base}">全ページ</a> ・ <a href="${base}?guides=1">全ページ（ガイド）</a></p>`,
      );
      const rows = book.config.pages.map((pid, i) => {
        let title = '';
        let type = '';
        try {
          const page = loadPage(root, id, pid);
          title = page.config.title;
          type = page.config.type;
        } catch (err) {
          title = `読み込みエラー: ${errorMessage(err).split('\n')[0]}`;
        }
        return `<tr><td>${i + 1}</td><td><a href="${base}/${pid}">${pid}</a></td><td>${escapeHtml(title)}</td><td>${escapeHtml(type)}</td><td><a href="${base}/${pid}?guides=1">ガイド</a></td></tr>`;
      });
      parts.push(`<table><tr><th>#</th><th>ページ</th><th>タイトル</th><th>種別</th><th></th></tr>${rows.join('')}</table>`);
    } catch (err) {
      parts.push(`<h2>${escapeHtml(id)}</h2>`, `<pre class="error">${escapeHtml(errorMessage(err))}</pre>`);
    }
  }
  return shell('publishing-studio プレビュー', parts.join('\n'));
}

/** /preview/ 以降を BOOK ID とページ ID に分解する */
export function parsePreviewPath(pathname: string): { bookId: string; pageId: string | null } | null {
  const rest = pathname.replace(/^\/preview\/?/, '').replace(/\/+$/, '');
  if (!rest) return null;
  let segs: string[];
  try {
    segs = rest.split('/').map((s) => decodeURIComponent(s));
  } catch {
    return null;
  }
  const last = segs[segs.length - 1] ?? '';
  const pageId = isValidPageId(last) ? last : null;
  const bookId = (pageId ? segs.slice(0, -1) : segs).join('/');
  if (!isValidBookId(bookId)) return null;
  return { bookId, pageId };
}

function handlePreview(root: string, url: URL, res: ServerResponse): void {
  const parsed = parsePreviewPath(url.pathname);
  if (!parsed) {
    send(res, 404, injectClient(errorPage('見つかりません', new Error(`不正なプレビュー URL です: ${url.pathname}`))));
    return;
  }
  const guides = url.searchParams.get('guides') === '1' || url.searchParams.get('guides') === 'true';
  const title = parsed.pageId ? `${parsed.bookId}/${parsed.pageId}` : parsed.bookId;
  try {
    const result = parsed.pageId
      ? composePage({ root, bookId: parsed.bookId, pageId: parsed.pageId, mode: 'preview', guides })
      : composeBook({ root, bookId: parsed.bookId, mode: 'preview', guides });
    for (const w of result.warnings) console.warn(`[studio] 警告 (${title}): ${w}`);
    send(res, 200, injectClient(result.html));
  } catch (err) {
    console.error(`[studio] エラー (${title}): ${errorMessage(err)}`);
    send(res, 500, injectClient(errorPage(`合成エラー: ${title}`, err)));
  }
}

function handleEngineAsset(pathname: string, res: ServerResponse): boolean {
  const file = resolveEngineRequest(pathname);
  if (!file) return false;
  send(res, 200, fs.readFileSync(file), contentTypeOf(file));
  return true;
}

/**
 * ファイル名に "#" "?" を含む素材（assetUrl() が %23 / %3F にエンコードしたもの）を配信する。
 * Vite の静的配信はデコード後の "#" "?" 以降を切り捨てるため見つけられない。
 */
function handleEncodedRootFile(root: string, pathname: string, res: ServerResponse): boolean {
  if (!/%23|%3f/i.test(pathname)) return false;
  let rel: string;
  try {
    rel = decodeURIComponent(pathname.replace(/^\/+/, ''));
  } catch {
    return false;
  }
  let file: string;
  try {
    file = resolveInRoot(root, rel);
  } catch {
    return false;
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  send(res, 200, fs.readFileSync(file), contentTypeOf(file));
  return true;
}

/** 監視対象（変更時フルリロード）か */
function isWatchedFile(root: string, file: string): boolean {
  const abs = path.resolve(file);
  if (isInside(ENGINE_ASSETS_DIR, abs)) return true;
  if (!WATCH_DIRS.some((d) => isInside(path.join(root, d), abs))) return false;
  // レンダリング出力・比較結果の書き込みではリロードしない
  const rel = toPosix(path.relative(root, abs));
  return !/(^|\/)(output|reviews)(\/|$)/.test(rel);
}

export function studioPlugin(options: StudioPluginOptions = {}): Plugin {
  const root = resolveStudioRoot(options.root ?? process.env.STUDIO_ROOT);

  return {
    name: 'publishing-studio',

    configureServer(server: ViteDevServer) {
      server.watcher.add([...WATCH_DIRS.map((d) => path.join(root, d)), ENGINE_ASSETS_DIR]);
      let timer: NodeJS.Timeout | null = null;
      const reload = (file: string) => {
        if (!isWatchedFile(root, file)) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          server.ws.send({ type: 'full-reload', path: '*' });
        }, 80);
      };
      for (const ev of ['add', 'change', 'unlink', 'unlinkDir'] as const) server.watcher.on(ev, reload);

      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        let url: URL;
        try {
          url = new URL(req.url ?? '/', 'http://localhost');
        } catch {
          return next();
        }
        try {
          if (url.pathname === '/' || url.pathname === '/index.html') {
            send(res, 200, injectClient(indexPage(root)));
            return;
          }
          if (url.pathname === '/preview' || url.pathname.startsWith('/preview/')) {
            handlePreview(root, url, res);
            return;
          }
          if (url.pathname.startsWith(ENGINE_URL_PREFIX)) {
            if (handleEngineAsset(url.pathname, res)) return;
            send(res, 404, 'Not Found', 'text/plain; charset=utf-8');
            return;
          }
          if (handleEncodedRootFile(root, url.pathname, res)) return;
        } catch (err) {
          send(res, 500, injectClient(errorPage('サーバーエラー', err)));
          return;
        }
        next();
      });
    },

    // 監視対象の変更は Vite の HMR ではなくフルリロードで扱う
    hotUpdate({ file }) {
      if (isWatchedFile(root, file)) return [];
    },
  };
}
