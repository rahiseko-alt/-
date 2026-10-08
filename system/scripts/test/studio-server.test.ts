// render の HTTP 配信（studio-server）と、Chromium の指定（STUDIO_CHROMIUM_PATH）
import fs from 'node:fs';
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

    for (const p of ['%2e%2e/package.json', 'books/%2e%2e/%2e%2e/package.json', 'books/missing.png', 'books', '@engine/fonts/x/400.css', '%E0%A4%A']) {
      expect((await get(server.baseUrl + p)).status, p).toBe(404);
    }
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

      const broken = html.replace('</head>', '<link rel="stylesheet" href="shared/layouts/missing.css">\n</head>');
      const doc2 = await openComposed(server, context, broken, 'page_001');
      try {
        expect(doc2.problems).toContain('page_001: 読み込みに失敗しました: shared/layouts/missing.css（HTTP 404）');
      } finally {
        await doc2.close();
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
    // 指定版へのシンボリックリンクを「別の Chromium」として使う
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

    // 指定版そのものを指定したときは何も言わない
    const same = await withChromiumPath(chromium.executablePath(), () => run(renderCommand, args(tempDir())));
    expect(same.code, same.text).toBe(0);
    expect(same.text).not.toContain('指定版ではない');
  });
});
