// Handlebars テンプレート環境（compose ごとに独立したインスタンスを作る）
// 厳格モード: 存在しないキーの参照は TemplateError（BOOK・ページ・キー名つき）になる。
// - {{facts.x}} などの出力、ヘルパー引数、ハッシュ値、{{#each}} 等の引数はすべて厳格
// - {{#if x}} / {{#unless x}} の第 1 引数だけは「無ければ偽」として扱う（任意項目の分岐用）
import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import Handlebars from 'handlebars';
import QRCode from 'qrcode';
import { StudioError, TemplateError, errorMessage } from './errors.ts';
import type { CompanyData } from './load.ts';
import { bookRelDir, resolveInRoot } from './paths.ts';
import { isReferencePath } from './reference-guard.ts';

export type HandlebarsEnv = typeof Handlebars;
type TemplateFn = (context: unknown, options?: Record<string, unknown>) => string;

export const HELPER_NAMES = ['asset', 'photo', 'qr', 'num', 'nl2br', 'eq', 'join'] as const;

export interface TemplateEnvOptions {
  /** スタジオのルート（絶対パス） */
  root: string;
  bookId: string;
  company: CompanyData;
  /** 警告の出力先（qr に TODO が含まれる等） */
  warnings?: string[];
}

export interface RenderInfo {
  /** テンプレートファイル（ルート相対、エラー表示用） */
  file: string;
  page?: string;
}

export interface TemplateEnv {
  readonly hbs: HandlebarsEnv;
  /** 登録済みパーシャル名（例: "stat-card", "cards/photo-card", "book/badge"） */
  readonly partials: string[];
  /** テンプレートを厳格モードで描画する。エラーは TemplateError */
  render(source: string, context: unknown, info: RenderInfo): string;
}

// ---------------------------------------------------------------------------
// 厳格コンパイラ

interface AstNode {
  type: string;
  [key: string]: unknown;
}

const LENIENT_CONDITION_HELPERS = new Set(['if', 'unless']);

/** AST のヘルパー引数・ハッシュ値のパスに strict フラグを付ける（if/unless の第 1 引数は除く） */
function markStrictParams(node: unknown): void {
  if (!node || typeof node !== 'object') return;
  const n = node as AstNode;
  if (n.type === 'Program') {
    for (const child of (n.body as unknown[]) ?? []) markStrictParams(child);
    return;
  }
  const p = n.path as AstNode | undefined;
  const lenientFirst =
    (n.type === 'BlockStatement' || n.type === 'MustacheStatement' || n.type === 'SubExpression') &&
    p?.type === 'PathExpression' &&
    LENIENT_CONDITION_HELPERS.has(String(p.original));
  const params = (n.params as AstNode[] | undefined) ?? [];
  params.forEach((param, i) => {
    if (param.type === 'PathExpression') {
      if (!(lenientFirst && i === 0)) param.strict = true;
    } else {
      markStrictParams(param);
    }
  });
  const hash = n.hash as { pairs?: Array<{ value: AstNode }> } | undefined;
  for (const pair of hash?.pairs ?? []) {
    if (pair.value.type === 'PathExpression') pair.value.strict = true;
    else markStrictParams(pair.value);
  }
  if (n.program) markStrictParams(n.program);
  if (n.inverse) markStrictParams(n.inverse);
}

/**
 * Handlebars のコンパイラを差し替える。
 * - 中間パスが undefined でも TypeError にせず、末端の strict チェックでキー名付きエラーにする
 * - ブロックパラメータ（as |x|）経由の参照にも strict を適用する
 */
