// gen:inputs と validate: Layer 1 の生成指示（layer1-orders.yaml）。画像はテスト中に一時ディレクトリへ生成する
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { genInputsCommand, genInputsDir } from '../lib/gen-inputs.ts';
import { validateCommand } from '../lib/validate.ts';
import { cleanupTemp, copyFixture, run, writeFile } from './helpers.ts';

const RED = { r: 220, g: 30, b: 30 };
const BLUE = { r: 30, g: 60, b: 200 };
const ORDERS = 'books/smoke/backgrounds/layer1-orders.yaml';
const NEGATIVE = 'text, letters, typography, words, numbers, logo, watermark, signature, QR code, caption';

afterAll(() => cleanupTemp());

/** A4 縦を 1px = 1mm（210×297px）で、上半分が赤・下半分が青の参考ページと補正指定を置く */
async function writeReference(root: string): Promise<void> {
  const file = path.join(root, 'references/Sample/brochure/page_010.png');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const bottom = await sharp({ create: { width: 210, height: 149, channels: 3, background: BLUE } }).png().toBuffer();
  await sharp({ create: { width: 210, height: 297, channels: 3, background: RED } })
    .composite([{ input: bottom, left: 0, top: 148 }])
    .png()
    .toFile(file);
  writeFile(
    root,
    'references/Sample/brochure/prep/page_010.yaml',
    'image: references/Sample/brochure/page_010.png\nrotate: 0\ncorners: [[0, 0], [1, 0], [1, 1], [0, 1]]\naspect: 0.7071\nheight_px: 297\n',
  );
}

function item(id: string, crop: string, extra = ''): string {
  return `  - id: ${id}
    kind: photo
    people: false
    size_mm: [50, 40]
    crop_mm: ${crop}
    placement: "page.html の photo-frame"
    reference_usage: composition
    mask: なし
    prompt: |
      A calm abstract photo.
    negative_prompt: "${NEGATIVE}"
    summary: テスト用
${extra}`;
}

function orders(items: string, head = 'book: smoke'): string {
  return `${head}
page: page_001
reference_image: references/Sample/brochure/page_010.png
reference_prep: references/Sample/brochure/prep/page_010.yaml
status: pending
items:
${items}`;
}

async function pixel(file: string, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const o = (y * info.width + x) * info.channels;
  return [data[o]!, data[o + 1]!, data[o + 2]!];
}

describe('gen:inputs', () => {
  it('補正後の参考ページから crop_mm を切り出し、ページ外は白で埋める', async () => {
    const root = copyFixture();
    await writeReference(root);
    writeFile(root, ORDERS, orders(item('page_001-top', '[10, 10, 50, 40]') + item('page_001-edge', '[-5, 280, 30, 30]', '    optional: true\n')));
    const r = await run(genInputsCommand, ['--book', 'smoke', '--root', root]);
    expect(r.code, r.text).toBe(0);
    // smoke は png_dpi 350: 50mm → 689px、40mm → 551px
    expect(r.out).toContain('page_001-top  50×40mm  photo・未生成  必要 689×551px');
    expect(r.out).toContain('任意');

    const dir = genInputsDir(root, 'smoke');
    const top = path.join(dir, 'page_001-top.png');
    expect([(await sharp(top).metadata()).width, (await sharp(top).metadata()).height]).toEqual([50, 40]);
    expect((await pixel(top, 25, 20))[0]).toBeGreaterThan(180);

    const edge = path.join(dir, 'page_001-edge.png');
    expect((await pixel(edge, 2, 5))).toEqual([255, 255, 255]); // ページの左外
    expect((await pixel(edge, 20, 25))).toEqual([255, 255, 255]); // ページの下外
    expect((await pixel(edge, 20, 5))[2]).toBeGreaterThan(160); // ページ内（青）

    // --all でも同じ BOOK が対象になる
    expect((await run(genInputsCommand, ['--all', '--root', root])).code).toBe(0);
  });

  it('生成指示がない・引数がないときは失敗する', async () => {
    const root = copyFixture();
    expect((await run(genInputsCommand, ['--book', 'smoke', '--root', root])).code).toBe(1);
    expect((await run(genInputsCommand, ['--root', root])).code).toBe(1);
  });
});

describe('validate: layer1-orders.yaml', () => {
  it('未生成の件数を警告し、全件そろって status が pending のままなら generated を促す', async () => {
    const root = copyFixture();
    await writeReference(root);
    writeFile(root, ORDERS, orders(item('page_001-top', '[10, 10, 50, 40]') + item('page_001-edge', '[-5, 280, 30, 30]', '    optional: true\n')));
    let v = await run(validateCommand, ['--root', root]);
    expect(v.code, v.text).toBe(0);
    expect(v.text).toContain('Layer 1 が未生成 2 件（必須 1・任意 1）: page_001-top, page_001-edge');

    const png = await sharp({ create: { width: 10, height: 8, channels: 3, background: RED } }).png().toBuffer();
    writeFile(root, 'books/smoke/backgrounds/page_001-top.png', png);
    writeFile(root, 'books/smoke/backgrounds/page_001-edge.png', png);
    v = await run(validateCommand, ['--root', root]);
    expect(v.text).not.toContain('Layer 1 が未生成');
    expect(v.text).toContain('status を generated にしてください');
  });

  it('形式の誤り・BOOK の不一致・参照先の欠落はエラー', async () => {
    const root = copyFixture();
    await writeReference(root);
    const badNegative = item('page_001-top', '[10, 10, 50, 40]').replace(NEGATIVE, 'text, logo');
    writeFile(root, ORDERS, orders(badNegative + item('page_001-top', '[0, 0, 10, 10]'), 'book: other'));
    const v = await run(validateCommand, ['--root', root]);
    expect(v.code).toBe(1);
    expect(v.out).toContain('negative_prompt');
    expect(v.out).toContain('重複');

    writeFile(root, ORDERS, orders(item('page_001-top', '[10, 10, 50, 40]'), 'book: other'));
    const v2 = await run(validateCommand, ['--root', root]);
    expect(v2.code).toBe(1);
    expect(v2.out).toContain('BOOK ID "smoke" と一致しません');

    fs.rmSync(path.join(root, 'references/Sample/brochure/page_010.png'));
    writeFile(root, ORDERS, orders(item('page_001-top', '[10, 10, 50, 40]')));
    const v3 = await run(validateCommand, ['--root', root]);
    expect(v3.code).toBe(1);
    expect(v3.out).toContain('参照先がありません: references/Sample/brochure/page_010.png');
  });
});
