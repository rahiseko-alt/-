// Chromium（Playwright）で合成結果を実際に描画して確認する
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { composeBook, composePage, mmToCssPx, writeTempHtml, type HtmlFile } from '../src/index.ts';
import { FIXTURE_ROOT, REPO_ROOT, cleanupTemp, tempDir } from './helpers.ts';

let browser: Browser;
const files: HtmlFile[] = [];

beforeAll(async () => {
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
  for (const f of files) f.dispose();
  cleanupTemp();
});

/** render モードの HTML をファイル経由で開き、フォントと画像の読み込みを待つ */
async function open(html: string, viewport = { width: 1000, height: 1300 }): Promise<Page> {
  const file = writeTempHtml(html);
  files.push(file);
  const page = await browser.newPage({ viewport });
  await page.goto(file.url, { waitUntil: 'load' });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      Array.from(document.images).map((img) =>
        img.complete ? null : new Promise((resolve) => img.addEventListener('load', resolve, { once: true })),
      ),
    );
  });
  return page;
}

describe('Chromium で描画（render モード）', () => {
  it('.page は (210+6)×(297+6)mm、Noto Sans JP が読み込まれる', async () => {
    const { html } = composePage({ root: FIXTURE_ROOT, bookId: 'smoke', pageId: 'page_001', mode: 'render' });
    const page = await open(html);
    const box = await page.locator('.page').boundingBox();
    expect(box).not.toBeNull();
    expect(Math.abs(box!.width - mmToCssPx(210 + 6))).toBeLessThan(0.5);
    expect(Math.abs(box!.height - mmToCssPx(297 + 6))).toBeLessThan(0.5);

    const fonts = await page.evaluate(async () => {
      await document.fonts.ready;
      const faces: FontFace[] = [];
      document.fonts.forEach((f) => {
        if (f.family.replace(/["']/g, '') === 'Noto Sans JP') faces.push(f);
      });
      return {
        check: document.fonts.check('16px "Noto Sans JP"'),
        checkJa: document.fonts.check('16px "Noto Sans JP"', '学園'),
        loaded: faces.filter((f) => f.status === 'loaded').length,
        h1Family: getComputedStyle(document.querySelector('h1')!).fontFamily,
      };
    });
    expect(fonts.check).toBe(true);
    expect(fonts.checkJa).toBe(true);
    // check() はフォント未登録でも true になり得るため、実際に読み込まれた face も確認する
    expect(fonts.loaded).toBeGreaterThan(0);
    expect(fonts.h1Family).toContain('Noto Sans JP');
    await page.close();
  });

  it('レイヤー・仕上がり座標系・背景画像・page.css（@scope）が効いている', async () => {
    const { html } = composePage({ root: FIXTURE_ROOT, bookId: 'smoke', pageId: 'page_001', mode: 'render', guides: true });
    const page = await open(html);
    const r = await page.evaluate(() => {
      const rect = (sel: string) => document.querySelector(sel)!.getBoundingClientRect().toJSON() as DOMRect;
      const pageBox = rect('.page');
      const img = document.querySelector<HTMLImageElement>('.layer-base .base-image')!;
      const logo = document.querySelector<HTMLImageElement>('.cover-logo')!;
      return {
        page: pageBox,
        trim: rect('.trim'),
        base: rect('.layer-base'),
        guideTrim: rect('.guide-trim'),
        cols: document.querySelectorAll('.guide-columns .guide-col').length,
        bg: { w: img.naturalWidth, box: img.getBoundingClientRect().toJSON() as DOMRect },
        logoLoaded: logo.naturalWidth > 0,
        coverTitlePosition: getComputedStyle(document.querySelector('.cover-title')!).position,
        qr: rect('svg.qr'),
        primary: getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim(),
        accent: getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim(),
        marginLeft: getComputedStyle(document.querySelector('.page')!).getPropertyValue('--margin-left').trim(),
      };
    });
    const bleed = mmToCssPx(3);
    expect(Math.abs(r.trim.x - r.page.x - bleed)).toBeLessThan(0.5);
    expect(Math.abs(r.trim.width - mmToCssPx(210))).toBeLessThan(0.5);
    expect(Math.abs(r.guideTrim.width - mmToCssPx(210))).toBeLessThan(0.5);
    expect(Math.abs(r.base.width - r.page.width)).toBeLessThan(0.5);
    expect(r.bg.w).toBeGreaterThan(0);
    expect(Math.abs(r.bg.box.height - r.page.height)).toBeLessThan(0.5);
    expect(r.logoLoaded).toBe(true);
    expect(r.cols).toBe(12);
    expect(r.coverTitlePosition).toBe('absolute');
    expect(Math.abs(r.qr.width - mmToCssPx(22))).toBeLessThan(0.5);
    expect(r.primary).toBe('#1d4e89');
    expect(r.accent).toBe('#e76f51');
    // 1 ページ目（右ページ）のノドは左
    expect(r.marginLeft).toBe('18mm');
    await page.close();
  });

  it('base.css・typography.css の和文組版の指定は Chromium が解釈できる値だけを使う（無視される値を書かない）', async () => {
    const files = ['system/design-engine/src/assets/base.css', 'shared/layouts/typography.css'];
    const decls = new Set<string>();
    for (const f of files) {
      // コメントと、@supports で囲んだ指定（対応ブラウザだけで効かせるもの）は除く
      const css = fs
        .readFileSync(path.join(REPO_ROOT, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/@supports[^{]*\{[\s\S]*?\}\s*\}/g, '');
      for (const m of css.matchAll(/\b(text-spacing-trim|text-justify|text-autospace|word-break|line-break|line-height-step|hanging-punctuation|text-wrap(?:-style)?)\s*:\s*([^;}]+);/g)) {
        decls.add(`${m[1]}: ${m[2]!.trim()}`);
      }
    }
    expect(decls.size).toBeGreaterThan(0);
    const page = await browser.newPage();
    const unsupported = await page.evaluate((list) => list.filter((d) => !CSS.supports(d)), [...decls]);
    await page.close();
    expect(unsupported).toEqual([]);
  });

  it('composeBook を PDF にすると 2 ページ・各 216×303mm', async () => {
    const { html } = composeBook({ root: FIXTURE_ROOT, bookId: 'smoke', mode: 'render' });
    const page = await open(html);
    expect(await page.locator('.page').count()).toBe(2);
    const pdf = await page.pdf({ width: '216mm', height: '303mm', printBackground: true, preferCSSPageSize: true });
    await page.close();
    const out = path.join(tempDir(), 'smoke.pdf');
    fs.writeFileSync(out, pdf);
    let info = '';
    try {
      info = execFileSync('pdfinfo', [out], { encoding: 'utf8' });
    } catch {
      // pdfinfo が無い環境ではページ数だけ素朴に数える
      const pages = pdf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) ?? [];
      expect(pages.length).toBe(2);
      return;
    }
    expect(info).toMatch(/Pages:\s+2/);
    const m = /Page size:\s+([\d.]+) x ([\d.]+) pts/.exec(info);
    expect(m).not.toBeNull();
    const pt = (mm: number) => (mm / 25.4) * 72;
    expect(Math.abs(Number(m![1]) - pt(216))).toBeLessThan(1);
    expect(Math.abs(Number(m![2]) - pt(303))).toBeLessThan(1);
  });
});
