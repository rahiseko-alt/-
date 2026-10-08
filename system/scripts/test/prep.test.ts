// ref:prep: 参考ページ画像の正立・単ページ・台形補正（画像はテスト中に一時ディレクトリへ生成する）
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { parse as parseYaml } from 'yaml';
import { afterAll, describe, expect, it } from 'vitest';
import { compareCommand } from '../lib/compare.ts';
import { homography, prepCachePath, prepCommand } from '../lib/prep.ts';
import { validateCommand } from '../lib/validate.ts';
import { cleanupTemp, copyFixture, run, writeFile } from './helpers.ts';

const RED = { r: 220, g: 30, b: 30 };
const BLUE = { r: 30, g: 60, b: 200 };

afterAll(() => cleanupTemp());

/** 正立で 200×300（上半分が赤・下半分が青）のページを、反時計回りに 90° 倒した写真として保存する */
async function writeRotatedPage(file: string): Promise<void> {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const bottom = await sharp({ create: { width: 200, height: 150, channels: 3, background: BLUE } }).png().toBuffer();
  const upright = await sharp({ create: { width: 200, height: 300, channels: 3, background: RED } })
    .composite([{ input: bottom, left: 0, top: 150 }])
    .png()
    .toBuffer();
  await sharp(upright).rotate(270).jpeg({ quality: 95 }).toFile(file);
}

async function pixel(file: string, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const o = (y * info.width + x) * info.channels;
  return [data[o]!, data[o + 1]!, data[o + 2]!];
}

describe('homography', () => {
  it('4 組の対応点を正確に写す（平行移動と拡大）', () => {
    const h = homography(
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      [
        [5, 5],
        [25, 5],
        [25, 25],
        [5, 25],
      ],
    );
    const map = (x: number, y: number) => {
      const w = h[6]! * x + h[7]! * y + h[8]!;
      return [(h[0]! * x + h[1]! * y + h[2]!) / w, (h[3]! * x + h[4]! * y + h[5]!) / w];
    };
    expect(map(10, 10)[0]).toBeCloseTo(25);
    expect(map(5, 5)[1]).toBeCloseTo(15);
  });

  it('一直線上の 4 点はエラー', () => {
    const line: Array<[number, number]> = [
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
    ];
    expect(() => homography(line, line)).toThrow(/一直線上/);
  });
});

describe('ref:prep', () => {
  it('rotate で正立させ、corners の範囲を aspect × height_px に切り出す', async () => {
    const root = copyFixture();
    await writeRotatedPage(path.join(root, 'references/Sample/brochure/page_010.jpg'));
    const spec = 'references/Sample/brochure/prep/page_010.yaml';
    writeFile(
      root,
      spec,
      'image: references/Sample/brochure/page_010.jpg\nrotate: 90\ncorners: [[0, 0], [1, 0], [1, 1], [0, 1]]\naspect: 0.6667\nheight_px: 300\n',
    );
    const r = await run(prepCommand, ['--spec', spec, '--root', root]);
    expect(r.code, r.text).toBe(0);
    const out = prepCachePath(root, spec);
    expect(out).toBe(path.join(root, '.cache/ref-prep/Sample/brochure/prep/page_010.png'));
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height]).toEqual([200, 300]);
    // 上が赤・下が青（正しい向き）
    const top = await pixel(out, 100, 20);
    const bottom = await pixel(out, 100, 280);
    expect(top[0]).toBeGreaterThan(180);
    expect(bottom[2]).toBeGreaterThan(160);

    // 下半分だけを切り出す（corners は正立後の比率）
    writeFile(root, spec, 'image: references/Sample/brochure/page_010.jpg\nrotate: 90\ncorners: [[0, 0.55], [1, 0.55], [1, 1], [0, 1]]\naspect: 1.4815\nheight_px: 135\n');
    expect((await run(prepCommand, ['--all', '--root', root])).code).toBe(0);
    const corner = await pixel(out, 5, 5);
    expect(corner[2]).toBeGreaterThan(160);
    expect(corner[0]).toBeLessThan(80);
  });

  it('指定ファイルの誤りは validate がエラーにし、ref:prep も失敗する', async () => {
    const root = copyFixture();
    const spec = 'references/Sample/brochure/prep/bad.yaml';
    writeFile(root, spec, 'image: references/Sample/brochure/none.jpg\nrotate: 45\ncorners: [[0, 0], [1, 0], [1, 1]]\naspect: 1\n');
    const v = await run(validateCommand, ['--root', root]);
    expect(v.code).toBe(1);
    expect(v.out).toContain('prep/bad.yaml');
    const r = await run(prepCommand, ['--spec', spec, '--root', root]);
    expect(r.code).toBe(1);
    expect((await run(prepCommand, ['--root', root])).code).toBe(1);
  });

  it('compare の --reference に指定ファイルを渡すと、補正した画像と比較し report に指定ファイルを記録する', async () => {
    const root = copyFixture();
    await writeRotatedPage(path.join(root, 'references/Sample/brochure/page_010.jpg'));
    const spec = 'references/Sample/brochure/prep/page_010.yaml';
    writeFile(root, spec, 'image: references/Sample/brochure/page_010.jpg\nrotate: 90\ncorners: [[0, 0], [1, 0], [1, 1], [0, 1]]\naspect: 0.7071\nheight_px: 842\n');
    // A4 + 塗り足し 3mm を 72dpi（612×859px）、全面が赤のレンダリング画像
    const rendered = path.join(root, 'rendered.png');
    await sharp({ create: { width: 612, height: 859, channels: 3, background: RED } }).png().toFile(rendered);
    const r = await run(compareCommand, ['--book', 'smoke', '--page', 'page_001', '--reference', spec, '--rendered', rendered, '--root', root]);
    expect(r.code, r.text).toBe(0);
    const m = /出力: (\S+)\//.exec(r.out);
    const report = parseYaml(fs.readFileSync(path.join(root, m![1]!, 'report.yaml'), 'utf8')) as Record<string, unknown>;
    expect(report.reference).toBe(spec);
    // 下半分（青）だけが異なる
    expect(report.mismatch_ratio as number).toBeGreaterThan(0.4);
    expect(report.mismatch_ratio as number).toBeLessThan(0.6);
  });
});
