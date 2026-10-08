// validate: company-data・BOOK・参考資料の整合性チェック
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import fg from 'fast-glob';
import {
  AnalysisSchema,
  BackgroundPromptSchema,
  PAGE_ID_RE,
  StudioError,
  allReferencePaths,
  collectTodos,
  composePage,
  errorMessage,
  isReferencePath,
  listBookIds,
  listInvalidBookDirs,
  listReferenceSources,
  loadBook,
  loadCompanyData,
  loadPage,
  loadReferenceSource,
  loadReferences,
  loadYamlWithSchema,
  readYamlFile,
  relFromRoot,
  resolveInRoot,
  walkStrings,
  type CompanyData,
  type LoadedBook,
  type ReferenceSource,
} from '../../design-engine/src/index.ts';
import { consoleIo, parseCli, resolveRoot, runCommand, type Command, type Io } from './cli.ts';
import { charLength, lineAt, stripHandlebars } from './text.ts';

export const VALIDATE_USAGE = `使い方: npm run validate -- [--strict] [--root <dir>]
  --strict      TODO（未記入のプレースホルダ）を警告ではなくエラーにする（入稿・公開前に使う）
  --root <dir>  スタジオのルート（既定: リポジトリルート）
チェック:
  1. company-data のスキーマと TODO
  2. BOOK の設定（book.yaml・ページ・背景・styles・references.yaml）
  3. 参考資料（references/*/*/source.yaml・analysis）
  4. 全ページの試し合成（テンプレートの厳格モード・アセットの存在）
  5. 事実の直書き（company-data の値が page.html・パーシャルに直接書かれていないか）
  6. 禁止語（参考資料の forbidden_terms が books/・company-data/・shared/ に出ていないか）
  7. 背景画像の生成記録（.prompt.yaml）
エラーがあれば終了コード 1。`;

export interface CheckSection {
  no: number;
  title: string;
  errors: string[];
  warnings: string[];
  /** 補足（件数など） */
  info: string[];
}

export interface ValidateReport {
  root: string;
  strict: boolean;
  sections: CheckSection[];
  errorCount: number;
  warningCount: number;
}

/** 禁止語・直書きチェックの対象にするテキストファイルの拡張子 */
const TEXT_EXT = new Set(['.yaml', '.yml', '.html', '.htm', '.hbs', '.css', '.md', '.txt', '.json', '.svg', '.csv', '.xml', '.js', '.mjs', '.ts']);
const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const BACKGROUND_IMAGE_RE = /\.(png|jpe?g|webp)$/i;
/** 事実の直書きチェックで対象外にするキー（ID・ファイルパス等） */
const NON_FACT_KEYS = new Set(['id', 'photo', 'course_ids', 'file', 'logo', 'variant']);
const MIN_FACT_LENGTH = 4;

function section(no: number, title: string): CheckSection {
  return { no, title, errors: [], warnings: [], info: [] };
}

function push(list: string[], msg: string): void {
  if (!list.includes(msg)) list.push(msg);
}

function exists(root: string, rel: string): boolean {
  try {
    return fs.existsSync(resolveInRoot(root, rel));
  } catch {
    return false;
  }
}

/** books/・company-data/・shared/ のテキストファイル（ルート相対、output/ は除く） */
function textFiles(root: string, dirs: string[]): string[] {
  const patterns = dirs.filter((d) => fs.existsSync(path.join(root, d))).map((d) => `${d}/**/*`);
  if (patterns.length === 0) return [];
  return fg
    .sync(patterns, { cwd: root, onlyFiles: true, dot: false, followSymbolicLinks: false, ignore: ['**/node_modules/**', 'books/**/output/**'] })
    .filter((f) => TEXT_EXT.has(path.extname(f).toLowerCase()))
    .sort();
}

