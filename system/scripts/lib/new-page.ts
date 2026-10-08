// new:page: ページ雛形から次の page_NNN を作り、book.yaml の pages に挿入する
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { PAGE_TYPES, isValidPageId, loadBook, type PageType } from '../../design-engine/src/index.ts';
import { insertIntoList } from './book-yaml.ts';
import {
  CliError,
  UsageError,
  consoleIo,
  formatDate,
  parseChoice,
  parseCli,
  resolveRoot,
  runCommand,
  show,
  type Command,
  type Io,
} from './cli.ts';
import { DEFAULT_PAGE_TITLES, createPageFiles, nextPageId, tryCompose } from './scaffold.ts';

export const NEW_PAGE_USAGE = `使い方: npm run new:page -- --book <id> [オプション]
  --book <id>         対象 BOOK（必須）
  --after <pageId>    このページの直後に挿入する（省略時は末尾）
  --type <type>       ${PAGE_TYPES.join(' | ')}（既定: other）
  --title <text>      ページのタイトル（既定: 種別ごとの名前。other は「本文ページ」）
  --root <dir>        スタジオのルート（既定: リポジトリルート）
ページ ID は空いている次の番号（page_NNN）になります。既存ページの ID は付け直しません。
例:
  npm run new:page -- --book brochure --after page_003 --type course --title "学科紹介"`;

export interface NewPageOptions {
  root: string;
  bookId: string;
  after?: string;
  type?: PageType;
  title?: string;
  date?: string;
}

export interface NewPageResult {
  pageId: string;
  /** 挿入後のページ番号（1 始まり） */
  number: number;
  pages: string[];
  files: string[];
  warnings: string[];
  composeErrors: string[];
}

export function createPage(opts: NewPageOptions): NewPageResult {
  const book = loadBook(opts.root, opts.bookId);
  const pages = book.config.pages;
  if (opts.after != null) {
    if (!isValidPageId(opts.after)) throw new CliError(`--after のページ ID は page_NNN 形式です（"${opts.after}"）`);
    if (!pages.includes(opts.after)) {
      throw new CliError(`${book.configPath} の pages に ${opts.after} がありません`, `指定できるページ: ${pages.join(', ') || '（なし）'}`);
    }
  }
  const type = opts.type ?? 'other';
  const title = opts.title ?? DEFAULT_PAGE_TITLES[type];
  const pageId = nextPageId(book.dir, pages);
  const bookYaml = path.join(book.dir, 'config', 'book.yaml');
  const original = fs.readFileSync(bookYaml, 'utf8');
  const updated = insertIntoList(original, 'pages', pageId, opts.after, book.configPath);

  const files = createPageFiles(book.dir, opts.bookId, { id: pageId, type, title }, opts.date ?? formatDate());
  try {
    fs.writeFileSync(bookYaml, updated, 'utf8');
  } catch (err) {
    fs.rmSync(path.join(book.dir, 'pages', pageId), { recursive: true, force: true });
    throw err;
  }
  const newPages = opts.after != null ? [...pages.slice(0, pages.indexOf(opts.after) + 1), pageId, ...pages.slice(pages.indexOf(opts.after) + 1)] : [...pages, pageId];
  const check = tryCompose(opts.root, opts.bookId, [pageId]);
  return {
    pageId,
    number: newPages.indexOf(pageId) + 1,
    pages: newPages,
    files,
    warnings: check.warnings,
    composeErrors: check.errors,
  };
}

export const newPageCommand: Command = (argv, io: Io = consoleIo) =>
  runCommand(io, NEW_PAGE_USAGE, async () => {
    const { values } = parseCli(() =>
      parseArgs({
        args: argv,
        options: {
          book: { type: 'string' },
          after: { type: 'string' },
          type: { type: 'string', default: 'other' },
          title: { type: 'string' },
          root: { type: 'string' },
          help: { type: 'boolean', short: 'h', default: false },
        },
        strict: true,
      }),
    );
    if (values.help) {
      io.log(NEW_PAGE_USAGE);
      return 0;
    }
    if (!values.book) throw new UsageError('--book を指定してください');
    const type = parseChoice('--type', values.type ?? 'other', PAGE_TYPES);
    if (values.title != null && values.title.trim() === '') throw new UsageError('--title が空です');
    const root = resolveRoot(values.root);
    const r = createPage({ root, bookId: values.book, after: values.after, type, title: values.title });

    const book = loadBook(root, values.book);
    io.log(`new:page: ${r.pageId}（${type}）を ${r.number} ページ目に追加しました`);
    for (const f of r.files) io.log(`  ${show(root, f)}`);
    io.log(`  ${book.configPath}（pages: ${r.pages.join(', ')}）`);
    if (r.number < r.pages.length) {
      // 途中に挿入すると後ろのページの番号が 1 つずれ、綴じありなら左右も入れ替わる
      const flips = book.config.format.binding !== 'none';
      io.log(
        `\n注意: ${r.pages[r.number]} 以降のページ番号が 1 つずれます${flips ? '。左右（ノド・小口）も入れ替わるので、ノンブルと見開きを確認してください' : ''}`,
      );
    }
    if (r.warnings.length > 0) {
      io.log('\n警告:');
      for (const w of r.warnings) io.log(`  - ${w}`);
    }
    if (r.composeErrors.length > 0) {
      io.error('\nエラー: 作成したページを合成できません');
      for (const e of r.composeErrors) io.error(`  - ${e}`);
      return 1;
    }
    io.log(`\nプレビュー: npm run dev → http://localhost:5173/preview/${values.book}/${r.pageId}?guides=1`);
    return 0;
  });
