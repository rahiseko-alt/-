// ref:ingest: 参考資料の取り込み（画像・PDF はテスト中に一時ディレクトリへ生成する）
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { loadAnalysis, loadReferenceSource } from '../../design-engine/src/index.ts';
import { ingestCommand } from '../lib/ingest.ts';
import { validateCommand } from '../lib/validate.ts';
import { cleanupTemp, copyFixture, readFile, run, tempDir } from './helpers.ts';

afterAll(() => cleanupTemp());

async function solid(file: string, color: string, format: 'png' | 'jpeg' | 'webp'): Promise<void> {
  await sharp({ create: { width: 40, height: 56, channels: 3, background: color } })[format]().toFile(file);
}

describe('ref:ingest --images', () => {
  it('自然順に page_NNN として取り込み、source.yaml と analysis/book.yaml を作る', async () => {
    const root = copyFixture();
    const images = tempDir();
    await solid(path.join(images, 'scan 2.png'), '#336699', 'png');
    await solid(path.join(images, 'scan 10.jpeg'), '#993366', 'jpeg');
    await solid(path.join(images, 'scan 1.webp'), '#669933', 'webp');
    fs.writeFileSync(path.join(images, 'memo.txt'), 'メモ');

    const r = await run(ingestCommand, ['--source', 'Other-school', '--kind', 'flyers', '--images', images, '--root', root]);
    expect(r.code, r.text).toBe(0);
    expect(r.out).toContain('3 ページを取り込みました');
    expect(r.out).toContain('forbidden_terms を埋める');
    expect(r.out).toContain('memo.txt');

    const dir = path.join(root, 'references/Other-school/flyers');
    expect(fs.readdirSync(dir).sort()).toEqual(['analysis', 'page_001.png', 'page_002.png', 'page_003.jpg', 'source.yaml']);
    // scan 1.webp → PNG に変換、scan 2.png → そのまま、scan 10.jpeg → .jpg
    expect((await sharp(path.join(dir, 'page_001.png')).metadata()).format).toBe('png');
    expect(fs.readFileSync(path.join(dir, 'page_002.png')).equals(fs.readFileSync(path.join(images, 'scan 2.png')))).toBe(true);
    expect((await sharp(path.join(dir, 'page_003.jpg')).metadata()).format).toBe('jpeg');

    const source = loadReferenceSource(root, 'references/Other-school/flyers');
    expect(source).toMatchObject({ source: 'Other-school', kind: 'flyers', pages: 3, original: null, usage: 'reference-only', forbidden_terms: [] });
    expect(readFile(root, 'references/Other-school/flyers/source.yaml')).not.toMatch(/__[A-Z_]+__/);
    const analysis = loadAnalysis(root, 'references/Other-school/flyers/analysis/book.yaml');
    expect(Object.keys(analysis)).toEqual(expect.arrayContaining(['grid', 'margins', 'eye_flow', 'rhythm', 'notes']));

    // 取り込んだ直後でも validate は通る（forbidden_terms が空なのは警告）
    const v = await run(validateCommand, ['--root', root]);
    expect(v.code, v.text).toBe(0);
    expect(v.out).toContain('references/Other-school/flyers/source.yaml: forbidden_terms が空です');

    // 再実行は拒否、--force で取り込み直す（source.yaml は変更しない）
    const again = await run(ingestCommand, ['--source', 'Other-school', '--kind', 'flyers', '--images', images, '--root', root]);
    expect(again.code).toBe(1);
    expect(again.err).toContain('既にページ画像があります（3 枚）');
    fs.rmSync(path.join(images, 'scan 10.jpeg'));
    const sourceText = readFile(root, 'references/Other-school/flyers/source.yaml');
    const forced = await run(ingestCommand, ['--source', 'Other-school', '--kind', 'flyers', '--images', images, '--force', '--root', root]);
    expect(forced.code, forced.text).toBe(0);
    expect(fs.readdirSync(dir).filter((n) => n.startsWith('page_')).sort()).toEqual(['page_001.png', 'page_002.png']);
    expect(readFile(root, 'references/Other-school/flyers/source.yaml')).toBe(sourceText);
    expect(forced.out).toContain('既にあるため変更していません');
  });

  it('引数の誤りはエラー', async () => {
    const root = copyFixture();
    const images = tempDir();
    const cases: Array<[string[], string]> = [
      [['--kind', 'flyers', '--images', images], '--source を指定してください'],
      [['--source', 'X', '--images', images], '--kind を指定してください'],
      [['--source', 'X', '--kind', 'flyers'], '--pdf か --images を指定してください'],
      [['--source', 'X', '--kind', 'flyers', '--images', images, '--pdf', 'a.pdf'], '同時に指定できません'],
      [['--source', 'X/Y', '--kind', 'flyers', '--images', images], '--source は英数字'],
      [['--source', 'X', '--kind', 'flyers', '--images', images], '取り込める画像がありません'],
      [['--source', 'X', '--kind', 'flyers', '--images', path.join(images, 'none')], '画像のディレクトリが見つかりません'],
      [['--source', 'X', '--kind', 'flyers', '--pdf', path.join(images, 'none.pdf')], 'PDF が見つかりません'],
    ];
    for (const [args, msg] of cases) {
      const r = await run(ingestCommand, [...args, '--root', root]);
      expect(r.code, args.join(' ')).toBe(1);
      expect(r.err, args.join(' ')).toContain(msg);
    }
  });
});

