// npm run dev と同じ設定（vite.config.ts）で開発サーバーを起動して確認する
import fs from 'node:fs';
import path from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assetUrl } from '../src/index.ts';
import { REPO_ROOT, cleanupTemp, copyFixture } from './helpers.ts';

const CONFIG = path.join(REPO_ROOT, 'system/design-engine/vite.config.ts');

let server: ViteDevServer;
let baseUrl: string;
let studioRoot: string;
const sent: unknown[] = [];

beforeAll(async () => {
  studioRoot = copyFixture();
  const prev = process.env.STUDIO_ROOT;
  process.env.STUDIO_ROOT = studioRoot;
  try {
    server = await createServer({ configFile: CONFIG, logLevel: 'silent', server: { port: 0, host: '127.0.0.1' } });
  } finally {
    if (prev === undefined) delete process.env.STUDIO_ROOT;
    else process.env.STUDIO_ROOT = prev;
  }
  await server.listen();
  const addr = server.httpServer?.address();
  if (!addr || typeof addr === 'string') throw new Error('サーバーのアドレスを取得できません');
  baseUrl = `http://127.0.0.1:${addr.port}`;
  // フルリロード通知を記録する
  const original = server.ws.send.bind(server.ws);
  server.ws.send = ((...args: Parameters<typeof original>) => {
    sent.push(args[0]);
    return original(...args);
  }) as typeof server.ws.send;
});

afterAll(async () => {
  await server?.close();
  cleanupTemp();
});

async function get(p: string, headers: Record<string, string> = {}) {
  const res = await fetch(baseUrl + p, { headers });
  return { status: res.status, type: res.headers.get('content-type') ?? '', body: await res.text() };
}

describe('Vite 開発サーバー', () => {
  it('ルートは STUDIO_ROOT', () => {
    expect(server.config.root).toBe(studioRoot);
  });

  it('/ は BOOK とページの一覧', async () => {
    const r = await get('/');
    expect(r.status).toBe(200);
    expect(r.body).toContain('href="/preview/smoke/page_001"');
    expect(r.body).toContain('href="/preview/smoke/page_002?guides=1"');
    expect(r.body).toContain('/@vite/client');
  });

  it('/preview/<book>/<page> は preview モードの合成結果 + Vite クライアント', async () => {
    const r = await get('/preview/smoke/page_001?guides=1');
    expect(r.status).toBe(200);
    expect(r.body).toContain('<base href="/">');
    expect(r.body).toContain('data-page="page_001"');
    expect(r.body).toContain('layer-guides');
    expect(r.body).toContain('<script type="module" src="/@vite/client"></script>');
  });

  it('/preview/<book> は全ページ', async () => {
    const r = await get('/preview/smoke');
    expect(r.status).toBe(200);
    expect(r.body.match(/<div class="page" /g)?.length).toBe(2);
  });

  it('合成エラーは 500 でメッセージを表示', async () => {
    const r = await get('/preview/nothing/page_001');
    expect(r.status).toBe(500);
    expect(r.body).toContain('BOOK &quot;nothing&quot; が見つかりません');
  });

  it('エンジンアセット・フォント・スタジオ内の静的ファイルを配信', async () => {
    const css = await get('/@engine/assets/base.css');
    expect(css.status).toBe(200);
    expect(css.type).toContain('text/css');
    const font = await get('/@engine/fonts/noto-sans-jp/400.css');
    expect(font.body).toContain("font-family: 'Noto Sans JP'");
    const woff = await fetch(`${baseUrl}/@engine/fonts/noto-sans-jp/files/noto-sans-jp-0-400-normal.woff2`);
    expect(woff.status).toBe(200);
    expect(woff.headers.get('content-type')).toBe('font/woff2');
    // fetch（WHATWG URL）は "/../" をクライアント側で正規化してしまうため、
    // "/" を %2f にした ".." でサーバー側（resolveEngineRequest）の防御を確かめる
    for (const p of ['/@engine/assets/..%2findex.ts', '/@engine/fonts/noto-sans-jp/..%2f..%2f..%2f..%2fpackage.json']) {
      expect(new URL(baseUrl + p).pathname).toBe(p); // 正規化されずにサーバーへ届く
      expect((await get(p)).status).toBe(404);
    }
    const svg = await get('/books/smoke/backgrounds/page_001.svg');
    expect(svg.status).toBe(200);
    // assetUrl() でエンコードしたファイル名（# や空白・括弧を含む）もプレビューで読める
    fs.copyFileSync(path.join(studioRoot, 'company-data/photos/campus.svg'), path.join(studioRoot, 'company-data/photos/campus#2 (1).svg'));
    expect((await get(`/${assetUrl('company-data/photos/campus#2 (1).svg')}`)).status).toBe(200);
    const layout = await get('/shared/layouts/fixture.css', { accept: 'text/css,*/*;q=0.1', 'sec-fetch-dest': 'style' });
    expect(layout.status).toBe(200);
    expect(layout.body).toContain('.stat-card');
  });

  it('company-data の変更でフルリロードを送る', async () => {
    sent.length = 0;
    const file = path.join(studioRoot, 'company-data/copy/brochure.yaml');
    fs.appendFileSync(file, '\n# changed\n');
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && !sent.some((p) => (p as { type?: string }).type === 'full-reload')) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(sent).toContainEqual(expect.objectContaining({ type: 'full-reload' }));
  });
});
