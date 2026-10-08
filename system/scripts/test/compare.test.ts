// compare: 参考画像との比較（pixelmatch）。画像はすべて一時ディレクトリに sharp で生成する
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { parse as parseYaml } from 'yaml';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compareCommand } from '../lib/compare.ts';
import { cleanupTemp, copyFixture, run, tempDir } from './helpers.ts';

// 72dpi の A4 + 塗り足し 3mm = 612×859px、仕上がり = 595×842px（画素数から軸ごとに求めた mm あたりの画素数で切り出す）
const BOX = { width: 612, height: 859 };
const TRIM = { width: 595, height: 842 };
const BLUE = { r: 31, g: 90, b: 138 };

let root: string;
let renderedPng: string;

/** 全面が青のレンダリング画像（塗り足し込み） */
async function makeRendered(file: string): Promise<void> {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await sharp({ create: { width: BOX.width, height: BOX.height, channels: 3, background: BLUE } }).png().toFile(file);
}

/** 青地の左上 1/4 を白くした参考画像（仕上がりサイズ） */
async function makeReference(file: string): Promise<void> {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const white = await sharp({ create: { width: Math.round(TRIM.width / 2), height: Math.round(TRIM.height / 2), channels: 3, background: '#ffffff' } })
    .png()
    .toBuffer();
  await sharp({ create: { width: TRIM.width, height: TRIM.height, channels: 3, background: BLUE } })
    .composite([{ input: white, left: 0, top: 0 }])
    .png()
    .toFile(file);
}

function readReport(dir: string): Record<string, unknown> {
  return parseYaml(fs.readFileSync(path.join(dir, 'report.yaml'), 'utf8')) as Record<string, unknown>;
}

function outDirFrom(out: string, root: string): string {
  const m = /出力: (\S+)\//.exec(out);
  if (!m?.[1]) throw new Error(`出力ディレクトリが見つかりません:\n${out}`);
  return path.join(root, m[1]);
}

beforeAll(async () => {
  root = copyFixture();
  renderedPng = path.join(tempDir(), 'rendered.png');
  await makeRendered(renderedPng);
  await makeReference(path.join(root, 'references/Sample/brochure/page_009.png'));
});

afterAll(() => cleanupTemp());