describe('ref:ingest --pdf', () => {
  it('original/ にコピーし、pdftoppm でページごとの PNG にする', async () => {
    // 2 ページの PDF を Chromium で生成
    const work = tempDir();
    const pdf = path.join(work, 'other brochure.pdf');
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.setContent(
        '<style>@page{size:100mm 140mm;margin:0}div{width:100mm;height:140mm;break-after:page}</style><div style="background:#336699"></div><div style="background:#993366"></div>',
      );
      fs.writeFileSync(pdf, await page.pdf({ width: '100mm', height: '140mm', printBackground: true, preferCSSPageSize: true }));
    } finally {
      await browser.close();
    }

    const root = copyFixture();
    const r = await run(ingestCommand, ['--source', 'Pdf-school', '--kind', 'brochure', '--pdf', pdf, '--dpi', '36', '--root', root]);
    expect(r.code, r.text).toBe(0);
    const dir = path.join(root, 'references/Pdf-school/brochure');
    expect(fs.readdirSync(dir).sort()).toEqual(['analysis', 'original', 'page_001.png', 'page_002.png', 'source.yaml']);
    expect(fs.readdirSync(path.join(dir, 'original'))).toEqual(['other-brochure.pdf']);
    const meta = await sharp(path.join(dir, 'page_001.png')).metadata();
    // 100mm × 140mm を 36dpi
    expect(Math.abs((meta.width ?? 0) - (100 / 25.4) * 36)).toBeLessThanOrEqual(1);
    expect(Math.abs((meta.height ?? 0) - (140 / 25.4) * 36)).toBeLessThanOrEqual(1);
    const source = loadReferenceSource(root, 'references/Pdf-school/brochure');
    expect(source).toMatchObject({ pages: 2, original: 'references/Pdf-school/brochure/original/other-brochure.pdf' });

    const v = await run(validateCommand, ['--root', root]);
    expect(v.code, v.text).toBe(0);
  });

  it('--force でも、新しい PDF の変換に失敗したら既存のページ画像を消さず、壊れた PDF も残さない', async () => {
    const root = copyFixture();
    const images = tempDir();
    await solid(path.join(images, 'a.png'), '#336699', 'png');
    await solid(path.join(images, 'b.png'), '#993366', 'png');
    const first = await run(ingestCommand, ['--source', 'Other', '--kind', 'flyers', '--images', images, '--root', root]);
    expect(first.code, first.text).toBe(0);

    const broken = path.join(tempDir(), 'broken.pdf');
    fs.writeFileSync(broken, 'これは PDF ではありません');
    const r = await run(ingestCommand, ['--source', 'Other', '--kind', 'flyers', '--pdf', broken, '--force', '--root', root]);
    expect(r.code).toBe(1);
    expect(r.err).toContain('pdfinfo');
    const dir = path.join(root, 'references/Other/flyers');
    expect(fs.readdirSync(dir).sort()).toEqual(['analysis', 'page_001.png', 'page_002.png', 'source.yaml']);

    // 新規の取り込みで失敗したときも、空のディレクトリを残さない
    const fresh = await run(ingestCommand, ['--source', 'Fresh', '--kind', 'flyers', '--pdf', broken, '--root', root]);
    expect(fresh.code).toBe(1);
    expect(fs.existsSync(path.join(root, 'references/Fresh'))).toBe(false);
  });
});
