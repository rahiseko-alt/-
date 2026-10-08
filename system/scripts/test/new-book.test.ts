// new:book: 雛形から作った BOOK がそのまま validate を通り、描画できる
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { parse as parseYaml } from 'yaml';
import { afterAll, describe, expect, it } from 'vitest';
import { loadBook, loadPage } from '../../design-engine/src/index.ts';
import { newBookCommand } from '../lib/new-book.ts';
import { renderCommand } from '../lib/render.ts';
import { validateCommand } from '../lib/validate.ts';
import { cleanupTemp, copyFixture, copyRealStudio, readFile, run } from './helpers.ts';

afterAll(() => cleanupTemp());

describe('new:book', () => {
  it('fixture スタジオに BOOK を作ると validate を通り、PNG に描画できる', async () => {
    const root = copyFixture();
    const r = await run(newBookCommand, ['demo', '--title', 'デモ: "学校案内" #1', '--pages', '3', '--root', root]);
    expect(r.code, r.text).toBe(0);
    expect(r.out).toContain('books/demo/ を作成しました');

    for (const f of [
      'config/book.yaml',
      'references.yaml',
      'backgrounds/README.md',
      'components/README.md',
      'reviews/README.md',
      'pages/page_001/page.yaml',
      'pages/page_001/page.html',
      'pages/page_001/page.css',
      'pages/page_003/page.html',
    ]) {
      expect(fs.existsSync(path.join(root, 'books/demo', f)), f).toBe(true);
    }
    // 一時ディレクトリが残っていない
    expect(fs.readdirSync(path.join(root, 'books')).sort()).toEqual(['demo', 'smoke']);

    const book = loadBook(root, 'demo');
    expect(book.config).toMatchObject({ id: 'demo', title: 'デモ: "学校案内" #1', kind: 'brochure', pages: ['page_001', 'page_002', 'page_003'] });
    expect(book.config.format).toMatchObject({ size: 'A4', orientation: 'portrait', bleed_mm: 3, binding: 'left' });
    // fixture には shared/layouts/grid.css などがないので styles から外す（警告）
    expect(book.config.styles).toEqual([]);
    expect(r.out).toContain('shared/layouts/grid.css がこのルートにないため book.yaml の styles から外しました');
    expect(book.warnings).toEqual([]);

    const types = ['page_001', 'page_002', 'page_003'].map((id) => loadPage(root, 'demo', id).config);
    expect(types.map((p) => [p.type, p.title, p.status])).toEqual([
      ['cover', '表紙', 'draft'],
      ['other', '本文ページ', 'draft'],
      ['back-cover', '裏表紙', 'draft'],
    ]);

    // プレースホルダが残っていない・コメントが残っている
    const yaml = readFile(root, 'books/demo/config/book.yaml');
    expect(yaml).not.toMatch(/__[A-Z_]+__/);
    expect(yaml).toContain('# 共通 CSS');
    const html = readFile(root, 'books/demo/pages/page_002/page.html');
    expect(html).not.toMatch(/__[A-Z_]+__/);
    expect(html).toContain('{{facts.school.name}}');
    expect(html).toContain('{{page.number}}');

    const v = await run(validateCommand, ['--root', root]);
    expect(v.code, v.text).toBe(0);
    // 仮テキストは TODO なので警告になる（--strict・--release では止まる）
    expect(v.out).toContain('demo/page_001: 本文に "TODO" が含まれています');
    const strict = await run(validateCommand, ['--strict', '--root', root]);
    expect(strict.code).toBe(1);

    const out = await run(renderCommand, ['--book', 'demo', '--format', 'png', '--dpi', '36', '--root', root]);
    expect(out.code, out.text).toBe(0);
    const meta = await sharp(path.join(root, 'books/demo/output/png/page_002.png')).metadata();
    expect([meta.width, meta.height]).toEqual([Math.round((216 / 25.4) * 36), Math.round((303 / 25.4) * 36)]);
  });

  it('リポジトリの company-data / shared で作った BOOK も validate を通り、PDF に描画できる', async () => {
    const root = copyRealStudio();
    const r = await run(newBookCommand, ['brochure', '--title', '学校案内', '--pages', '2', '--root', root]);
    expect(r.code, r.text).toBe(0);
    const book = loadBook(root, 'brochure');
    // 実際のリポジトリには共通 CSS がある
    for (const style of book.config.styles) expect(fs.existsSync(path.join(root, style)), style).toBe(true);

    const v = await run(validateCommand, ['--root', root]);
    expect(v.code, v.text).toBe(0);
    const out = await run(renderCommand, ['--book', 'brochure', '--format', 'pdf', '--root', root]);
    expect(out.code, out.text).toBe(0);
    expect(fs.existsSync(path.join(root, 'books/brochure/output/pdf/brochure.pdf'))).toBe(true);
  });

  it('ネストした ID・種別・判型を指定できる（チラシは綴じなし）', async () => {
    const root = copyFixture();
    const r = await run(newBookCommand, ['flyers/open-campus', '--kind', 'flyer', '--size', 'A5', '--orientation', 'landscape', '--pages', '2', '--root', root]);
    expect(r.code, r.text).toBe(0);
    const book = loadBook(root, 'flyers/open-campus');
    expect(book.config).toMatchObject({ id: 'flyers/open-campus', title: 'flyers/open-campus', kind: 'flyer' });
    expect(book.config.format).toMatchObject({ size: 'A5', orientation: 'landscape', binding: 'none' });
    const raw = parseYaml(readFile(root, 'books/flyers/open-campus/config/book.yaml')) as { pages: string[] };
    expect(raw.pages).toEqual(['page_001', 'page_002']);
  });

  it('既存の BOOK・不正な ID・BOOK の中の BOOK・引数の誤りは拒否する', async () => {
    const root = copyFixture();
    const before = readFile(root, 'books/smoke/config/book.yaml');
    const cases: Array<[string[], string]> = [
      [['smoke'], 'books/smoke/ は既に存在します'],
      [['Bad Id'], '不正な BOOK ID です'],
      [['demo/pages'], '不正な BOOK ID です'],
      [['smoke/sub'], 'books/smoke は BOOK です'],
      [[], 'BOOK ID を指定してください'],
      [['a', 'b'], 'BOOK ID は 1 つだけ'],
      [['demo', '--kind', 'magazine'], '--kind は brochure'],
      [['demo', '--size', 'custom'], '--size custom は使えません'],
      [['demo', '--pages', '0'], '--pages には正の整数'],
    ];
    for (const [args, msg] of cases) {
      const r = await run(newBookCommand, [...args, '--root', root]);
      expect(r.code, args.join(' ')).toBe(1);
      expect(r.err, args.join(' ')).toContain(msg);
    }
    expect(readFile(root, 'books/smoke/config/book.yaml')).toBe(before);
    expect(fs.existsSync(path.join(root, 'books/demo'))).toBe(false);
  });
});
