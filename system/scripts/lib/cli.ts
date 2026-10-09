// CLI 共通: 引数解析のエラー変換・入出力・エラー表示・終了コード・パス表示
import fs from 'node:fs';
import path from 'node:path';
import { StudioError, isInside, relFromRoot, resolveStudioRoot } from '../../design-engine/src/index.ts';

/** 出力先（テストでは差し替える） */
export interface Io {
  /** 通常の出力（stdout） */
  log(message?: string): void;
  /** エラー・警告（stderr） */
  error(message?: string): void;
}

export const consoleIo: Io = {
  log: (m = '') => console.log(m),
  error: (m = '') => console.error(m),
};

/** 利用者側の誤り（引数・入力ファイルなど）。スタックトレースを出さずにメッセージだけ表示する */
export class CliError extends Error {
  readonly hint?: string;
  constructor(message: string, hint?: string) {
    super(message);
    this.name = 'CliError';
    this.hint = hint;
  }
}

/** 引数の誤り（使い方を併せて表示する） */
export class UsageError extends CliError {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

/** CLI コマンド: 引数を受け取り終了コード（0 = 成功 / 1 = 失敗）を返す */
export type Command = (argv: string[], io?: Io) => Promise<number>;

/** node:util parseArgs の例外を日本語の UsageError に変換して実行する */
export function parseCli<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    const e = err as { code?: string; message?: string };
    const msg = String(e.message ?? err);
    const opt = /'(-{1,2}[^'\s]+)/.exec(msg)?.[1];
    switch (e.code) {
      case 'ERR_PARSE_ARGS_UNKNOWN_OPTION':
        throw new UsageError(`不明なオプションです: ${opt ?? msg}`);
      case 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE':
        throw new UsageError(
          opt ? `オプション ${opt.split(' ')[0]} の値が正しくありません（値が必要なオプションに値がない、または値を取らないオプションに値がある）` : `オプションの値が正しくありません（${msg}）`,
        );
      case 'ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL': {
        const arg = /'([^']+)'/.exec(msg)?.[1];
        throw new UsageError(`余分な引数があります: ${arg ?? msg}`);
      }
      default:
        throw new UsageError(msg);
    }
  }
}

/** コマンド本体を実行し、例外を日本語のエラー表示と終了コード 1 に変換する */
export async function runCommand(io: Io, usage: string, body: () => Promise<number>): Promise<number> {
  try {
    return await body();
  } catch (err) {
    return reportError(io, err, usage);
  }
}

export function reportError(io: Io, err: unknown, usage?: string): number {
  if (err instanceof UsageError) {
    io.error(`エラー: ${err.message}`);
    if (usage) io.error(`\n${usage}`);
  } else if (err instanceof CliError) {
    io.error(`エラー: ${err.message}`);
    if (err.hint) io.error(`  対処: ${err.hint}`);
  } else if (err instanceof StudioError) {
    io.error(`エラー: ${err.message}`);
  } else {
    const e = err as Error;
    io.error(`予期しないエラーが発生しました: ${e?.stack ?? String(err)}`);
  }
  return 1;
}

/** スクリプトのエントリポイント: process.argv を渡して終了コードを設定する */
export async function runMain(command: Command): Promise<void> {
  // `| head` などで出力先が閉じられても異常終了しない
  for (const stream of [process.stdout, process.stderr]) {
    stream.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EPIPE') process.exit(typeof process.exitCode === 'number' ? process.exitCode : 0);
      throw err;
    });
  }
  process.exitCode = await command(process.argv.slice(2), consoleIo);
}

/** 利用者がコマンドを実行したディレクトリ（npm run では INIT_CWD、それ以外は cwd） */
export function invocationCwd(): string {
  const init = process.env.INIT_CWD;
  return init && fs.existsSync(init) ? init : process.cwd();
}

/** コマンドラインで受け取ったパス（実行ディレクトリ基準）を絶対パスにする */
export function userPath(p: string): string {
  return path.resolve(invocationCwd(), p);
}

/**
 * 案内に書くパスを、そのままコマンドラインの引数に渡せる形にする（userPath の逆）。
 * 実行ディレクトリの中なら相対パス、外（上位を含む）なら絶対パス。空白などを含めば単引用符で囲む。
 * show() はルート相対の表示用なので、ルート以外で実行すると引数としては別の場所を指す
 */
export function argPath(abs: string): string {
  const cwd = invocationCwd();
  const p = isInside(cwd, abs) ? path.relative(cwd, abs) || '.' : abs;
  return /^[\w@%+=:,./-]+$/.test(p) ? p : `'${p.replaceAll("'", `'\\''`)}'`;
}

/** --root（省略時はリポジトリルート）を絶対パスに解決する */
export function resolveRoot(rootArg?: string): string {
  return resolveStudioRoot(rootArg ? userPath(rootArg) : undefined);
}

/** 表示用パス（ルート内ならルート相対、外なら絶対パス） */
export function show(root: string, abs: string): string {
  return isInside(root, abs) ? relFromRoot(root, abs) || '.' : abs;
}

/** 正の数（--dpi 等）を検証して返す */
export function parsePositiveNumber(name: string, raw: string | undefined, opts: { integer?: boolean; max?: number } = {}): number | undefined {
  if (raw == null) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || (opts.integer && !Number.isInteger(n))) {
    throw new UsageError(`${name} には${opts.integer ? '正の整数' : '正の数'}を指定してください（"${raw}"）`);
  }
  if (opts.max != null && n > opts.max) throw new UsageError(`${name} は ${opts.max} 以下で指定してください（"${raw}"）`);
  return n;
}

/** 列挙値を検証して返す */
export function parseChoice<T extends string>(name: string, raw: string, choices: readonly T[]): T {
  if (!(choices as readonly string[]).includes(raw)) {
    throw new UsageError(`${name} は ${choices.join(' | ')} のいずれかです（"${raw}"）`);
  }
  return raw as T;
}

/** --page a --page b,c のような複数指定を配列にする（カンマ区切りも可・重複除去） */
export function splitList(values: string[] | undefined): string[] {
  const out: string[] = [];
  for (const v of values ?? []) {
    for (const part of v.split(',')) {
      const s = part.trim();
      if (s && !out.includes(s)) out.push(s);
    }
  }
  return out;
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/** YYYY-MM-DD（ローカル時刻） */
export function formatDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** YYYYMMDD-HHmmss（ローカル時刻） */
export function formatStamp(d: Date = new Date()): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** ISO 8601（ローカル時刻 + オフセット。例: 2026-10-07T14:30:12+09:00） */
export function formatIsoLocal(d: Date = new Date()): string {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return (
    `${formatDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** 経過秒（表示用） */
export function elapsed(start: number): string {
  return `${((Date.now() - start) / 1000).toFixed(1)} 秒`;
}

/** 数字を含む名前の自然順比較（page2 < page10） */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, 'ja', { numeric: true, sensitivity: 'base' }) || (a < b ? -1 : a > b ? 1 : 0);
}

/** 先頭行だけ（Playwright 等の長いエラーメッセージ用） */
export function firstLine(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.split('\n')[0] ?? msg;
}
