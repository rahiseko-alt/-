// ref:ingest: 参考資料の取り込み（画像・PDF はテスト中に一時ディレクトリへ生成する）
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { loadAnalysis, loadReferenceSource } from '../../design-engine/src/index.ts';
import { ingestCommand } from '../lib/ingest.ts';
import { validateCommand } from '../lib/validate.ts';
import { cleanupTemp, copyFixture, HAS_GIT, lfsFilteredByRepoAttributes, readFile, run, tempDir } from './helpers.ts';

afterAll(() => cleanupTemp());

async function solid(file: string, color: string, format: 'png' | 'jpeg' | 'webp'): Promise<void> {
  await sharp({ create: { width: 40, height: 56, channels: 3, background: color } })[format]().toFile(file);
}

/** 1 色ずつのページ（100mm × 140mm）の PDF を Chromium で作る */
async function makePdf(file: string, colors: string[]): Promise<void> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const pages = colors.map((c) => `<div style="background:${c}"></div>`).join('');
    await page.setContent(`<style>@page{size:100mm 140mm;margin:0}div{width:100mm;height:140mm;break-after:page}</style>${pages}`);
    fs.writeFileSync(file, await page.pdf({ width: '100mm', height: '140mm', printBackground: true, preferCSSPageSize: true }));
  } finally {
    await browser.close();
  }
}

/** dir の下のファイル（root からの相対パス） */
function filesUnder(root: string, dir: string): string[] {
  return fs
    .readdirSync(path.join(root, dir), { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => path.relative(root, path.join(d.parentPath, d.name)).split(path.sep).join('/'))
    .sort();
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
      [['--source', 'X', '--kind', 'flyers', '--pdf', path.join(images, 'none.pdf'), '--format', 'gif'], '--format は jpg か png'],
    ];
    for (const [args, msg] of cases) {
      const r = await run(ingestCommand, [...args, '--root', root]);
      expect(r.code, args.join(' ')).toBe(1);
      expect(r.err, args.join(' ')).toContain(msg);
    }
  });
});

describe('ref:ingest --pdf', () => {
  it('original/ にコピーし、pdftoppm でページごとの JPEG（既定）または PNG（--format png）にする', async () => {
    // 2 ページの PDF を Chromium で生成
    const pdf = path.join(tempDir(), 'other brochure.pdf');
    await makePdf(pdf, ['#336699', '#993366']);

    const root = copyFixture();
    const r = await run(ingestCommand, ['--source', 'Pdf-school', '--kind', 'brochure', '--pdf', pdf, '--dpi', '36', '--root', root]);
    expect(r.code, r.text).toBe(0);
    const dir = path.join(root, 'references/Pdf-school/brochure');
    expect(fs.readdirSync(dir).sort()).toEqual(['analysis', 'original', 'page_001.jpg', 'page_002.jpg', 'source.yaml']);
    expect(fs.readdirSync(path.join(dir, 'original'))).toEqual(['other-brochure.pdf']);
    const meta = await sharp(path.join(dir, 'page_001.jpg')).metadata();
    expect(meta.format).toBe('jpeg');
    // 100mm × 140mm を 36dpi
    expect(Math.abs((meta.width ?? 0) - (100 / 25.4) * 36)).toBeLessThanOrEqual(1);
    expect(Math.abs((meta.height ?? 0) - (140 / 25.4) * 36)).toBeLessThanOrEqual(1);
    const source = loadReferenceSource(root, 'references/Pdf-school/brochure');
    expect(source).toMatchObject({ pages: 2, original: 'references/Pdf-school/brochure/original/other-brochure.pdf' });

    const v = await run(validateCommand, ['--root', root]);
    expect(v.code, v.text).toBe(0);

    // --format png で取り込み直すと、既存の JPEG は置き換わる
    const png = await run(ingestCommand, ['--source', 'Pdf-school', '--kind', 'brochure', '--pdf', pdf, '--dpi', '36', '--format', 'png', '--force', '--root', root]);
    expect(png.code, png.text).toBe(0);
    expect(fs.readdirSync(dir).filter((n) => n.startsWith('page_')).sort()).toEqual(['page_001.png', 'page_002.png']);
    expect((await sharp(path.join(dir, 'page_001.png')).metadata()).format).toBe('png');
  });

  // スキャナの既定名など、拡張子が大文字の PDF。.gitattributes の LFS の規則は大文字小文字を問わないので、
  // そのまま git add しても LFS に入り、どの環境の checkout でも実体に戻る（system/rules/git-workflow.md §4）
  it.skipIf(!HAS_GIT)('拡張子が大文字の PDF も元のファイル名のまま original/ に置き、取り込んだ画像・PDF はすべて .gitattributes で LFS に入る', async () => {
    const pdf = path.join(tempDir(), 'SCAN0001.PDF');
    await makePdf(pdf, ['#336699']);
    const root = copyFixture();
    const r = await run(ingestCommand, ['--source', 'Scan-school', '--kind', 'brochure', '--pdf', pdf, '--dpi', '36', '--root', root]);
    expect(r.code, r.text).toBe(0);
    const source = loadReferenceSource(root, 'references/Scan-school/brochure');
    expect(source).toMatchObject({ pages: 1, original: 'references/Scan-school/brochure/original/SCAN0001.PDF' });

    const binaries = filesUnder(root, 'references/Scan-school/brochure').filter((rel) => !rel.endsWith('.yaml'));
    expect(binaries).toEqual(['references/Scan-school/brochure/original/SCAN0001.PDF', 'references/Scan-school/brochure/page_001.jpg']);
    // core.ignoreCase=false（Linux）でも true（macOS・Windows の既定）でも同じ
    expect(lfsFilteredByRepoAttributes(binaries, false).sort()).toEqual(binaries);
    expect(lfsFilteredByRepoAttributes(binaries, true).sort()).toEqual(binaries);
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
