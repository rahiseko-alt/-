import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { StudioError, baseHref, composeBook, composePage, fontsourceDir } from '../src/index.ts';
import { FIXTURE_ROOT, REPO_ROOT, cleanupTemp, copyFixture, readFile, writeFile } from './helpers.ts';

afterAll(cleanupTemp);

const page1Render = composePage({ root: FIXTURE_ROOT, bookId: 'smoke', pageId: 'page_001', mode: 'render' });
const page1Preview = composePage({ root: FIXTURE_ROOT, bookId: 'smoke', pageId: 'page_001', mode: 'preview' });
const page2Guides = composePage({ root: FIXTURE_ROOT, bookId: 'smoke', pageId: 'page_002', mode: 'preview', guides: true });

function count(html: string, re: RegExp): number {
  return [...html.matchAll(new RegExp(re.source, 'g'))].length;
}

describe('composePage: 文書構造', () => {
  it('fixture は警告なしで合成できる', () => {
    expect(page1Render.warnings).toEqual([]);
    expect(page1Preview.warnings).toEqual([]);
    expect(page2Guides.warnings).toEqual([]);
  });

  it('<!doctype html> と lang="ja"', () => {
    expect(page1Render.html.startsWith('<!doctype html>\n<html lang="ja">')).toBe(true);
  });

  it('base href: render は file://<root>/、preview は /', () => {
    const fileBase = `${pathToFileURL(FIXTURE_ROOT).href}/`;
    expect(baseHref(FIXTURE_ROOT, 'render')).toBe(fileBase);
    expect(page1Render.html).toContain(`<base href="${fileBase}">`);
    expect(page1Preview.html).toContain('<base href="/">');
  });

  it('フォント（@fontsource のローカル CSS）と base.css を読み込む', () => {
    const sans = fontsourceDir('noto-sans-jp');
    for (const w of ['400', '500', '700', '900']) {
      expect(page1Render.html).toContain(`href="${pathToFileURL(path.join(sans, `${w}.css`)).href}"`);
      expect(page1Preview.html).toContain(`href="/@engine/fonts/noto-sans-jp/${w}.css"`);
    }
    for (const w of ['400', '700']) {
      expect(page1Preview.html).toContain(`href="/@engine/fonts/noto-serif-jp/${w}.css"`);
    }
    expect(page1Render.html).toContain(pathToFileURL(path.join(REPO_ROOT, 'system/design-engine/src/assets/base.css')).href);
    expect(page1Preview.html).toContain('href="/@engine/assets/base.css"');
    // ネットワーク上のフォント・CSS は使わない
    expect(page1Render.html).not.toMatch(/<link[^>]+href="https?:/);
    expect(page1Preview.html).not.toMatch(/<link[^>]+href="https?:/);
  });

  it('.page 要素: data-book / data-page / data-side と 3 レイヤー', () => {
    const html = page1Render.html;
    expect(html).toMatch(/<div class="page" data-book="smoke" data-page="page_001" data-side="right" data-type="cover" data-number="1">/);
    expect(count(html, /class="page"/)).toBe(1);
    expect(html).toMatch(
      /<div class="layer layer-base"><img class="base-image" src="books\/smoke\/backgrounds\/page_001\.svg" alt="" style="object-fit:cover;object-position:center;opacity:1"><\/div>/,
    );
    expect(html).toMatch(/<div class="layer layer-main"><div class="trim">[\s\S]*<h1>サンプル学園<\/h1>[\s\S]*<\/div><\/div>/);
    expect(html).not.toContain('layer-guides');
    // レイヤーの順序: base -> main
    expect(html.indexOf('layer-base')).toBeLessThan(html.indexOf('layer-main'));
  });

  it('左綴じの 2 ページ目は左ページ', () => {
    expect(page2Guides.html).toContain('data-page="page_002" data-side="left"');
  });

  it('guides: 仕上がり線・塗り足し・安全領域・マージン・段組（段数ぶん）', () => {
    const html = page2Guides.html;
    for (const cls of ['layer layer-guides', 'guide guide-bleed', 'guide guide-trim', 'guide guide-safe', 'guide guide-margins', 'guide guide-columns']) {
      expect(html).toContain(`class="${cls}"`);
    }
    expect(count(html, /class="guide-col"/)).toBe(12);
    expect(html).toContain('class="studio mode-preview show-guides"');
  });

  it('CSS 変数: ブランド色・書体 → 判型 → book.theme の順', () => {
    const html = page1Render.html;
    const style = /<style id="studio-vars">([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
    expect(style).toContain('@page {\n  size: 216mm 303mm;\n  margin: 0;\n}');
    for (const decl of [
      '--color-primary: #1d4e89;',
      '--color-secondary: #2a9d8f;',
      '--color-text: #1f2933;',
      '--color-surface: #f3f6fa;',
      '--font-heading: "Noto Sans JP", sans-serif;',
      '--font-serif: "Noto Serif JP", serif;',
      '--trim-w: 210mm;',
      '--trim-h: 297mm;',
      '--bleed: 3mm;',
      '--safe: 5mm;',
      '--margin-top: 15mm;',
      '--margin-inside: 18mm;',
      '--margin-outside: 15mm;',
      '--columns: 12;',
      '--gutter: 4mm;',
    ]) {
      expect(style).toContain(decl);
    }
    // theme の上書きはブランド色より後
    const brandAccent = style.indexOf('--color-accent: #f4a261;');
    const themeAccent = style.indexOf('--color-accent: #e76f51;');
    expect(brandAccent).toBeGreaterThan(-1);
    expect(themeAccent).toBeGreaterThan(brandAccent);
    expect(style.indexOf('--trim-w')).toBeGreaterThan(style.indexOf('--font-number'));
  });

  it('book.styles → page.css（@scope でページに限定）の順', () => {
    const html = page1Render.html;
    const vars = html.indexOf('id="studio-vars"');
    const styles = html.indexOf('<link rel="stylesheet" href="shared/layouts/fixture.css" data-book-style>');
    const pageCss = html.indexOf('<style data-page-css="page_001">');
    expect(vars).toBeGreaterThan(-1);
    expect(styles).toBeGreaterThan(vars);
    expect(pageCss).toBeGreaterThan(styles);
    expect(html).toContain('@scope (.page[data-page="page_001"]) {');
    expect(page2Guides.html).not.toContain('data-page-css');
  });

  it('アセット参照はルート相対（先頭スラッシュなし）', () => {
    expect(page1Preview.html).toContain('src="company-data/brand/logo/logo.svg"');
    expect(page2Guides.html).toContain('src="company-data/photos/campus.svg"');
    expect(page1Preview.html).toContain('<svg class="qr"');
  });
});

describe('composeBook', () => {
  it('全ページを 1 文書に（book.yaml の順）', () => {
    const r = composeBook({ root: FIXTURE_ROOT, bookId: 'smoke', mode: 'render' });
    expect(r.pageIds).toEqual(['page_001', 'page_002']);
    expect(count(r.html, /<div class="page" /)).toBe(2);
    expect(r.html.indexOf('data-page="page_001"')).toBeLessThan(r.html.indexOf('data-page="page_002"'));
    expect(count(r.html, /<base /)).toBe(1);
    expect(r.html).toContain('<title>スモークテスト</title>');
  });

  it('pageIds 指定（順序は book.yaml に従う）・未登録ページはエラー', () => {
    const r = composeBook({ root: FIXTURE_ROOT, bookId: 'smoke', pageIds: ['page_002', 'page_001'], mode: 'preview' });
    expect(r.pageIds).toEqual(['page_001', 'page_002']);
    const one = composeBook({ root: FIXTURE_ROOT, bookId: 'smoke', pageIds: ['page_002'], mode: 'preview' });
    expect(count(one.html, /<div class="page" /)).toBe(1);
    expect(() => composeBook({ root: FIXTURE_ROOT, bookId: 'smoke', pageIds: ['page_003'], mode: 'render' })).toThrow(/pages に含まれていません/);
  });
});

describe('composePage: エラーと警告', () => {
  it('pages に無いページはエラー', () => {
    const root = copyFixture();
    writeFile(root, 'books/smoke/pages/page_003/page.yaml', 'id: page_003\ntitle: x\ntype: other\n');
    writeFile(root, 'books/smoke/pages/page_003/page.html', '<p>x</p>');
    expect(() => composePage({ root, bookId: 'smoke', pageId: 'page_003', mode: 'render' })).toThrow(/pages に含まれていません/);
  });

  it('背景画像・styles が無ければエラー', () => {
    const root = copyFixture();
    fs.rmSync(path.join(root, 'books/smoke/backgrounds/page_001.svg'));
    expect(() => composePage({ root, bookId: 'smoke', pageId: 'page_001', mode: 'render' })).toThrow(/背景画像が見つかりません/);
    fs.rmSync(path.join(root, 'shared/layouts/fixture.css'));
    expect(() => composePage({ root, bookId: 'smoke', pageId: 'page_002', mode: 'render' })).toThrow(StudioError);
  });

  it('mode が不正ならエラー', () => {
    expect(() => composePage({ root: FIXTURE_ROOT, bookId: 'smoke', pageId: 'page_001', mode: 'pdf' as 'render' })).toThrow(/mode/);
  });

  it('本文の TODO・未確定の色は警告（描画は継続）', () => {
    const root = copyFixture();
    writeFile(root, 'company-data/copy/brochure.yaml', 'catch: "TODO: キャッチコピー"\nlead: x\n');
    const colors = readFile(root, 'company-data/brand/colors/colors.yaml').replace('"#1d4e89"', '"TODO: 決定待ち"');
    writeFile(root, 'company-data/brand/colors/colors.yaml', colors);
    const r = composePage({ root, bookId: 'smoke', pageId: 'page_001', mode: 'render' });
    expect(r.warnings.join('\n')).toContain('TODO');
    expect(r.warnings.join('\n')).toContain('brand.colors.primary');
    expect(r.html).toContain('--color-primary: #4d4d4d;');
  });

  it('右綴じなら 1 ページ目は左ページ', () => {
    const root = copyFixture();
    const yaml = readFile(root, 'books/smoke/config/book.yaml').replace('binding: left', 'binding: right');
    writeFile(root, 'books/smoke/config/book.yaml', yaml);
    expect(composePage({ root, bookId: 'smoke', pageId: 'page_001', mode: 'render' }).html).toContain('data-side="left"');
  });

  it('page.css の相対 url() はルート相対に書き換える', () => {
    const root = copyFixture();
    writeFile(
      root,
      'books/smoke/pages/page_002/page.css',
      '.a { background: url(../../backgrounds/page_001.svg); }\n.b { background: url("data:image/png;base64,AA"); }\n.c { background: url(/abs.png); }\n',
    );
    const html = composePage({ root, bookId: 'smoke', pageId: 'page_002', mode: 'render' }).html;
    expect(html).toContain('url("books/smoke/backgrounds/page_001.svg")');
    expect(html).toContain('url("data:image/png;base64,AA")');
    expect(html).toContain('url(/abs.png)');
  });
});