describe('compare', () => {
  it('塗り足しを切り落として比較し、report.yaml と 3 枚の画像を書き出す', async () => {
    const r = await run(compareCommand, [
      '--book', 'smoke', '--page', 'page_001',
      '--reference', 'references/Sample/brochure/page_009.png', // ルート相対
      '--rendered', renderedPng, // 絶対パス
      '--root', root,
    ]);
    expect(r.code, r.text).toBe(0);
    const dir = outDirFrom(r.out, root);
    expect(path.relative(root, dir)).toMatch(/^books\/smoke\/reviews\/page_001\/compare-\d{8}-\d{6}(-\d+)?$/);
    expect(fs.readdirSync(dir).sort()).toEqual(['diff.png', 'overlay.png', 'report.yaml', 'side-by-side.png']);

    const report = readReport(dir);
    expect(report).toMatchObject({
      book: 'smoke',
      page: 'page_001',
      reference: 'references/Sample/brochure/page_009.png',
      rendered: renderedPng,
      width: TRIM.width,
      height: TRIM.height,
      threshold: 0.1,
      crop_bleed: true,
    });
    expect(typeof report.created).toBe('string');
    // 白い 1/4 だけが差分
    expect(report.mismatch_ratio).toBeGreaterThan(0.24);
    expect(report.mismatch_ratio).toBeLessThan(0.26);
    expect(report.mismatch_pixels).toBe(Math.round(Number(report.mismatch_ratio) * TRIM.width * TRIM.height));

    for (const f of ['diff.png', 'overlay.png']) {
      const m = await sharp(path.join(dir, f)).metadata();
      expect([m.width, m.height], f).toEqual([TRIM.width, TRIM.height]);
    }
    const sbs = await sharp(path.join(dir, 'side-by-side.png')).metadata();
    expect(sbs.height).toBe(TRIM.height);
    expect(sbs.width).toBeGreaterThan(TRIM.width * 2);

    // overlay は 50% の合成（白と青の中間）
    const { data, info } = await sharp(path.join(dir, 'overlay.png')).raw().toBuffer({ resolveWithObject: true });
    const i = (10 * info.width + 10) * info.channels;
    expect(data[i]).toBe((255 + BLUE.r) >> 1);
    expect(data[i + 2]).toBe((255 + BLUE.b) >> 1);

    // review.md の雛形を作る
    const review = fs.readFileSync(path.join(root, 'books/smoke/reviews/page_001/review.md'), 'utf8');
    expect(review).toContain('# レビュー: smoke / page_001');
    expect(review).toContain(`mismatch_ratio: ${report.mismatch_ratio}`);
    expect(review).not.toMatch(/__[A-Z_]+__/);
  });

  it('既定の参考画像は references.yaml の layout_reference[0]、既定のレンダリング画像は output/png', async () => {
    const r2 = copyFixture();
    await makeRendered(path.join(r2, 'books/smoke/output/png/page_001.png'));
    fs.mkdirSync(path.join(r2, 'books/smoke/reviews/page_001'), { recursive: true });
    fs.writeFileSync(path.join(r2, 'books/smoke/reviews/page_001/review.md'), '既存の記録\n');

    const r = await run(compareCommand, ['--book', 'smoke', '--page', 'page_001', '--threshold', '0.2', '--root', r2]);
    expect(r.code, r.text).toBe(0);
    const report = readReport(outDirFrom(r.out, r2));
    expect(report.reference).toBe('references/Sample/brochure/page_001.svg');
    expect(report.rendered).toBe('books/smoke/output/png/page_001.png');
    expect(report.threshold).toBe(0.2);
    // 既存の review.md は上書きしない
    expect(fs.readFileSync(path.join(r2, 'books/smoke/reviews/page_001/review.md'), 'utf8')).toBe('既存の記録\n');

    // 同じ秒に 2 回実行しても別のディレクトリになる
    const again = await run(compareCommand, ['--book', 'smoke', '--page', 'page_001', '--root', r2]);
    expect(again.code, again.text).toBe(0);
    expect(outDirFrom(again.out, r2)).not.toBe(outDirFrom(r.out, r2));
  });

  it('--no-crop-bleed は塗り足し込みで比較する', async () => {
    const r = await run(compareCommand, [
      '--book', 'smoke', '--page', 'page_001', '--no-crop-bleed',
      '--reference', 'references/Sample/brochure/page_009.png', '--rendered', renderedPng, '--root', root,
    ]);
    expect(r.code, r.text).toBe(0);
    const report = readReport(outDirFrom(r.out, root));
    expect([report.width, report.height]).toEqual([BOX.width, BOX.height]);
    expect(report.crop_bleed).toBe(false);
  });

  it('layout_reference がない・レンダリング画像がない・引数の誤りはエラー', async () => {
    const noRef = await run(compareCommand, ['--book', 'smoke', '--page', 'page_002', '--rendered', renderedPng, '--root', root]);
    expect(noRef.code).toBe(1);
    expect(noRef.err).toContain('page_002.layout_reference がありません');

    const r2 = copyFixture();
    const noPng = await run(compareCommand, ['--book', 'smoke', '--page', 'page_001', '--root', r2]);
    expect(noPng.code).toBe(1);
    expect(noPng.err).toContain('レンダリング画像が見つかりません');
    expect(noPng.err).toContain('npm run render -- --book smoke --page page_001 --format png');

    const badThreshold = await run(compareCommand, ['--book', 'smoke', '--page', 'page_001', '--threshold', '2', '--root', root]);
    expect(badThreshold.code).toBe(1);
    expect(badThreshold.err).toContain('--threshold は 0〜1');

    const noPage = await run(compareCommand, ['--book', 'smoke', '--root', root]);
    expect(noPage.code).toBe(1);
    expect(noPage.err).toContain('--page を指定してください');
  });
});
