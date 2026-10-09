// render: PNG / PDF 出力（Playwright Chromium）
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pdfFileName, renderCommand } from '../lib/render.ts';
import { appendFile, cleanupTemp, copyFixture, pdfInfo, run, tempDir } from './helpers.ts';

let root: string;

beforeAll(() => {
  root = copyFixture();
});

afterAll(() => cleanupTemp());

/** コピーしたスタジオの smoke の output.png_dpi を変える（印刷用の 350dpi は描画が重いため、既定の出力先を試すときに下げる） */
function setPngDpi(studio: string, dpi: number): void {
  const file = path.join(studio, 'books/smoke/config/book.yaml');
  const yaml = fs.readFileSync(file, 'utf8');
  expect(yaml).toContain('png_dpi: 350');
  fs.writeFileSync(file, yaml.replace('png_dpi: 350', `png_dpi: ${dpi}`));
}

describe('render（smoke BOOK）', () => {
  it('PNG と PDF を既定の出力先（books/<id>/output）に book.yaml の png_dpi で書き出す（72dpi: 612×859px、PDF は 216×303mm・2 ページ）', async () => {
    // --out なしで png_dpi 未満の --dpi は確認用として止まるので、コピーの png_dpi を 72 にして --dpi を省く
    const r2 = copyFixture();
    setPngDpi(r2, 72);
    const r = await run(renderCommand, ['--book', 'smoke', '--root', r2]);
    expect(r.code, r.text).toBe(0);
    expect(r.out).toContain('books/smoke/output/png/page_001.png');
    expect(r.out).toContain('books/smoke/output/pdf/smoke.pdf');
    expect(r.out).not.toContain('システムフォント');

    // round((210 + 2×3) / 25.4 × 72) = 612, round((297 + 2×3) / 25.4 × 72) = 859
    for (const id of ['page_001', 'page_002']) {
      const meta = await sharp(path.join(r2, `books/smoke/output/png/${id}.png`)).metadata();
      expect([meta.width, meta.height]).toEqual([Math.round((216 / 25.4) * 72), Math.round((303 / 25.4) * 72)]);
      expect([meta.width, meta.height]).toEqual([612, 859]);
      expect(meta.density).toBe(72);
    }

    // 背景（Layer 1）が塗り足しの端まで描画されている（左上は SVG のグラデーションの青）
    const { data, info } = await sharp(path.join(r2, 'books/smoke/output/png/page_001.png')).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3));
    const [r0, g0, b0] = px(1, 1);
    expect(b0).toBeGreaterThan(100);
    expect(r0).toBeLessThan(80);
    expect(g0).toBeLessThan(120);
    // 下部の白い帯（Layer 2）
    const band = px(300, 850);
    expect(Math.min(...band)).toBeGreaterThan(200);

    const pdf = pdfInfo(path.join(r2, 'books/smoke/output/pdf/smoke.pdf'));
    expect(pdf.pages).toBe(2);
    // 216mm = 612.28pt、303mm = 858.90pt（Chromium は 0.24pt 刻みに丸めるため実際は 612 × 858.96。system/rules/output.md §6）
    expect(Math.abs(pdf.width - 612.3)).toBeLessThan(1);
    expect(Math.abs(pdf.height - 858.9)).toBeLessThan(1);
  });

  it('塗り足しの背景が PNG の右端・下端の画素まで届く（Chromium の CSS px 丸めで白い隙間を作らない）', async () => {
    const out = tempDir();
    // 150dpi: 216mm = 816.375 CSS px が 816px で描かれ、以前は右端 1 列が白くなっていた
    const r = await run(renderCommand, ['--book', 'smoke', '--page', 'page_001', '--format', 'png', '--dpi', '150', '--out', out, '--root', root]);
    expect(r.code, r.text).toBe(0);
    const { data, info } = await sharp(path.join(out, 'png/page_001.png')).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([1276, 1789]);
    const isWhite = (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels;
      return data[i] === 255 && data[i + 1] === 255 && data[i + 2] === 255;
    };
    for (const y of [10, Math.floor(info.height * 0.4), info.height - 10]) expect(isWhite(info.width - 1, y), `右端 y=${y}`).toBe(false);
    for (const x of [10, Math.floor(info.width / 2), info.width - 10]) expect(isWhite(x, info.height - 1), `下端 x=${x}`).toBe(false);
  });

  it('画素数が多すぎる PNG（Chromium の制限で下側が欠ける）は書き出す前にエラー', async () => {
    const out = tempDir();
    const r = await run(renderCommand, ['--book', 'smoke', '--page', 'page_001', '--format', 'png', '--dpi', '1200', '--out', out, '--root', root]);
    expect(r.code).toBe(1);
    expect(r.err).toContain('PNG が大きすぎます');
    expect(r.err).toContain('--dpi 992 以下');
    expect(fs.readdirSync(out)).toEqual([]);
    // PDF だけなら dpi は関係ない
    const pdf = await run(renderCommand, ['--book', 'smoke', '--format', 'pdf', '--dpi', '1200', '--out', out, '--root', root]);
    expect(pdf.code, pdf.text).toBe(0);
  });

  it('--page / --format png / --out / --guides', async () => {
    const out = tempDir();
    const r = await run(renderCommand, ['--book', 'smoke', '--page', 'page_002', '--format', 'png', '--dpi', '36', '--guides', '--out', out, '--root', root]);
    expect(r.code, r.text).toBe(0);
    expect(fs.readdirSync(path.join(out, 'png'))).toEqual(['page_002.png']);
    expect(fs.existsSync(path.join(out, 'pdf'))).toBe(false);
    const meta = await sharp(path.join(out, 'png/page_002.png')).metadata();
    expect([meta.width, meta.height]).toEqual([Math.round((216 / 25.4) * 36), Math.round((303 / 25.4) * 36)]);
  });

  it('--out なしの --guides（確認用）は既定の出力先に書き出さずに失敗し、一時ディレクトリを案内する', async () => {
    const r2 = copyFixture();
    setPngDpi(r2, 36);
    const output = path.join(r2, 'books/smoke/output');
    // png_dpi どおりの PNG でも、ガイドが付いていれば確認用。PDF も同じ
    for (const format of ['png', 'pdf']) {
      const r = await run(renderCommand, ['--book', 'smoke', '--page', 'page_002', '--format', format, '--guides', '--root', r2]);
      expect(r.code, `${format}: ${r.text}`).toBe(1);
      expect(r.err).toContain('確認用の出力（ガイド付き）は既定の出力先 books/smoke/output/ に書き出しません');
      expect(r.err).toContain('--out /tmp/smoke-check');
      expect(fs.existsSync(output), format).toBe(false);
    }
    // --out で一時ディレクトリを指定すれば出力できる
    const out = tempDir();
    const ok = await run(renderCommand, ['--book', 'smoke', '--page', 'page_002', '--format', 'png', '--guides', '--out', out, '--root', r2]);
    expect(ok.code, ok.text).toBe(0);
    expect(fs.readdirSync(path.join(out, 'png'))).toEqual(['page_002.png']);
    expect(fs.existsSync(output)).toBe(false);
  });

  it('--out なしで png_dpi 未満の --dpi（確認用）は失敗し、PDF だけ・png_dpi 以上・--out の明示なら既定の出力先に書ける', async () => {
    const r2 = copyFixture();
    setPngDpi(r2, 72);
    const output = path.join(r2, 'books/smoke/output');
    const low = await run(renderCommand, ['--book', 'smoke', '--page', 'page_001', '--dpi', '36', '--root', r2]);
    expect(low.code, low.text).toBe(1);
    expect(low.err).toContain('確認用の出力（PNG が 36dpi で book.yaml の output.png_dpi 72 未満）は既定の出力先 books/smoke/output/ に書き出しません');
    expect(low.err).toContain('--out /tmp/smoke-check');
    expect(low.err).toContain('--out books/smoke/output');
    expect(fs.existsSync(output)).toBe(false);

    // PDF だけなら dpi は出力に関係しない
    const pdf = await run(renderCommand, ['--book', 'smoke', '--page', 'page_001', '--format', 'pdf', '--dpi', '36', '--root', r2]);
    expect(pdf.code, pdf.text).toBe(0);
    expect(fs.readdirSync(path.join(output, 'pdf'))).toEqual(['smoke-page_001.pdf']);
    // png_dpi どおり（--dpi 省略）なら既定の出力先に書ける
    const std = await run(renderCommand, ['--book', 'smoke', '--page', 'page_001', '--format', 'png', '--root', r2]);
    expect(std.code, std.text).toBe(0);
    expect((await sharp(path.join(output, 'png/page_001.png')).metadata()).width).toBe(612);
    // 意図して低い解像度で output/ に置くときは --out で明示する
    const explicit = await run(renderCommand, ['--book', 'smoke', '--page', 'page_001', '--format', 'png', '--dpi', '36', '--out', output, '--root', r2]);
    expect(explicit.code, explicit.text).toBe(0);
    expect((await sharp(path.join(output, 'png/page_001.png')).metadata()).width).toBe(Math.round((216 / 25.4) * 36));
  });

  it('--release は TODO がなければ成功する', async () => {
    const out = tempDir();
    const r = await run(renderCommand, ['--book', 'smoke', '--format', 'pdf', '--release', '--out', out, '--root', root]);
    expect(r.code, r.text).toBe(0);
    expect(pdfInfo(path.join(out, 'pdf/smoke.pdf')).pages).toBe(2);
  });

  it('--release は描画結果に TODO があると失敗し、何も書き出さない', async () => {
    const r2 = copyFixture();
    appendFile(r2, 'books/smoke/pages/page_002/page.html', '\n<p class="data-note">TODO: 注記を確認</p>\n');
    const out = tempDir();
    const r = await run(renderCommand, ['--book', 'smoke', '--release', '--dpi', '36', '--out', out, '--root', r2]);
    expect(r.code).toBe(1);
    expect(r.err).toContain('--release');
    expect(r.err).toContain('page_002');
    expect(r.err).toContain('TODO: 注記を確認');
    expect(fs.readdirSync(out)).toEqual([]);

    // --release なしなら警告つきで出力できる
    const ok = await run(renderCommand, ['--book', 'smoke', '--format', 'png', '--dpi', '36', '--out', out, '--root', r2]);
    expect(ok.code, ok.text).toBe(0);
    expect(ok.out).toContain('本文に "TODO" が含まれています');
  });

  it('--release は company-data の TODO（QR の内容など）でも失敗する', async () => {
    const r2 = copyFixture();
    const school = path.join(r2, 'company-data/facts/school.yaml');
    fs.writeFileSync(school, fs.readFileSync(school, 'utf8').replace('url: https://example.com/', 'url: "TODO: 公式サイトの URL"'));
    const r = await run(renderCommand, ['--book', 'smoke', '--page', 'page_001', '--release', '--root', r2]);
    expect(r.code).toBe(1);
    expect(r.err).toContain('TODO: 公式サイトの URL');
  });

  it('描画中に参考資料（references/）のファイルが読み込まれたら失敗する（合成時の検査をすり抜けた場合）', async () => {
    const r2 = copyFixture();
    // スクリプトで組み立てた URL は合成時の検査では見つからない
    appendFile(
      r2,
      'books/smoke/pages/page_002/page.html',
      "\n<script>const i = new Image(); i.src = ['refer', 'ences/Sample/brochure/page_001.svg'].join(''); document.body.appendChild(i);</script>\n",
    );
    const out = tempDir();
    const r = await run(renderCommand, ['--book', 'smoke', '--page', 'page_002', '--format', 'png', '--dpi', '36', '--out', out, '--root', r2]);
    expect(r.code).toBe(1);
    expect(r.err).toContain('参考資料（references/）のファイルがページの描画に読み込まれました');
    expect(r.err).toContain('references/Sample/brochure/page_001.svg');
  });

  it('Noto にない文字（ギリシャ文字・ローマ数字・≒）はシステムフォントでの代替として警告し、--release では失敗する', async () => {
    const r2 = copyFixture();
    appendFile(r2, 'books/smoke/pages/page_002/page.html', '\n<p class="data-note">第Ⅱ期（β版）就職率≒98% αβγ Ω</p>\n');
    const ok = await run(renderCommand, ['--book', 'smoke', '--page', 'page_002', '--format', 'png', '--dpi', '36', '--out', tempDir(), '--root', r2]);
    expect(ok.code, ok.text).toBe(0);
    expect(ok.out).toMatch(/page_002: 文字 .*が Noto Sans JP \/ Noto Serif JP になく、システムフォント（.+）で描画されています/);
    const rel = await run(renderCommand, ['--book', 'smoke', '--page', 'page_002', '--format', 'pdf', '--release', '--out', tempDir(), '--root', r2]);
    expect(rel.code).toBe(1);
    expect(rel.err).toContain('環境によって字形が変わる文字があります');
  });

  it('--release と --guides は同時に使えない', async () => {
    const r = await run(renderCommand, ['--book', 'smoke', '--release', '--guides', '--root', root]);
    expect(r.code).toBe(1);
    expect(r.err).toContain('--release と --guides');
  });

  it('引数・BOOK・ページの誤りは日本語のエラーで終了コード 1', async () => {
    const cases: Array<[string[], string]> = [
      [[], '--book を指定してください'],
      [['--book', 'smoke', '--format', 'jpg'], '--format は png | pdf | both'],
      [['--book', 'smoke', '--dpi', 'abc'], '--dpi には正の数'],
      [['--book', 'smoke', '--bogus'], '不明なオプションです: --bogus'],
      [['--book', 'nothing'], 'BOOK "nothing" が見つかりません'],
      [['--book', 'smoke', '--page', 'page_009'], 'pages にないページです: page_009'],
    ];
    for (const [args, msg] of cases) {
      const r = await run(renderCommand, [...args, '--root', root]);
      expect(r.code, args.join(' ')).toBe(1);
      expect(r.err).toContain(msg);
    }
  });

  it('--help は使い方を表示して終了コード 0', async () => {
    const r = await run(renderCommand, ['--help']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('使い方: npm run render');
  });
});

describe('pdfFileName', () => {
  it('全ページは <BOOK>.pdf、一部は <BOOK>-<page>.pdf、ネストした ID は - で連結', () => {
    expect(pdfFileName('smoke', ['page_001', 'page_002'], ['page_001', 'page_002'])).toBe('smoke.pdf');
    expect(pdfFileName('smoke', ['page_002'], ['page_001', 'page_002'])).toBe('smoke-page_002.pdf');
    expect(pdfFileName('flyers/open-campus', ['page_001'], ['page_001'])).toBe('flyers-open-campus.pdf');
  });
});
