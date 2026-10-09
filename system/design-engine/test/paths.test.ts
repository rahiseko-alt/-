import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ENGINE_DIR,
  StudioError,
  bookFileName,
  findRepoRoot,
  isReferencePath,
  isValidBookId,
  listBooks,
  listReferenceSources,
  loadBook,
  loadPage,
  loadReferenceSource,
  loadReferences,
  parsePreviewPath,
  resolveEngineRequest,
  resolveInRoot,
  resolveStudioRoot,
} from '../src/index.ts';
import { FIXTURE_ROOT, REPO_ROOT, cleanupTemp, copyFixture, tempDir, writeFile } from './helpers.ts';

afterAll(cleanupTemp);

const bookYaml = (id: string, pages: string[] = []) =>
  `id: ${id}\ntitle: テスト\nkind: flyer\nformat:\n  size: A5\npages: [${pages.join(', ')}]\n`;

describe('findRepoRoot', () => {
  it('package.json の name が publishing-studio のディレクトリを返す', () => {
    expect(findRepoRoot()).toBe(REPO_ROOT);
    expect(findRepoRoot(ENGINE_DIR)).toBe(REPO_ROOT);
    expect(findRepoRoot(FIXTURE_ROOT)).toBe(REPO_ROOT);
  });

  it('見つからなければ StudioError', () => {
    expect(() => findRepoRoot(os.tmpdir())).toThrow(StudioError);
  });

  it('resolveStudioRoot は --root を絶対パスにし、省略時はリポジトリルート', () => {
    expect(resolveStudioRoot()).toBe(REPO_ROOT);
    expect(resolveStudioRoot(path.relative(process.cwd(), FIXTURE_ROOT))).toBe(FIXTURE_ROOT);
    expect(() => resolveStudioRoot(path.join(os.tmpdir(), 'does-not-exist-xyz'))).toThrow(/存在しません/);
  });
});

describe('resolveInRoot（ルート外を拒否）', () => {
  it('ルート相対パスを解決する', () => {
    expect(resolveInRoot(FIXTURE_ROOT, 'books/smoke/config/book.yaml')).toBe(path.join(FIXTURE_ROOT, 'books/smoke/config/book.yaml'));
  });

  it.each(['../package.json', 'books/../../x', '/etc/passwd', 'C:/Windows', 'file:///etc/passwd', 'books\\smoke', ''])(
    '%s は拒否',
    (p) => {
      expect(() => resolveInRoot(FIXTURE_ROOT, p)).toThrow(StudioError);
    },
  );

  it('シンボリックリンクでルート外へ出るパスを拒否', () => {
    const root = tempDir();
    const outside = tempDir();
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'x');
    fs.symlinkSync(outside, path.join(root, 'link'));
    expect(() => resolveInRoot(root, 'link/secret.txt')).toThrow(/シンボリックリンク/);
  });
});

