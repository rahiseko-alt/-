// リポジトリルートの探索・BOOK の列挙・安全なパス解決
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fg from 'fast-glob';
import { StudioError } from './errors.ts';
import { BOOK_ID_RE, PAGE_ID_RE, isSafeRelPath } from './schemas/common.ts';

export const REPO_PACKAGE_NAME = 'publishing-studio';

/** system/design-engine ディレクトリ（このパッケージ自身の位置） */
export const ENGINE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** エンジン同梱アセット（base.css 等） */
export const ENGINE_ASSETS_DIR = path.join(ENGINE_DIR, 'src', 'assets');

/** BOOK ディレクトリ内の予約名（BOOK ID のセグメントには使えない） */
const BOOK_RESERVED_DIRS = new Set(['config', 'pages', 'backgrounds', 'components', 'reviews', 'output']);

/**
 * start から親方向へ辿り、package.json の name が "publishing-studio" のディレクトリを返す。
 * start 省略時はこのファイルの位置から探す。
 */
export function findRepoRoot(start: string = ENGINE_DIR): string {
  let dir = path.resolve(start);
  for (;;) {
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg)) {
      try {
        const json = JSON.parse(fs.readFileSync(pkg, 'utf8')) as { name?: unknown };
        if (json.name === REPO_PACKAGE_NAME) return dir;
      } catch {
        // 壊れた package.json は無視して上へ
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new StudioError(`リポジトリルートが見つかりません（${start} から上位に name: "${REPO_PACKAGE_NAME}" の package.json がありません）`);
    }
    dir = parent;
  }
}

/** --root 指定（なければリポジトリルート）を絶対パスに解決する */
export function resolveStudioRoot(root?: string | null): string {
  const resolved = root ? path.resolve(root) : findRepoRoot();
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new StudioError(`スタジオのルートディレクトリが存在しません: ${resolved}`);
  }
  return resolved;
}

/** OS パスを / 区切りに変換 */
export function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/** abs が dir の内側（dir 自身を含む）にあるか */
export function isInside(dir: string, abs: string): boolean {
  const rel = path.relative(dir, abs);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * ルート相対パスを絶対パスへ解決する。ルート外を指すパス・絶対パス・スキーム付きは拒否。
 * 既存ファイルはシンボリックリンクを解決したうえでルート内か確認する。
 */
export function resolveInRoot(root: string, relPath: string): string {
  if (!isSafeRelPath(relPath)) {
    throw new StudioError(
      `不正なパスです: "${String(relPath)}"（リポジトリルート相対・"/" 区切り・先頭スラッシュなし・".." 禁止）`,
    );
  }
  const absRoot = path.resolve(root);
  const abs = path.resolve(absRoot, relPath);
  if (!isInside(absRoot, abs)) {
    throw new StudioError(`ルート外を指すパスは使えません: "${relPath}"`);
  }
  if (fs.existsSync(abs)) {
    const realRoot = fs.realpathSync(absRoot);
    const real = fs.realpathSync(abs);
    if (!isInside(realRoot, real)) {
      throw new StudioError(`シンボリックリンクでルート外を指すパスは使えません: "${relPath}"`);
    }
  }
  return abs;
}

/** 絶対パスをルート相対（/ 区切り）に変換 */
export function relFromRoot(root: string, abs: string): string {
  return toPosix(path.relative(path.resolve(root), abs));
}

export function isValidBookId(id: string): boolean {
  return BOOK_ID_RE.test(id) && !id.split('/').some((seg) => BOOK_RESERVED_DIRS.has(seg));
}

export function isValidPageId(id: string): boolean {
  return PAGE_ID_RE.test(id);
}

function assertBookId(bookId: string): void {
  if (!isValidBookId(bookId)) {
    throw new StudioError(`不正な BOOK ID です: "${bookId}"（books/ からの相対パス。例: brochure, flyers/open-campus）`);
  }
}

function assertPageId(pageId: string): void {
  if (!isValidPageId(pageId)) {
    throw new StudioError(`不正なページIDです: "${pageId}"（page_NNN 形式）`);
  }
}

/** books/<bookId>（ルート相対） */
export function bookRelDir(bookId: string): string {
  assertBookId(bookId);
  return `books/${bookId}`;
}

/** books/<bookId>/pages/<pageId>（ルート相対） */
export function pageRelDir(bookId: string, pageId: string): string {
  assertPageId(pageId);
  return `${bookRelDir(bookId)}/pages/${pageId}`;
}

export function bookDir(root: string, bookId: string): string {
  return resolveInRoot(root, bookRelDir(bookId));
}

export function pageDir(root: string, bookId: string, pageId: string): string {
  return resolveInRoot(root, pageRelDir(bookId, pageId));
}

/** 出力ファイル名用の BOOK 名（ネストした ID の / を - に置換） */
export function bookFileName(bookId: string): string {
  return bookId.replace(/\//g, '-');
}

/**
 * books/ 配下で config/book.yaml を持つディレクトリを BOOK として列挙する（ネスト対応、ソート済み）。
 * 例: books/flyers/open-campus/config/book.yaml -> "flyers/open-campus"
 */
export function listBookIds(root: string): string[] {
  return listBookDirs(root).filter((id) => isValidBookId(id));
}

/** config/book.yaml を持つが BOOK ID として使えない名前のディレクトリ（books/ からの相対。validate がエラーにする） */
export function listInvalidBookDirs(root: string): string[] {
  return listBookDirs(root).filter((id) => !isValidBookId(id));
}

/** books/ 配下で config/book.yaml を持つディレクトリ（books/ からの相対、ID の妥当性は問わない） */
function listBookDirs(root: string): string[] {
  const booksDir = path.join(path.resolve(root), 'books');
  if (!fs.existsSync(booksDir)) return [];
  const matches = fg.sync('**/config/book.yaml', {
    cwd: booksDir,
    onlyFiles: true,
    followSymbolicLinks: false,
    ignore: ['**/node_modules/**', '**/output/**', '**/reviews/**', '**/pages/**', '**/backgrounds/**', '**/components/**'],
  });
  return matches
    .map((m) => path.posix.dirname(path.posix.dirname(m)))
    .filter((id) => id !== '.')
    .sort();
}

/** references/<source>/<kind>/source.yaml を持つディレクトリ（ルート相対、ソート済み） */
export function listReferenceDirs(root: string): string[] {
  const refsDir = path.join(path.resolve(root), 'references');
  if (!fs.existsSync(refsDir)) return [];
  return fg
    .sync('*/*/source.yaml', { cwd: refsDir, onlyFiles: true, followSymbolicLinks: false })
    .map((m) => `references/${path.posix.dirname(m)}`)
    .sort();
}
