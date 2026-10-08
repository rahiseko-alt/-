// new:page: 次の page_NNN を作り、book.yaml の pages にコメントを保ったまま挿入する
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadBook, loadPage } from '../../design-engine/src/index.ts';
import { newPageCommand } from '../lib/new-page.ts';
import { validateCommand } from '../lib/validate.ts';
import { cleanupTemp, copyFixture, readFile, run, writeFile } from './helpers.ts';

afterAll(() => cleanupTemp());

const BOOK_YAML = 'books/smoke/config/book.yaml';

describe('new:page', () => {
  it('--after の直後に挿入し、book.yaml の他の行（コメント含む）は変えない', async () => {
    const root = copyFixture();
    const before = readFile(root, BOOK_YAML);
    const r = await run(newPageCommand, ['--book', 'smoke', '--after', 'page_001', '--type', 'course', '--title', '学科: AI', '--root', root]);
    expect(r.code, r.text).toBe(0);
    expect(r.out).toContain('page_003（course）を 2 ページ目に追加しました');
    expect(r.out).toContain('page_002 以降のページ番号が 1 つずれます');

    const after = readFile(root, BOOK_YAML);
    expect(after).toBe(before.replace('pages: [page_001, page_002]', 'pages: [page_001, page_003, page_002]'));
    expect(after).toContain('# テスト用 BOOK（A4・塗り足し 3mm・2 ページ）');

    const page = loadPage(root, 'smoke', 'page_003');
    expect(page.config).toMatchObject({ id: 'page_003', title: '学科: AI', type: 'course', status: 'draft' });
    expect(page.template).toContain('{{facts.school.name}}');

    const v = await run(validateCommand, ['--root', root]);
    expect(v.code, v.text).toBe(0);
  });

  it('--after を省略すると末尾に追加。pages にない既存ディレクトリの番号は使わない', async () => {
    const root = copyFixture();
    writeFile(root, 'books/smoke/pages/page_007/page.yaml', 'id: page_007\ntitle: 下書き\ntype: other\n');
    const r = await run(newPageCommand, ['--book', 'smoke', '--root', root]);
    expect(r.code, r.text).toBe(0);
    expect(loadBook(root, 'smoke').config.pages).toEqual(['page_001', 'page_002', 'page_008']);
    expect(loadPage(root, 'smoke', 'page_008').config).toMatchObject({ type: 'other', title: '本文ページ' });
  });

  it('ブロック形式の pages は同じ字下げで 1 行挿入し、コメントを残す', async () => {
    const root = copyFixture();
    const yaml = readFile(root, BOOK_YAML).replace(
      'pages: [page_001, page_002]',
      'pages:\n  - page_001   # 表紙\n  # ここから本文\n  - page_002\n# ページここまで',
    );
    writeFile(root, BOOK_YAML, yaml);
    const r = await run(newPageCommand, ['--book', 'smoke', '--after', 'page_001', '--root', root]);
    expect(r.code, r.text).toBe(0);
    expect(readFile(root, BOOK_YAML)).toBe(yaml.replace('  - page_001   # 表紙\n', '  - page_001   # 表紙\n  - page_003\n'));

    const r2 = await run(newPageCommand, ['--book', 'smoke', '--root', root]);
    expect(r2.code, r2.text).toBe(0);
    expect(readFile(root, BOOK_YAML)).toContain('  - page_002\n  - page_004\n# ページここまで');
    expect(loadBook(root, 'smoke').config.pages).toEqual(['page_001', 'page_003', 'page_002', 'page_004']);
  });

  it('存在しない --after・BOOK・種別はエラーで、何も作らない', async () => {
    const root = copyFixture();
    const before = readFile(root, BOOK_YAML);
    const cases: Array<[string[], string]> = [
      [['--book', 'smoke', '--after', 'page_009'], 'pages に page_009 がありません'],
      [['--book', 'smoke', '--after', 'p1'], 'page_NNN 形式'],
      [['--book', 'smoke', '--type', 'poster'], '--type は cover'],
      [['--book', 'nothing'], 'BOOK "nothing" が見つかりません'],
      [[], '--book を指定してください'],
    ];
    for (const [args, msg] of cases) {
      const r = await run(newPageCommand, [...args, '--root', root]);
      expect(r.code, args.join(' ')).toBe(1);
      expect(r.err, args.join(' ')).toContain(msg);
    }
    expect(readFile(root, BOOK_YAML)).toBe(before);
    expect(fs.readdirSync(path.join(root, 'books/smoke/pages')).sort()).toEqual(['page_001', 'page_002']);
  });
});