function readText(root: string, rel: string): string | null {
  const abs = path.join(root, rel);
  try {
    if (fs.statSync(abs).size > MAX_TEXT_BYTES) return null;
    return fs.readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 1. company-data

function checkCompanyData(root: string, strict: boolean, s: CheckSection): CompanyData | null {
  let company: CompanyData | null = null;
  try {
    company = loadCompanyData(root);
  } catch (err) {
    if (err instanceof StudioError && err.issues.length > 0) {
      for (const i of err.issues) push(s.errors, i);
    } else {
      push(s.errors, errorMessage(err));
    }
  }
  // TODO（未記入）: company-data/ 以下のすべての YAML
  const base = path.join(root, 'company-data');
  const files = fs.existsSync(base) ? fg.sync('**/*.{yaml,yml}', { cwd: base, onlyFiles: true }).sort() : [];
  let total = 0;
  for (const f of files) {
    const rel = `company-data/${f}`;
    let data: unknown;
    try {
      data = readYamlFile(path.join(base, f), rel);
    } catch {
      continue; // 構文エラーは loadCompanyData 側で報告済み
    }
    const todos = collectTodos(data);
    if (todos.length === 0) continue;
    total += todos.length;
    const keys = todos.slice(0, 6).map((t) => t.path || '(値)');
    const more = todos.length > keys.length ? ` 他 ${todos.length - keys.length} 件` : '';
    push(strict ? s.errors : s.warnings, `${rel}: 未記入の "TODO" が ${todos.length} 件（${keys.join(', ')}${more}）`);
  }
  if (total > 0) s.info.push(`TODO ${total} 件${strict ? '（--strict のためエラー）' : '（--strict ではエラー）'}`);
  if (company?.brand.color_status === 'provisional') {
    push(s.warnings, 'company-data/brand/colors/colors.yaml: ブランドカラーは暫定（status: provisional）です');
  }
  if (company) s.info.push(`${company.files.length} ファイル`);
  return company;
}

// ---------------------------------------------------------------------------
// 2. BOOK の設定

interface BookState {
  book: LoadedBook;
  /** 読み込みに成功したページ（合成対象） */
  okPages: string[];
}

function checkBooks(root: string, bookIds: string[], s: CheckSection): BookState[] {
  const states: BookState[] = [];
  for (const bookId of bookIds) {
    let book: LoadedBook;
    try {
      book = loadBook(root, bookId);
    } catch (err) {
      push(s.errors, errorMessage(err));
      continue;
    }
    for (const w of book.warnings) push(s.warnings, w);
    const state: BookState = { book, okPages: [] };
    states.push(state);
    const cfg = book.config;
    if (cfg.pages.length === 0) push(s.warnings, `${book.configPath}: pages が空です`);

    for (const style of cfg.styles) {
      if (!exists(root, style)) push(s.errors, `${book.configPath}: styles のファイルがありません: ${style}`);
    }

    for (const pageId of cfg.pages) {
      try {
        const page = loadPage(root, bookId, pageId);
        for (const w of page.warnings) push(s.warnings, w);
        let ok = true;
        const bg = page.config.background;
        if (bg) {
          // ページ本文・page.css・styles での参考資料の使用は 4.（試し合成）で検出する
          if (isReferencePath(bg.image)) {
            push(s.errors, `${page.relDir}/page.yaml: 参考資料の画像を背景に使っています（${bg.image}）。参考画像は比較専用です`);
            ok = false;
          } else if (!exists(root, bg.image)) {
            push(s.errors, `${page.relDir}/page.yaml: 背景画像がありません: ${bg.image}`);
            ok = false;
          }
        }
        if (ok) state.okPages.push(pageId);
      } catch (err) {
        push(s.errors, errorMessage(err));
      }
    }

    // pages/ にあるが book.yaml に載っていないページ
    const pagesDir = path.join(book.dir, 'pages');
    if (fs.existsSync(pagesDir)) {
      for (const ent of fs.readdirSync(pagesDir, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue;
        if (!PAGE_ID_RE.test(ent.name)) push(s.warnings, `${book.relDir}/pages/${ent.name}: ページ ID の形式（page_NNN）ではありません`);
        else if (!cfg.pages.includes(ent.name)) push(s.warnings, `${book.relDir}/pages/${ent.name}: ${book.configPath} の pages に含まれていません（出力されません）`);
      }
    }

    // references.yaml
    try {
      const refs = loadReferences(root, bookId);
      if (refs) {
        for (const p of allReferencePaths(refs)) {
          if (!exists(root, p)) push(s.errors, `${book.relDir}/references.yaml: 参考資料が見つかりません: ${p}`);
          else if (!p.startsWith('references/')) push(s.warnings, `${book.relDir}/references.yaml: references/ 以外を指しています: ${p}`);
        }
        for (const key of Object.keys(refs)) {
          if (key !== 'references' && !cfg.pages.includes(key)) {
            push(s.warnings, `${book.relDir}/references.yaml: ${key} は ${book.configPath} の pages にありません`);
          }
        }
      }
    } catch (err) {
      push(s.errors, errorMessage(err));
    }
  }
  s.info.push(`BOOK ${bookIds.length} 件・ページ ${states.reduce((n, st) => n + st.book.config.pages.length, 0)} 件`);
  return states;
}

// ---------------------------------------------------------------------------
// 3. 参考資料

function checkReferences(root: string, s: CheckSection): Array<{ dir: string; source: ReferenceSource }> {
  const out: Array<{ dir: string; source: ReferenceSource }> = [];
  const refsDir = path.join(root, 'references');
  if (fs.existsSync(refsDir)) {
    // source.yaml のない references/<source>/<kind>/
    const dirs = fg.sync('*/*', { cwd: refsDir, onlyDirectories: true, dot: false }).sort();
    for (const d of dirs) {
      if (!fs.existsSync(path.join(refsDir, d, 'source.yaml'))) {
        push(s.errors, `references/${d}/source.yaml がありません（出自と forbidden_terms は必須。npm run ref:ingest で雛形を作れます）`);
      }
    }
  }
  for (const dir of listReferenceSources(root)) {
    let source: ReferenceSource;
    try {
      source = loadReferenceSource(root, dir);
    } catch (err) {
      push(s.errors, errorMessage(err));
      continue;
    }
    out.push({ dir, source });
    const [, srcName, kindName] = dir.split('/');
    if (source.source !== srcName) push(s.warnings, `${dir}/source.yaml: source "${source.source}" がディレクトリ名 "${srcName}" と一致しません`);
    if (source.kind !== kindName) push(s.warnings, `${dir}/source.yaml: kind "${source.kind}" がディレクトリ名 "${kindName}" と一致しません`);
    const terms = source.forbidden_terms.filter((t) => t.trim() !== '' && !t.startsWith('TODO'));
    if (terms.length === 0) push(s.warnings, `${dir}/source.yaml: forbidden_terms が空です（他校の学校名・固有コピーなどを必ず登録する）`);
    if (source.original && !exists(root, source.original)) push(s.errors, `${dir}/source.yaml: original のファイルがありません: ${source.original}`);
    const analysisDir = path.join(root, dir, 'analysis');
    if (fs.existsSync(analysisDir)) {
      for (const f of fg.sync('*.{yaml,yml}', { cwd: analysisDir, onlyFiles: true }).sort()) {
        const rel = `${dir}/analysis/${f}`;
        try {
          loadYamlWithSchema(path.join(analysisDir, f), AnalysisSchema, rel);
        } catch (err) {
          push(s.errors, errorMessage(err));
        }
      }
    }
  }
  s.info.push(`参考資料 ${out.length} 件`);
  return out;
}

// ---------------------------------------------------------------------------
// 4. 試し合成

function checkCompose(root: string, books: BookState[], companyOk: boolean, strict: boolean, s: CheckSection, alreadyReported: Set<string>): void {
  if (!companyOk) {
    s.info.push('company-data のエラーのため省略');
    return;
  }
  let count = 0;
  for (const { book, okPages } of books) {
    for (const pageId of okPages) {
      count++;
      try {
        const r = composePage({ root, bookId: book.id, pageId, mode: 'render' });
        for (const w of r.warnings) {
          if (alreadyReported.has(w)) continue;
          push(strict && w.includes('TODO') ? s.errors : s.warnings, w);
        }
      } catch (err) {
        push(s.errors, errorMessage(err));
      }
    }
  }
  s.info.push(`${count} ページを合成`);
}

// ---------------------------------------------------------------------------
// 5. 事実の直書き

function checkHardcodedFacts(root: string, company: CompanyData | null, s: CheckSection): void {
  if (!company) {
    s.info.push('company-data のエラーのため省略');
    return;
  }
  // 値 -> 最初に見つかったキー（全角・半角の違いで見逃さないよう NFKC で正規化して照合する）
  const facts = new Map<string, { value: string; key: string }>();
  for (const hit of walkStrings(company.facts, 'facts')) {
    const v = hit.value.trim();
    if (charLength(v) < MIN_FACT_LENGTH || v.includes('TODO')) continue;
    const keys = hit.path.split('.').filter((k) => !/^\d+$/.test(k));
    if (NON_FACT_KEYS.has(keys[keys.length - 1] ?? '')) continue;
    const norm = v.normalize('NFKC');
    if (!facts.has(norm)) facts.set(norm, { value: v, key: hit.path });
  }
  const files = fg
    .sync(['books/**/pages/*/page.html', 'books/**/components/**/*.hbs', 'shared/components/**/*.hbs'], {
      cwd: root,
      onlyFiles: true,
      ignore: ['**/node_modules/**', 'books/**/output/**'],
    })
    .sort();
  for (const rel of files) {
    const src = readText(root, rel);
    if (src == null) continue;
    const text = stripHandlebars(src).normalize('NFKC');
    for (const [norm, { value, key }] of facts) {
      const idx = text.indexOf(norm);
      if (idx < 0) continue;
      push(s.warnings, `${rel}:${lineAt(text, idx)}: 事実「${value}」が直接書かれています。{{${key}}} を使ってください`);
    }
  }
  s.info.push(`${files.length} ファイル・事実 ${facts.size} 件を照合`);
}

// ---------------------------------------------------------------------------
// 6. 禁止語

/**
 * references/<...> のパス（BOOK の references.yaml・生成記録の source_refs など）は照合から除く。
 * パスに使える文字（発行元・種別は英数字・-・_、ページ画像は page_NNN.<拡張子>）だけを伏せる。
 * 日本語の文章がパスの直後に続いても、そこから先は照合の対象に残す。
 */
export function maskReferencePaths(text: string): string {
  return text.replace(/references\/[A-Za-z0-9_.\/-]+/g, (m) => ' '.repeat(m.length));
}

function checkForbiddenTerms(root: string, sources: Array<{ dir: string; source: ReferenceSource }>, s: CheckSection): void {
  const terms: Array<{ term: string; norm: string; from: string }> = [];
  for (const { dir, source } of sources) {
    for (const t of source.forbidden_terms) {
      const term = t.trim();
      if (!term || term.startsWith('TODO')) continue;
      terms.push({ term, norm: term.normalize('NFKC'), from: `${dir}/source.yaml` });
    }
  }
  if (terms.length === 0) {
    s.info.push('禁止語の登録なし');
    return;
  }
  const files = textFiles(root, ['books', 'company-data', 'shared']);
  for (const rel of files) {
    const src = readText(root, rel);
    if (src == null) continue;
    const text = maskReferencePaths(src.normalize('NFKC'));
    for (const t of terms) {
      const idx = text.indexOf(t.norm);
      if (idx < 0) continue;
      push(s.errors, `${rel}:${lineAt(text, idx)}: 禁止語「${t.term}」が含まれています（${t.from} の forbidden_terms）`);
    }
  }
  s.info.push(`禁止語 ${terms.length} 語 × ${files.length} ファイル`);
}

// ---------------------------------------------------------------------------
// 7. 背景画像の生成記録

function checkBackgrounds(root: string, bookIds: string[], s: CheckSection): void {
  let images = 0;
  for (const bookId of bookIds) {
    const dir = path.join(root, 'books', bookId, 'backgrounds');
    if (!fs.existsSync(dir)) continue;
    const names = fs.readdirSync(dir);
    for (const name of names.sort()) {
      const rel = relFromRoot(root, path.join(dir, name));
      if (BACKGROUND_IMAGE_RE.test(name)) {
        images++;
        const record = `${name.replace(/\.[^.]+$/, '')}.prompt.yaml`;
        if (!names.includes(record)) push(s.warnings, `${rel}: 生成記録 ${record} がありません（雛形: system/templates/background.prompt.yaml）`);
      } else if (name.endsWith('.prompt.yaml')) {
        try {
          loadYamlWithSchema(path.join(dir, name), BackgroundPromptSchema, rel);
        } catch (err) {
          push(s.errors, errorMessage(err));
        }
      }
    }
  }
  s.info.push(`背景画像 ${images} 枚`);
}

// ---------------------------------------------------------------------------

export function validateStudio(root: string, opts: { strict?: boolean } = {}): ValidateReport {
  const strict = opts.strict ?? false;
  const s1 = section(1, 'company-data（スキーマ・TODO）');
  const s2 = section(2, 'BOOK の設定（book.yaml・ページ・背景・styles・references.yaml）');
  const s3 = section(3, '参考資料（source.yaml・analysis）');
  const s4 = section(4, 'ページの試し合成（テンプレート・アセット）');
  const s5 = section(5, '事実の直書き');
  const s6 = section(6, '禁止語（forbidden_terms）');
  const s7 = section(7, '背景画像の生成記録（.prompt.yaml）');

  const company = checkCompanyData(root, strict, s1);
  const bookIds = listBookIds(root);
  // config/book.yaml があるのに BOOK ID として使えない名前のディレクトリは黙って飛ばさない
  for (const dir of listInvalidBookDirs(root)) {
    push(
      s2.errors,
      `books/${dir}: BOOK ID に使えない名前です（英数字・-・_ を / で連結。config / pages / backgrounds / components / reviews / output は使えない）。このままでは検査・出力されません`,
    );
  }
  const books = checkBooks(root, bookIds, s2);
  const sources = checkReferences(root, s3);
  checkCompose(root, books, company != null, strict, s4, new Set([...s2.warnings, ...s2.errors]));
  checkHardcodedFacts(root, company, s5);
  checkForbiddenTerms(root, sources, s6);
  checkBackgrounds(root, bookIds, s7);

  const sections = [s1, s2, s3, s4, s5, s6, s7];
  return {
    root,
    strict,
    sections,
    errorCount: sections.reduce((n, x) => n + x.errors.length, 0),
    warningCount: sections.reduce((n, x) => n + x.warnings.length, 0),
  };
}

export function printReport(r: ValidateReport, io: Io): void {
  io.log(`validate: ${r.root}${r.strict ? '（--strict: TODO はエラー）' : ''}`);
  for (const s of r.sections) {
    const status = s.errors.length > 0 ? `エラー ${s.errors.length}` : 'OK';
    const warn = s.warnings.length > 0 ? `・警告 ${s.warnings.length}` : '';
    const info = s.info.length > 0 ? `（${s.info.join('、')}）` : '';
    io.log(`\n[${s.no}] ${s.title}: ${status}${warn}${info}`);
    for (const e of s.errors) io.log(`  [エラー] ${e.replace(/\n/g, '\n    ')}`);
    for (const w of s.warnings) io.log(`  [警告] ${w.replace(/\n/g, '\n    ')}`);
  }
  io.log('');
  io.log(`結果: エラー ${r.errorCount} 件・警告 ${r.warningCount} 件 → ${r.errorCount > 0 ? 'NG' : 'OK'}`);
}

export const validateCommand: Command = (argv, io: Io = consoleIo) =>
  runCommand(io, VALIDATE_USAGE, async () => {
    const { values } = parseCli(() =>
      parseArgs({
        args: argv,
        options: {
          strict: { type: 'boolean', default: false },
          root: { type: 'string' },
          help: { type: 'boolean', short: 'h', default: false },
        },
        strict: true,
      }),
    );
    if (values.help) {
      io.log(VALIDATE_USAGE);
      return 0;
    }
    const root = resolveRoot(values.root);
    const report = validateStudio(root, { strict: values.strict });
    printReport(report, io);
    return report.errorCount > 0 ? 1 : 0;
  });
