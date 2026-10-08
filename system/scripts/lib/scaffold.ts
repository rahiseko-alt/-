// new:book / new:page 共通: ページ雛形からのページ作成・ページ ID の採番・合成チェック
import fs from 'node:fs';
import path from 'node:path';
import { PAGE_ID_RE, PAGE_TYPES, composePage, errorMessage, type PageType } from '../../design-engine/src/index.ts';
import { CliError } from './cli.ts';
import { TEMPLATES_DIR, copyTemplateDir, type TemplateVars } from './templates.ts';

/** --title 省略時のページタイトル */
export const DEFAULT_PAGE_TITLES: Record<PageType, string> = {
  cover: '表紙',
  toc: '目次',
  message: 'メッセージ',
  course: '学科紹介',
  interview: 'インタビュー',
  data: 'データ',
  access: 'アクセス',
  'back-cover': '裏表紙',
  other: '本文ページ',
};

export { PAGE_TYPES };
export type { PageType };

export interface PageSpec {
  id: string;
  type: PageType;
  title: string;
}

/** page_NNN の番号 */
function pageNumberOf(id: string): number {
  return Number(id.slice('page_'.length));
}

/** book.yaml の pages と pages/ 以下の既存ディレクトリのどちらとも重ならない次のページ ID */
export function nextPageId(bookAbsDir: string, listed: string[]): string {
  const used = new Set(listed.filter((p) => PAGE_ID_RE.test(p)));
  const pagesDir = path.join(bookAbsDir, 'pages');
  if (fs.existsSync(pagesDir)) {
    for (const ent of fs.readdirSync(pagesDir, { withFileTypes: true })) if (PAGE_ID_RE.test(ent.name)) used.add(ent.name);
  }
  const max = Math.max(0, ...[...used].map(pageNumberOf));
  const next = max + 1;
  if (next > 999) throw new CliError('ページ ID の番号が 999 を超えます（page_NNN は 3 桁まで）');
  return `page_${String(next).padStart(3, '0')}`;
}

/** ページ雛形（system/templates/page/）から books/<id>/pages/<pageId>/ を作る */
export function createPageFiles(bookAbsDir: string, bookId: string, page: PageSpec, date: string): string[] {
  const dest = path.join(bookAbsDir, 'pages', page.id);
  if (fs.existsSync(dest)) throw new CliError(`ページのディレクトリが既にあります: ${dest}`);
  const vars: TemplateVars = {
    __BOOK_ID__: bookId,
    __PAGE_ID__: page.id,
    __PAGE_TYPE__: page.type,
    __PAGE_TITLE__: page.title,
    __DATE__: date,
  };
  try {
    return copyTemplateDir(path.join(TEMPLATES_DIR, 'page'), dest, vars);
  } catch (err) {
    fs.rmSync(dest, { recursive: true, force: true });
    throw err;
  }
}

/** 作ったページを試しに合成する（テンプレートエラー・警告を返す） */
export function tryCompose(root: string, bookId: string, pageIds: string[]): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const pageId of pageIds) {
    try {
      const r = composePage({ root, bookId, pageId, mode: 'render' });
      for (const w of r.warnings) if (!warnings.includes(w)) warnings.push(w);
    } catch (err) {
      errors.push(`${pageId}: ${errorMessage(err)}`);
    }
  }
  return { errors, warnings };
}