describe('BOOK の列挙と読み込み', () => {
  it('fixture の BOOK を列挙する', () => {
    expect(listBooks(FIXTURE_ROOT)).toEqual(['smoke']);
  });

  it('ネストした BOOK ID（books/flyers/open-campus）を列挙し、pages 等の中は BOOK とみなさない', () => {
    const root = tempDir();
    writeFile(root, 'books/brochure/config/book.yaml', bookYaml('brochure'));
    writeFile(root, 'books/flyers/open-campus/config/book.yaml', bookYaml('flyers/open-campus', ['page_001']));
    writeFile(root, 'books/flyers/open-campus/pages/page_001/config/book.yaml', bookYaml('x'));
    writeFile(root, 'books/README.md', '# books\n');
    expect(listBooks(root)).toEqual(['brochure', 'flyers/open-campus']);
    const book = loadBook(root, 'flyers/open-campus');
    expect(book.relDir).toBe('books/flyers/open-campus');
    expect(book.config.format.size).toBe('A5');
  });

  it('books/ がなければ空', () => {
    expect(listBooks(tempDir())).toEqual([]);
  });

  it('book.yaml の id がディレクトリと一致しなければエラー', () => {
    const root = tempDir();
    writeFile(root, 'books/flyers/a/config/book.yaml', bookYaml('a'));
    expect(() => loadBook(root, 'flyers/a')).toThrow(/一致しません/);
  });

  it('不正な BOOK ID・存在しない BOOK はエラー', () => {
    expect(() => loadBook(FIXTURE_ROOT, '../smoke')).toThrow(/不正な BOOK ID/);
    expect(() => loadBook(FIXTURE_ROOT, 'smoke/pages')).toThrow(/不正な BOOK ID/);
    expect(() => loadBook(FIXTURE_ROOT, 'nothing')).toThrow(/見つかりません/);
    expect(isValidBookId('flyers/open-campus')).toBe(true);
    expect(isValidBookId('flyers//x')).toBe(false);
  });

  it('未知のキーは警告', () => {
    const root = tempDir();
    writeFile(root, 'books/b/config/book.yaml', `${bookYaml('b')}extra: 1\n`);
    expect(loadBook(root, 'b').warnings.join('\n')).toContain('extra');
  });

  it('loadPage は page.yaml・page.html・page.css を読む', () => {
    const page = loadPage(FIXTURE_ROOT, 'smoke', 'page_001');
    expect(page.config.type).toBe('cover');
    expect(page.template).toContain('{{facts.school.name}}');
    expect(page.cssPath).toBe('books/smoke/pages/page_001/page.css');
    const p2 = loadPage(FIXTURE_ROOT, 'smoke', 'page_002');
    expect(p2.css).toBeNull();
    expect(() => loadPage(FIXTURE_ROOT, 'smoke', 'page_1')).toThrow(/不正なページID/);
    expect(() => loadPage(FIXTURE_ROOT, 'smoke', 'page_099')).toThrow(/見つかりません/);
  });

  it('page.yaml の id 不一致・page.html 欠落はエラー', () => {
    const root = copyFixture();
    writeFile(root, 'books/smoke/pages/page_002/page.yaml', 'id: page_003\ntitle: x\ntype: data\n');
    expect(() => loadPage(root, 'smoke', 'page_002')).toThrow(/一致しません/);
    fs.rmSync(path.join(root, 'books/smoke/pages/page_001/page.html'));
    expect(() => loadPage(root, 'smoke', 'page_001')).toThrow(/page\.html がありません/);
  });

  it('references.yaml と source.yaml を読む', () => {
    expect(loadReferences(FIXTURE_ROOT, 'smoke')?.references).toEqual(['references/Sample/brochure/']);
    const root = tempDir();
    writeFile(root, 'books/b/config/book.yaml', bookYaml('b'));
    expect(loadReferences(root, 'b')).toBeNull();
    expect(listReferenceSources(FIXTURE_ROOT)).toEqual(['references/Sample/brochure']);
    expect(loadReferenceSource(FIXTURE_ROOT, 'references/Sample/brochure/').forbidden_terms).toEqual(['サンプル他校']);
  });

  it('bookFileName はネスト ID の / を - にする', () => {
    expect(bookFileName('flyers/open-campus')).toBe('flyers-open-campus');
  });
});

describe('プレビュー URL', () => {
  it('parsePreviewPath', () => {
    expect(parsePreviewPath('/preview/smoke/page_001')).toEqual({ bookId: 'smoke', pageId: 'page_001' });
    expect(parsePreviewPath('/preview/smoke')).toEqual({ bookId: 'smoke', pageId: null });
    expect(parsePreviewPath('/preview/flyers/open-campus/page_002/')).toEqual({ bookId: 'flyers/open-campus', pageId: 'page_002' });
    expect(parsePreviewPath('/preview/../etc/page_001')).toBeNull();
    expect(parsePreviewPath('/preview/')).toBeNull();
  });

  it('resolveEngineRequest はエンジンアセットとフォントだけを返す', () => {
    expect(resolveEngineRequest('/@engine/assets/base.css')).toBe(path.join(ENGINE_DIR, 'src/assets/base.css'));
    expect(resolveEngineRequest('/@engine/fonts/noto-sans-jp/400.css')).toMatch(/@fontsource[\\/]noto-sans-jp[\\/]400\.css$/);
    expect(resolveEngineRequest('/@engine/assets/../index.ts')).toBeNull();
    expect(resolveEngineRequest('/@engine/assets/%2e%2e/index.ts')).toBeNull();
    expect(resolveEngineRequest('/@engine/fonts/other-font/400.css')).toBeNull();
    expect(resolveEngineRequest('/@engine/fonts/noto-sans-jp/package.json/../../../package.json')).toBeNull();
  });
});

describe('isReferencePath（参考資料と、参考ページの画素を含む派生物）', () => {
  it.each([
    ['references/HAL/brochure/page_001.jpg', true],
    ['References/HAL/x.png', true],
    ['books/../references/x.png', true],
    ['.cache/ref-prep/HAL/page_001.png', true],
    ['.cache/gen-inputs/replica/a/page_001-hero.png', true],
    ['books/replica/a-brochure/reviews/page_001/compare-20261008-120000/side-by-side.png', true],
    ['books/brochure/reviews/page_016/compare-1/diff.png', true],
    ['books/brochure/reviews/page_016/review.md', false],
    ['books/brochure/reviews/compare-notes.md', false],
    ['books/brochure/backgrounds/page_001.png', false],
    ['.cachex/a.png', false],
    ['shared/references-like/x.png', false],
  ])('%s → %s', (p, expected) => {
    expect(isReferencePath(p)).toBe(expected);
  });
});
