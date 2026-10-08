// render の HTTP 配信（studio-server）と、Chromium の指定（STUDIO_CHROMIUM_PATH）
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { composePage } from '../../design-engine/src/index.ts';
import { CHROMIUM_PATH_ENV, openComposed } from '../lib/browser.ts';
import { renderCommand } from '../lib/render.ts';
import { startStudioServer, type StudioServer } from '../lib/studio-server.ts';
import { cleanupTemp, copyFixture, run, tempDir } from './helpers.ts';

let root: string;
let server: StudioServer;
let browser: Browser;

beforeAll(async () => {
  root = copyFixture();
  server = await startStudioServer(root);
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
  await server?.close();
  cleanupTemp();
});

async function get(url: string, method = 'GET'): Promise<{ status: number; type: string | null; body: string }> {
  const res = await fetch(url, { method });
  return { status: res.status, type: res.headers.get('content-type'), body: await res.text() };
}

/** パスを正規化せずにそのまま送る（fetch は ".." "%2e%2e" を送る前に解決してしまう） */
function rawGet(rawPath: string): Promise<number> {
  const { port } = new URL(server.baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: rawPath }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
  });
}

describe('studio-server', () => {
  it('ルートのファイル・エンジンアセット・登録した文書を配信し、ルート外・存在しないものは 404', async () => {
    const yaml = await get(`${server.baseUrl}books/smoke/config/book.yaml`);
    expect(yaml.status).toBe(200);
    expect(yaml.body).toBe(fs.readFileSync(path.join(root, 'books/smoke/config/book.yaml'), 'utf8'));

    const css = await get(`${server.baseUrl}@engine/fonts/noto-sans-jp/400.css`);
    expect(css.status).toBe(200);
    expect(css.type).toContain('text/css');
    expect((await get(`${server.baseUrl}@engine/assets/base.css`)).status).toBe(200);

    const doc = server.addDocument('<!doctype html><title>t</title>');
    const html = await get(doc.url);
    expect([html.status, html.body]).toEqual([200, '<!doctype html><title>t</title>']);
    expect(html.type).toContain('text/html');
    doc.dispose();
    expect((await get(doc.url)).status).toBe(404);

    for (const p of ['books/missing.png', 'books', '@engine/fonts/x/400.css', '%E0%A4%A']) {
      expect((await get(server.baseUrl + p)).status, p).toBe(404);
    }

    // ルートの外（実在するファイル）には届かない
    const outside = `${path.basename(root)}-outside.txt`;
    const outsideFile = path.join(path.dirname(root), outside);
    fs.writeFileSync(outsideFile, 'outside');
    try {
      for (const p of [`/../${outside}`, `/books/../../${outside}`, `/%2e%2e/${outside}`, `/books/%2e%2e/%2e%2e/${outside}`]) {
        expect(await rawGet(p), p).toBe(404);
      }
    } finally {
      fs.rmSync(outsideFile, { force: true });
    }
    // エンコードした区切り（%2F・%5C）は受け付けない。参考資料（references/）は配信しない
    expect(await rawGet('/books%2Fsmoke%2Fconfig%2Fbook.yaml')).toBe(404);
    expect(await rawGet('/books%5csmoke%5cconfig%5cbook.yaml')).toBe(404);
    expect(await rawGet('/references/Sample/brochure/page_001.svg')).toBe(404);
    expect(await rawGet('/References/Sample/brochure/page_001.svg')).toBe(404);
    // 先頭の "//" はホスト名ではなくパスとして扱う。不正な値・想定外の名前でもサーバーは落ちない
    expect(await rawGet('//books/smoke/config/book.yaml')).toBe(200);
    expect(await rawGet('//[x')).toBe(404);
    expect(await rawGet('/@engine/fonts/constructor/400.css')).toBe(404);
    expect(await rawGet('/@engine/fonts/__proto__/400.css')).toBe(404);
    expect((await get(`${server.baseUrl}books/smoke/config/book.yaml`)).status).toBe(200);
    expect((await get(`${server.baseUrl}books/smoke/config/book.yaml`, 'POST')).status).toBe(405);
    const head = await fetch(`${server.baseUrl}books/smoke/config/book.yaml`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(Number(head.headers.get('content-length'))).toBeGreaterThan(0);

    expect(server.displayPath(`${server.baseUrl}books/a%20b.png`)).toBe('books/a b.png');
    expect(server.displayPath('https://example.com/x')).toBe('https://example.com/x');
  });

  it('合成したページは file:// を一切読まずに描画でき、404 は読み込み失敗として報告する', async () => {
    const { html } = composePage({ root, bookId: 'smoke', pageId: 'page_001', mode: 'render', baseUrl: server.baseUrl });
    const context = await browser.newContext();
    const urls: string[] = [];
    context.on('request', (req) => urls.push(req.url()));
    try {
      const doc = await openComposed(server, context, html, 'page_001');
      try {
        expect(doc.problems).toEqual([]);
        expect(await doc.page.evaluate(() => document.fonts.check('16px "Noto Sans JP"', '学園'))).toBe(true);
      } finally {
        await doc.close();
      }
      expect(urls.length).toBeGreaterThan(3);
      expect(urls.filter((u) => !u.startsWith(server.baseUrl))).toEqual([]);

      // 404 の CSS は 1 回だけ報告する（404 のあとの読み込み中止を重ねて報告しない）
      const broken = html.replace('</head>', '<link rel="stylesheet" href="shared/layouts/missing.css">\n</head>');
      const doc2 = await openComposed(server, context, broken, 'page_001');
      try {
        expect(doc2.problems.filter((p) => p.includes('missing.css'))).toEqual(['page_001: 読み込みに失敗しました: shared/layouts/missing.css（HTTP 404）']);
      } finally {
        await doc2.close();
      }

      // エンコードした区切りで書いた参考資料の読み込みも記録する（配信はしない）
      const sneaky = html.replace('</body>', '<img src="references%2FSample%2Fbrochure%2Fpage_001.svg" alt="">\n</body>');
      const doc3 = await openComposed(server, context, sneaky, 'page_001');
      try {
        expect(doc3.referenceRequests).toEqual(['references/Sample/brochure/page_001.svg']);
        expect(doc3.problems.some((p) => p.includes('画像を表示できません'))).toBe(true);
      } finally {
        await doc3.close();
      }
    } finally {
      await context.close();
    }
  });
});

describe(`render: ${CHROMIUM_PATH_ENV}`, () => {
  async function withChromiumPath<T>(value: string, fn: () => Promise<T>): Promise<T> {
    const saved = process.env[CHROMIUM_PATH_ENV];
    process.env[CHROMIUM_PATH_ENV] = value;
    try {
      return await fn();
    } finally {
      if (saved === undefined) delete process.env[CHROMIUM_PATH_ENV];
      else process.env[CHROMIUM_PATH_ENV] = saved;
    }
  }
  const args = (out: string) => ['--book', 'smoke', '--page', 'page_001', '--format', 'png', '--dpi', '36', '--out', out, '--root', root];

  it('指定版以外の Chromium は警告して出力し、--release では失敗する。見つからなければ失敗する', async () => {
    // 同じビルドのフル版へのシンボリックリンクを「別の Chromium」として使う（指定版は既定で起動する headless shell）
    const link = path.join(tempDir(), 'chrome');
    fs.symlinkSync(chromium.executablePath(), link);
    const out = tempDir();
    const ok = await withChromiumPath(link, () => run(renderCommand, args(out)));
    expect(ok.code, ok.text).toBe(0);
    expect(ok.text).toContain(`Playwright 指定版ではない Chromium（${CHROMIUM_PATH_ENV}=${link}`);
    expect(fs.existsSync(path.join(out, 'png/page_001.png'))).toBe(true);

    const release = await withChromiumPath(link, () => run(renderCommand, [...args(tempDir()), '--release']));
    expect(release.code).toBe(1);
    expect(release.err).toContain('--release: Playwright 指定版ではない Chromium');

    const missing = await withChromiumPath('/nonexistent/chrome', () => run(renderCommand, args(tempDir())));
    expect(missing.code).toBe(1);
    expect(missing.err).toContain(`${CHROMIUM_PATH_ENV} の Chromium が見つかりません: /nonexistent/chrome`);

    // 既定で起動する headless shell（へのシンボリックリンク）を指定したときは何も言わない
    const shell = (createRequire(import.meta.url)('playwright-core/lib/server') as {
      registry: { findExecutable(name: string): { executablePath(sdk: string): string } };
    }).registry.findExecutable('chromium-headless-shell').executablePath('javascript');
    const shellLink = path.join(tempDir(), 'headless_shell');
    fs.symlinkSync(shell, shellLink);
    const same = await withChromiumPath(shellLink, () => run(renderCommand, args(tempDir())));
    expect(same.code, same.text).toBe(0);
    expect(same.text).not.toContain('指定版ではない');

    // 同じビルドでもフル版は描画がわずかに違うことがあるので、指定版とはみなさない
    const full = await withChromiumPath(chromium.executablePath(), () => run(renderCommand, args(tempDir())));
    expect(full.code, full.text).toBe(0);
    expect(full.text).toContain('Playwright 指定版ではない Chromium');
  });
});