function installStrictCompilers(hbs: HandlebarsEnv): void {
  // 型定義に含まれない内部 API のため any で扱う
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const internals = hbs as any;
  const BaseCompiler = internals.Compiler;
  const BaseJsCompiler = internals.JavaScriptCompiler;

  class StrictCompiler extends BaseCompiler {
    PathExpression(pathNode: { strict?: boolean }) {
      super.PathExpression(pathNode);
      const ops = (this as unknown as { opcodes: Array<{ opcode: string; args: unknown[] }> }).opcodes;
      const last = ops[ops.length - 1];
      if (last && last.opcode === 'lookupBlockParam') last.args.push(Boolean(pathNode.strict));
    }
  }
  StrictCompiler.prototype.compiler = StrictCompiler;

  class StrictJsCompiler extends BaseJsCompiler {
    /**
     * 末端の厳格チェック（container.strict）は `name in obj` を使うため、親が文字列・数値だと TypeError になる。
     * 親をオブジェクトに包んでから渡し、「キーが存在しない」エラー（位置付き）として扱えるようにする。
     */
    aliasable(name: string) {
      if (name === 'container.strict') {
        return super.aliasable('(function (o, n, l) { return container.strict(o == null ? o : Object(o), n, l); })');
      }
      return super.aliasable(name);
    }
    nameLookup(parent: unknown, name: string, type: string) {
      if (type === 'context' || type === 'data') {
        return this.internalNameLookup(['(', parent, ' || {})'], name);
      }
      return super.nameLookup(parent, name, type);
    }
    lookupBlockParam(blockParamId: [number, number], parts: string[], strict?: boolean) {
      this.useBlockParams = true;
      this.push(['blockParams[', blockParamId[0], '][', blockParamId[1], ']']);
      this.resolvePath('context', parts, 1, false, strict);
    }
  }
  StrictJsCompiler.prototype.compiler = StrictJsCompiler;

  internals.Compiler = StrictCompiler;
  internals.JavaScriptCompiler = StrictJsCompiler;
}

/** ソース上の位置から式のテキストを取り出す */
function extractSource(source: string, line?: number, column?: number, endLine?: number, endColumn?: number): string | undefined {
  if (line == null || column == null) return undefined;
  const lines = source.split(/\r?\n/);
  const first = lines[line - 1];
  if (first == null) return undefined;
  if (endLine == null || endColumn == null || endLine === line) {
    const text = first.slice(column, endColumn ?? undefined).trim();
    return text || undefined;
  }
  const parts = [first.slice(column), ...lines.slice(line, endLine - 1), (lines[endLine - 1] ?? '').slice(0, endColumn)];
  return parts.join(' ').replace(/\s+/g, ' ').trim() || undefined;
}

/** 行・列（列は 0 始まり）から文字位置へ */
function offsetOf(source: string, line: number, column: number): number {
  const lines = source.split('\n');
  let offset = 0;
  for (let i = 0; i < line - 1 && i < lines.length; i++) offset += (lines[i] ?? '').length + 1;
  return offset + column;
}

/**
 * 見つからなかった名前が「ヘルパー呼び出しの名前部分」（{{shout x}} の shout）か。
 * - パスが 1 セグメント（"."・"/"・"@" を含まない）で、
 * - 直前が "{{" "{{#" "{{{" "{{~" "(" など式の先頭で、
 * - 直後に引数が続く
 * ときだけ true。{{qr facts.school.homepage size=22}} の facts.school.homepage のような引数はキーの欠落として扱う。
 */
