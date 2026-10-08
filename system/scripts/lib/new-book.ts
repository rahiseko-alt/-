// new:book: system/templates/book/ と page/ から新しい BOOK を作る
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  BOOK_KINDS,
  ORIENTATIONS,
  SIZE_NAMES,
  bookFileName,
  bookRelDir,
  isValidBookId,
  resolveInRoot,
  type BookKind,
  type PageType,
} from '../../design-engine/src/index.ts';
import { removeFromList, setBlockList } from './book-yaml.ts';
import {
  CliError,
  UsageError,
  consoleIo,
  formatDate,
  parseChoice,
  parseCli,
  parsePositiveNumber,
  resolveRoot,
  runCommand,
  show,
  type Command,
  type Io,
} from './cli.ts';
import { DEFAULT_PAGE_TITLES, createPageFiles, tryCompose, type PageSpec } from './scaffold.ts';
import { TEMPLATES_DIR, copyTemplateDir, leftoverPlaceholders, listFiles } from './templates.ts';

const PRESET_SIZES = SIZE_NAMES.filter((s) => s !== 'custom');

export const NEW_BOOK_USAGE = `使い方: npm run new:book -- <bookId> [オプション]
  <bookId>              BOOK ID（books/ からの相対パス。例: brochure, admissions, flyers/open-campus）
  --kind <kind>         ${BOOK_KINDS.join(' | ')}（既定: brochure）
  --title <text>        タイトル（既定: BOOK ID）
  --size <size>         ${PRESET_SIZES.join(' | ')}（既定: A4。custom は作成後に book.yaml で指定）
  --orientation <o>     ${ORIENTATIONS.join(' | ')}（既定: portrait）
  --pages <N>           最初に作るページ数（既定: 4。1 ページ目 = 表紙、最終ページ = 裏表紙）
  --root <dir>          スタジオのルート（既定: リポジトリルート）
例:
  npm run new:book -- brochure --title "学校案内" --pages 8
  npm run new:book -- flyers/open-campus --kind flyer --size A4 --pages 2`;

export interface NewBookOptions {
  root: string;
  bookId: string;
  kind?: BookKind;
  title?: string;
  size?: string;
  orientation?: string;
  pages?: number;
  date?: string;
}

export interface NewBookResult {
  dir: string;
  files: string[];
  pages: PageSpec[];
  warnings: string[];
  composeErrors: string[];
}

/** 一枚もの（綴じなし）として扱う種別 */
const SHEET_KINDS: BookKind[] = ['flyer', 'poster'];

/** ページ構成（1 = 表紙、最終 = 裏表紙、それ以外 = 本文） */
export function initialPages(count: number): PageSpec[] {
  return Array.from({ length: count }, (_, i) => {
    const type: PageType = i === 0 ? 'cover' : i === count - 1 ? 'back-cover' : 'other';
    return { id: `page_${String(i + 1).padStart(3, '0')}`, type, title: DEFAULT_PAGE_TITLES[type] };
  });
}

export function createBook(opts: NewBookOptions): NewBookResult {
  const { root, bookId } = opts;
  if (!isValidBookId(bookId)) {
    throw new CliError(
      `不正な BOOK ID です: "${bookId}"`,
      'books/ からの相対パス（英数字・-・_ を / で連結。config / pages / backgrounds / components / reviews / output は使えない）',
    );
  }
  const relDir = bookRelDir(bookId);
  const dir = resolveInRoot(root, relDir);
  if (fs.existsSync(dir)) throw new CliError(`${relDir}/ は既に存在します（上書きしません）`);
  // 既存 BOOK の内側には作らない
  const segs = bookId.split('/');
  for (let i = 1; i < segs.length; i++) {
    const parent = segs.slice(0, i).join('/');
    if (fs.existsSync(path.join(root, 'books', parent, 'config', 'book.yaml'))) {
      throw new CliError(`books/${parent} は BOOK です。BOOK の中に別の BOOK は作れません`);
    }
  }

  const kind = opts.kind ?? 'brochure';
  const size = opts.size ?? 'A4';
  const orientation = opts.orientation ?? 'portrait';
  const count = opts.pages ?? 4;
  if (!Number.isInteger(count) || count < 1 || count > 999) throw new CliError(`--pages は 1〜999 の整数です（${count}）`);
  const date = opts.date ?? formatDate();
  const pages = initialPages(count);
  const warnings: string[] = [];

  // 一時ディレクトリに組み立ててから移動する（途中で失敗しても中途半端な BOOK を残さない）
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const staging = fs.mkdtempSync(path.join(path.dirname(dir), '.new-book-'));
  try {
    copyTemplateDir(path.join(TEMPLATES_DIR, 'book'), staging, {
      __BOOK_ID__: bookId,
      __TITLE__: opts.title ?? bookId,
      __KIND__: kind,
      __SIZE__: size,
      __ORIENTATION__: orientation,
      __DATE__: date,
    });
    const bookYaml = path.join(staging, 'config', 'book.yaml');
    let text = fs.readFileSync(bookYaml, 'utf8');
    const label = `${relDir}/config/book.yaml`;
    text = setBlockList(text, 'pages', pages.map((p) => p.id), label);
    // 一枚もの（チラシ・ポスター）は綴じなし
    if (SHEET_KINDS.includes(kind)) text = text.replace(/^(\s*binding:\s*)left\b/m, '$1none');
    // このルートに存在しない共通 CSS は外す（テスト用ルートなど）
    text = removeFromList(
      text,
      'styles',
      (style) => {
        const missing = !fs.existsSync(path.join(root, style));
        if (missing) warnings.push(`${style} がこのルートにないため book.yaml の styles から外しました`);
        return missing;
      },
      label,
    );
    fs.writeFileSync(bookYaml, text, 'utf8');
    for (const p of pages) createPageFiles(staging, bookId, p, date);
    for (const rel of listFiles(staging)) {
      const left = leftoverPlaceholders(fs.readFileSync(path.join(staging, rel), 'utf8'));
      if (left.length > 0) warnings.push(`${relDir}/${rel}: 未置換のプレースホルダ ${left.join(', ')}`);
    }
    fs.renameSync(staging, dir);
  } catch (err) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw err;
  }

  const files = listFiles(dir).map((rel) => path.join(dir, rel));
  const check = tryCompose(root, bookId, pages.map((p) => p.id));
  for (const w of check.warnings) if (!warnings.includes(w)) warnings.push(w);
  return { dir, files, pages, warnings, composeErrors: check.errors };
}

