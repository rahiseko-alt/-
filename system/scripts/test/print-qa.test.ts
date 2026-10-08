// 描画結果の印刷チェック（文字の最小サイズ・白抜き・安全領域）
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { formatPrintQa, type PrintQaFinding } from '../lib/print-qa.ts';
import { renderCommand } from '../lib/render.ts';
import { appendFile, cleanupTemp, copyFixture, run, tempDir } from './helpers.ts';

afterAll(() => cleanupTemp());

/** smoke の page_002 に、検出されるべき文字と対象外の文字を置く（座標は .trim 基準の mm） */
function addSamples(root: string): void {
  appendFile(
    root,
    'books/smoke/pages/page_002/page.html',
    `
<p style="position:absolute; left:20mm; top:120mm; font-size:5pt">小さい注記テキスト</p>
<p style="position:absolute; left:20mm; top:130mm; font-size:8pt; color:#fff; background:#123; font-weight:400">白抜きの細い文字</p>
<p style="position:absolute; left:20mm; top:140mm; font-size:14pt; color:#fff; background:#123; font-weight:400">白抜きの大きい文字</p>
<p style="position:absolute; left:1mm; top:150mm; font-size:10pt">はみ出す文字</p>
<p style="position:absolute; left:20mm; top:160mm; font-size:10pt; transform:scale(0.5); transform-origin:left top">縮小した文字</p>
<p data-print-qa="ignore" style="position:absolute; left:0; top:170mm; font-size:3pt">対象外の装飾</p>
<svg style="position:absolute; left:20mm; top:180mm; width:40mm; height:10mm" viewBox="0 0 40 10"><text x="0" y="5" font-size="1.5">SVGの小さい文字</text></svg>
`,
  );
}

describe('render の印刷チェック', () => {
  it('6.5pt 未満（CSS の縮小・SVG を含む）、白抜きの細い文字、安全領域の外の文字を警告する', async () => {
    const root = copyFixture();
    addSamples(root);
    const r = await run(renderCommand, ['--book', 'smoke', '--page', 'page_002', '--format', 'png', '--dpi', '36', '--out', tempDir(), '--root', root]);
    expect(r.code, r.text).toBe(0);
    expect(r.out).toMatch(/page_002: 6\.5pt 未満の文字が 3 か所（「小さい注記テキスト」x 20\.0・y 120\.\dmm・5\.0pt/);
    expect(r.out).toContain('「縮小した文字」');
    expect(r.out).toContain('「SVGの小さい文字」');
    expect(r.out).toMatch(/page_002: 白抜き文字が 7pt 未満、または 12pt 未満でウェイト 500 未満が 1 か所（「白抜きの細い文字」.*8\.0pt・400/);
    expect(r.out).not.toContain('白抜きの大きい文字');
    expect(r.out).toMatch(/page_002: 安全領域の外の文字が 1 か所（「はみ出す文字」x 1\.0・y 150\.\dmm・4\.0mm はみ出し）/);
    expect(r.out).not.toContain('対象外の装飾');
  });

  it('--release では失敗し、何も書き出さない', async () => {
    const root = copyFixture();
    addSamples(root);
    const out = tempDir();
    const r = await run(renderCommand, ['--book', 'smoke', '--page', 'page_002', '--format', 'png', '--release', '--dpi', '36', '--out', out, '--root', root]);
    expect(r.code).toBe(1);
    expect(r.err).toContain('--release: 印刷に向かない文字があります');
    expect(r.err).toContain('data-print-qa="ignore"');
    expect(fs.existsSync(path.join(out, 'png', 'page_002.png'))).toBe(false);
  });

  it('問題がなければ警告しない（fixture の smoke は --release で出力できる）', async () => {
    const r = await run(renderCommand, ['--book', 'smoke', '--format', 'png', '--release', '--dpi', '36', '--out', tempDir(), '--root', copyFixture()]);
    expect(r.code, r.text).toBe(0);
    expect(r.out).not.toMatch(/pt 未満|安全領域の外/);
  });
});

describe('formatPrintQa', () => {
  it('ページ・種類ごとに 1 行にまとめ、例は 3 か所まで', () => {
    const f = (i: number): PrintQaFinding => ({ page: 'page_003', kind: 'safe', text: `文字${i}`, xMm: i, yMm: 2, value: 0.5 });
    const lines = formatPrintQa([f(1), f(2), f(3), f(4), f(5)], { safeMm: 5 });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('page_003: 安全領域の外の文字が 5 か所');
    expect(lines[0]).toContain('ほか 2 か所');
    expect(lines[0]).toContain('仕上がり線から 5mm の内側');
  });
});