function isHelperCallee(
  source: string,
  name: string,
  line: number | undefined,
  column: number | undefined,
  endLine: number | undefined,
  endColumn: number | undefined,
): boolean {
  if (line == null || column == null || endLine == null || endColumn == null) return false;
  if (!/^[A-Za-z_][\w-]*$/.test(name)) return false;
  if (extractSource(source, line, column, endLine, endColumn) !== name) return false;
  const before = source.slice(0, offsetOf(source, line, column));
  if (!/(?:\{\{\{?~?\s*[#^]?|\()\s*$/.test(before)) return false;
  const rest = (source.split(/\r?\n/)[endLine - 1] ?? '').slice(endColumn);
  return /^\s+[^\s}~)]/.test(rest);
}

/** Handlebars の例外を TemplateError に変換する（ファイル・位置・キー名を付与） */
function toTemplateError(err: unknown, source: string, file: string): TemplateError {
  if (err instanceof TemplateError) return err.withContext({ file });
  const e = (err ?? {}) as { message?: unknown; lineNumber?: number; column?: number; endLineNumber?: number; endColumn?: number };
  const raw = String(e.message ?? err).replace(/ - \d+:\d+$/, '');
  let line = typeof e.lineNumber === 'number' ? e.lineNumber : undefined;
  const column = typeof e.column === 'number' ? e.column : undefined;
  let key: string | undefined;
  let detail: string;
  let m: RegExpExecArray | null;
  if ((m = /^"([^"]*)" not defined in/.exec(raw)) && isHelperCallee(source, m[1] ?? '', line, column, e.endLineNumber, e.endColumn)) {
    // {{shout x}} のような引数付き呼び出しで名前が見つからない = 未定義のヘルパー
    detail = `未定義のヘルパー "${m[1] ?? ''}" です（使用可能: ${HELPER_NAMES.join(', ')} と Handlebars 標準ヘルパー）`;
  } else if (m) {
    key = extractSource(source, line, column, e.endLineNumber, e.endColumn) ?? m[1];
    detail =
      `キー "${key}" がデータに存在しません（"${m[1]}" が未定義）。` +
      'company-data・page.yaml・book.yaml を確認してください。任意項目なら {{#if ...}} で囲んでください';
  } else if ((m = /^The partial (.+) could not be found/.exec(raw))) {
    detail = `パーシャル "${m[1]}" が見つかりません（shared/components/**/*.hbs、または books/<id>/components/*.hbs を "book/<名前>" で参照）`;
  } else if ((m = /^Missing helper: "([^"]*)"/.exec(raw))) {
    detail = `未定義のヘルパー "${m[1]}" です（使用可能: ${HELPER_NAMES.join(', ')} と Handlebars 標準ヘルパー）`;
  } else if ((m = /^Parse error on line (\d+)/.exec(raw))) {
    line = Number(m[1]);
    detail = `構文エラー: ${raw.replace(/\n/g, ' ')}`;
  } else if (err instanceof StudioError) {
    detail = err.message;
  } else {
    detail = `描画中にエラーが発生しました: ${raw}`;
  }
  return new TemplateError({ detail, file, key, line, column, cause: err });
}

/** 厳格モードでテンプレートをコンパイルする（lazy=true なら初回呼び出しまで構文解析を遅延） */
function compileStrict(hbs: HandlebarsEnv, source: string, file: string, lazy: boolean): TemplateFn {
  let compiled: TemplateFn | null = null;
  const build = (): TemplateFn => {
    try {
      const ast = hbs.parseWithoutProcessing(source);
      markStrictParams(ast);
      compiled = hbs.compile(ast, { strict: true }) as TemplateFn;
      return compiled;
    } catch (err) {
      throw toTemplateError(err, source, file);
    }
  };
  if (!lazy) build();
  return (context, options) => {
    const fn = compiled ?? build();
    try {
      return fn(context, options);
    } catch (err) {
      throw toTemplateError(err, source, file);
    }
  };
}

// ---------------------------------------------------------------------------
// ヘルパー

interface HelperOptionsLike {
  hash?: Record<string, unknown>;
  loc?: { start?: { line?: number; column?: number } };
  name?: string;
}

function helperError(name: string, message: string, options?: HelperOptionsLike): TemplateError {
  return new TemplateError({
    detail: `${name}: ${message}`,
    line: options?.loc?.start?.line,
    column: options?.loc?.start?.column,
  });
}

/** 引数配列から末尾の options（Handlebars が必ず最後に渡す）を取り出す */
function splitArgs(args: unknown[]): { params: unknown[]; options: HelperOptionsLike } {
  const last = args[args.length - 1];
  const options = last && typeof last === 'object' && 'hash' in last ? (last as HelperOptionsLike) : {};
  return { params: args.slice(0, -1), options };
}

const numberFormat = new Intl.NumberFormat('ja-JP');

/** QR コードの周囲の余白（モジュール数）の既定・最小 */
export const QR_MIN_MARGIN = 4;

/**
 * ルート相対パスを、ページの <base> 基準で解決できる URL に変換する。
 * セグメントごとにエンコードする（ファイル名の "#" "?" "%" や、CSS の url() を壊す "(" ")" "'" もエスケープ）。
 */
export function assetUrl(relPath: string): string {
  return relPath
    .split('/')
    .map((seg) => encodeURIComponent(seg).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

function registerHelpers(hbs: HandlebarsEnv, opts: TemplateEnvOptions, warnings: string[]): void {
  const { root, company } = opts;

  const checkAsset = (name: string, p: unknown, options: HelperOptionsLike): string => {
    if (typeof p !== 'string' || p.length === 0) throw helperError(name, 'ルート相対パスの文字列を指定してください', options);
    let abs: string;
    try {
      abs = resolveInRoot(root, p);
    } catch (err) {
      throw helperError(name, errorMessage(err), options);
    }
    if (isReferencePath(p)) {
      throw helperError(name, `参考資料（references/）はページの描画に使えません: ${p}（比較・目視・画像生成の参照入力に使う。system/rules/references.md §4）`, options);
    }
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw helperError(name, `ファイルが見つかりません: ${p}`, options);
    return assetUrl(p);
  };

  hbs.registerHelper('asset', (...args: unknown[]) => {
    const { params, options } = splitArgs(args);
    return checkAsset('asset', params[0], options);
  });

  hbs.registerHelper('photo', (...args: unknown[]) => {
    const { params, options } = splitArgs(args);
    const id = params[0];
    if (typeof id !== 'string' || id.length === 0) throw helperError('photo', '写真IDを文字列で指定してください', options);
    const photo = Object.prototype.hasOwnProperty.call(company.photos, id) ? company.photos[id] : undefined;
    if (!photo) throw helperError('photo', `写真ID "${id}" が company-data/photos/photos.yaml にありません`, options);
    return checkAsset('photo', photo.file, options);
  });

  hbs.registerHelper('qr', (...args: unknown[]) => {
    const { params, options } = splitArgs(args);
    const raw = params[0];
    if (raw == null || (typeof raw !== 'string' && typeof raw !== 'number') || String(raw).length === 0) {
      throw helperError('qr', 'QR コードにする文字列を指定してください', options);
    }
    const text = String(raw);
    if (text.includes('TODO')) warnings.push(`qr: QR コードの内容に TODO が含まれています（"${text}"）`);
    const hash = options.hash ?? {};
    // 周囲の余白（クワイエットゾーン）は QR コードの規格（JIS X 0510 / ISO/IEC 18004）で 4 モジュール以上
    const margin = hash.margin == null ? QR_MIN_MARGIN : Number(hash.margin);
    if (!Number.isInteger(margin) || margin < 0) throw helperError('qr', `margin はモジュール数（0 以上の整数）で指定してください（"${String(hash.margin)}"）`, options);
    if (margin < QR_MIN_MARGIN) {
      warnings.push(`qr: margin=${margin} は QR コードの規格の余白（${QR_MIN_MARGIN} モジュール）より狭く、読み取れないことがあります`);
    }
    const ecl = String(hash.ecl ?? 'M').toUpperCase();
    if (!['L', 'M', 'Q', 'H'].includes(ecl)) throw helperError('qr', `ecl は L/M/Q/H のいずれかです（"${ecl}"）`, options);
    const dark = String(hash.dark ?? '#000000');
    const light = String(hash.light ?? '#ffffff');
    let svg = '';
    try {
      QRCode.toString(
        text,
        { type: 'svg', margin, errorCorrectionLevel: ecl as 'L' | 'M' | 'Q' | 'H', color: { dark, light } },
        (err, s) => {
          if (err) throw err;
          svg = s;
        },
      );
    } catch (err) {
      throw helperError('qr', `QR コードを生成できません（${errorMessage(err)}）`, options);
    }
    if (!svg) throw helperError('qr', 'QR コードを生成できません', options);
    let attrs = 'class="qr" role="img" aria-label="QRコード"';
    if (hash.size != null) {
      const size = Number(hash.size);
      if (!Number.isFinite(size) || size <= 0) throw helperError('qr', `size は mm 単位の正の数で指定してください（"${String(hash.size)}"）`, options);
      attrs += ` width="${size}mm" height="${size}mm" style="width:${size}mm;height:${size}mm"`;
    }
    return new hbs.SafeString(svg.trim().replace(/^<svg /, `<svg ${attrs} `));
  });

  hbs.registerHelper('num', (...args: unknown[]) => {
    const { params, options } = splitArgs(args);
    const v = params[0];
    if (v === undefined || v === null) throw helperError('num', '値が未定義です', options);
    if (typeof v === 'number' && Number.isFinite(v)) return numberFormat.format(v);
    return v;
  });

  hbs.registerHelper('nl2br', (...args: unknown[]) => {
    const { params, options } = splitArgs(args);
    const v = params[0];
    if (v === undefined || v === null) throw helperError('nl2br', '値が未定義です', options);
    const escaped = hbs.escapeExpression(String(v));
    return new hbs.SafeString(escaped.replace(/\r\n|\r|\n/g, '<br>'));
  });

  hbs.registerHelper('eq', (...args: unknown[]) => {
    const { params } = splitArgs(args);
    return params[0] === params[1];
  });

  hbs.registerHelper('join', (...args: unknown[]) => {
    const { params, options } = splitArgs(args);
    const list = params[0];
    if (!Array.isArray(list)) throw helperError('join', '配列を指定してください', options);
    const sep = params.length > 1 ? String(params[1]) : '、';
    return list.map((x) => (x == null ? '' : String(x))).join(sep);
  });
}

// ---------------------------------------------------------------------------
// パーシャル

/** パーシャル名 -> ルート相対ファイルパス */
export function discoverPartials(root: string, bookId: string): Map<string, string> {
  const out = new Map<string, string>();
  const absRoot = path.resolve(root);
  const sharedDir = path.join(absRoot, 'shared', 'components');
  if (fs.existsSync(sharedDir)) {
    for (const f of fg.sync('**/*.hbs', { cwd: sharedDir, onlyFiles: true }).sort()) {
      out.set(f.slice(0, -'.hbs'.length), `shared/components/${f}`);
    }
  }
  const bookComponents = `${bookRelDir(bookId)}/components`;
  const bookDir = path.join(absRoot, bookComponents);
  if (fs.existsSync(bookDir)) {
    for (const f of fg.sync('**/*.hbs', { cwd: bookDir, onlyFiles: true }).sort()) {
      out.set(`book/${f.slice(0, -'.hbs'.length)}`, `${bookComponents}/${f}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------

/** BOOK 用の独立した厳格 Handlebars 環境を作る（ヘルパー・パーシャル登録済み） */
export function createTemplateEnv(opts: TemplateEnvOptions): TemplateEnv {
  const hbs = Handlebars.create();
  installStrictCompilers(hbs);
  const warnings = opts.warnings ?? [];
  registerHelpers(hbs, opts, warnings);

  const partialFiles = discoverPartials(opts.root, opts.bookId);
  for (const [name, rel] of partialFiles) {
    const source = fs.readFileSync(path.join(opts.root, rel), 'utf8');
    hbs.registerPartial(name, compileStrict(hbs, source, rel, true) as unknown as Handlebars.Template);
  }

  return {
    hbs,
    partials: [...partialFiles.keys()],
    render(source, context, info) {
      try {
        const fn = compileStrict(hbs, source, info.file, false);
        return fn(context);
      } catch (err) {
        const te = err instanceof TemplateError ? err : toTemplateError(err, source, info.file);
        throw te.withContext({ book: opts.bookId, page: info.page });
      }
    },
  };
}