export const newBookCommand: Command = (argv, io: Io = consoleIo) =>
  runCommand(io, NEW_BOOK_USAGE, async () => {
    const { values, positionals } = parseCli(() =>
      parseArgs({
        args: argv,
        options: {
          kind: { type: 'string', default: 'brochure' },
          title: { type: 'string' },
          size: { type: 'string', default: 'A4' },
          orientation: { type: 'string', default: 'portrait' },
          pages: { type: 'string', default: '4' },
          root: { type: 'string' },
          help: { type: 'boolean', short: 'h', default: false },
        },
        allowPositionals: true,
        strict: true,
      }),
    );
    if (values.help) {
      io.log(NEW_BOOK_USAGE);
      return 0;
    }
    if (positionals.length === 0) throw new UsageError('BOOK ID を指定してください');
    if (positionals.length > 1) throw new UsageError(`BOOK ID は 1 つだけ指定してください（${positionals.join(' ')}）`);
    const bookId = positionals[0] ?? '';
    const kind = parseChoice('--kind', values.kind ?? 'brochure', BOOK_KINDS);
    if (values.size === 'custom') throw new UsageError('--size custom は使えません。A4 などで作成してから book.yaml の format に size: custom と width_mm / height_mm を書いてください');
    const size = parseChoice('--size', values.size ?? 'A4', PRESET_SIZES);
    const orientation = parseChoice('--orientation', values.orientation ?? 'portrait', ORIENTATIONS);
    const pages = parsePositiveNumber('--pages', values.pages, { integer: true, max: 999 }) ?? 4;
    if (values.title != null && values.title.trim() === '') throw new UsageError('--title が空です');
    const root = resolveRoot(values.root);

    const r = createBook({ root, bookId, kind, title: values.title, size, orientation, pages });
    const rel = show(root, r.dir);
    io.log(`new:book: ${rel}/ を作成しました（${kind}・${size} ${orientation}・${r.pages.length} ページ）`);
    for (const f of r.files) io.log(`  ${show(root, f)}`);
    if (r.warnings.length > 0) {
      io.log('\n警告:');
      for (const w of r.warnings) io.log(`  - ${w}`);
    }
    if (r.composeErrors.length > 0) {
      io.error('\nエラー: 作成したページを合成できません（雛形または company-data を確認してください）');
      for (const e of r.composeErrors) io.error(`  - ${e}`);
      return 1;
    }
    io.log('\n次にやること:');
    io.log(`  1. ${rel}/config/book.yaml の title・判型・余白を確認する`);
    io.log(`  2. ${rel}/references.yaml に参考資料を指定する（system/rules/references.md）`);
    io.log(`  3. プレビュー: npm run dev → http://localhost:5173/preview/${bookId}/${r.pages[0]?.id ?? 'page_001'}?guides=1`);
    io.log(`  4. ページの追加: npm run new:page -- --book ${bookId} --after <pageId> --type <type>`);
    io.log(`  5. 確認用の出力: npm run render -- --book ${bookId} --format png --dpi 150 --out /tmp/${bookFileName(bookId)}-check（低解像度の確認用は output/ に置かない）`);
    io.log(`  6. 正式な出力: npm run render -- --book ${bookId} --release（books/${bookId}/output/ に書き出す。仮テキストの "TODO" が残っていると止まります）`);
    return 0;
  });
