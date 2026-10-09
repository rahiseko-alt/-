// scripts テスト共通: fixture スタジオの一時コピー・出力の取り込み・CLI の起動
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command, Io } from '../lib/cli.ts';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const FIXTURE_ROOT = path.join(REPO_ROOT, 'system/fixtures/studio');

const tempDirs: string[] = [];

/** 空の一時ディレクトリ */
export function tempDir(prefix = 'scripts-test-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** fixture スタジオを一時ディレクトリへコピーする（fixture 自体は書き換えない） */
export function copyFixture(): string {
  const dir = tempDir('scripts-fixture-');
  fs.cpSync(FIXTURE_ROOT, dir, {
    recursive: true,
    filter: (src) => !/[\\/](output|reviews)([\\/]|$)/.test(path.relative(FIXTURE_ROOT, src)),
  });
  return dir;
}

/** リポジトリの company-data/ と shared/ だけを持つ一時スタジオ（books/ と references/ は空） */
export function copyRealStudio(): string {
  const dir = tempDir('scripts-real-');
  for (const d of ['company-data', 'shared']) {
    fs.cpSync(path.join(REPO_ROOT, d), path.join(dir, d), { recursive: true });
  }
  fs.mkdirSync(path.join(dir, 'books'));
  fs.mkdirSync(path.join(dir, 'references'));
  return dir;
}

export function cleanupTemp(): void {
  for (const d of tempDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
}

export function writeFile(root: string, rel: string, content: string | Buffer): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

export function readFile(root: string, rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

export function appendFile(root: string, rel: string, content: string): void {
  fs.appendFileSync(path.join(root, rel), content, 'utf8');
}

export interface RunResult {
  code: number;
  out: string;
  err: string;
  /** out + err */
  text: string;
}

/** コマンドをプロセス内で実行して出力を取り込む */
export async function run(command: Command, args: string[]): Promise<RunResult> {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { log: (m = '') => out.push(m), error: (m = '') => err.push(m) };
  const code = await command(args, io);
  const o = out.join('\n');
  const e = err.join('\n');
  return { code, out: o, err: e, text: `${o}\n${e}` };
}

/** スクリプトを別プロセス（tsx）で実行する */
export function runScript(script: string, args: string[]): RunResult {
  const tsx = path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const r = spawnSync(process.execPath, [tsx, path.join(REPO_ROOT, 'system/scripts', script), ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, INIT_CWD: REPO_ROOT },
    timeout: 60_000,
  });
  const out = r.stdout ?? '';
  const err = r.stderr ?? '';
  return { code: r.status ?? -1, out, err, text: `${out}\n${err}` };
}

/**
 * 一時リポジトリで git を動かすための環境変数。利用者・システムの設定、除外ファイル、属性ファイルを読まず、
 * 親の git（フックなど）から渡る GIT_DIR・GIT_INDEX_FILE なども引き継がない。
 * - 全体設定（~/.gitconfig）・システム設定（/etc/gitconfig）: GIT_CONFIG_GLOBAL・GIT_CONFIG_NOSYSTEM
 * - システムの属性ファイル（/etc/gitattributes）: GIT_ATTR_NOSYSTEM
 * - 既定の除外ファイル・属性ファイル（~/.config/git/ignore・~/.config/git/attributes）: 設定がなくても読まれるので、
 *   コマンドラインの -c と同じ扱いの GIT_CONFIG_COUNT で core.excludesFile・core.attributesFile を空にする（git 2.31 以降）
 */
export function isolatedGitEnv(): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  return {
    ...env,
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_ATTR_NOSYSTEM: '1',
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'core.excludesFile',
    GIT_CONFIG_VALUE_0: os.devNull,
    GIT_CONFIG_KEY_1: 'core.attributesFile',
    GIT_CONFIG_VALUE_1: os.devNull,
  };
}

/** git が使えるか */
export const HAS_GIT = spawnSync('git', ['--version'], { stdio: 'ignore' }).status === 0;

/**
 * リポジトリの .gitattributes で filter=lfs になる（git add で LFS に入り、checkout で実体に戻る）パス。
 * .gitattributes だけを入れた一時リポジトリで、大文字小文字を区別する checkout（Linux。ignoreCase: true なら区別しない macOS・Windows）として判定する
 */
export function lfsFilteredByRepoAttributes(paths: string[], ignoreCase = false): string[] {
  if (paths.length === 0) return [];
  const repo = tempDir('git-attr-');
  const git = (args: string[], input?: string): string => {
    const r = spawnSync('git', args, { cwd: repo, env: isolatedGitEnv(), input, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} が失敗しました: ${r.stderr}`);
    return r.stdout;
  };
  git(['init', '-q']);
  fs.copyFileSync(path.join(REPO_ROOT, '.gitattributes'), path.join(repo, '.gitattributes'));
  // 出力は "<path>\0filter\0<値>\0" の繰り返し
  const out = git(['-c', `core.ignoreCase=${ignoreCase}`, 'check-attr', '-z', '--stdin', 'filter'], `${paths.join('\0')}\0`).split('\0');
  const filtered: string[] = [];
  for (let i = 0; i + 2 < out.length; i += 3) if (out[i + 2] === 'lfs') filtered.push(out[i] ?? '');
  return filtered;
}

/** pdfinfo の出力（ページ数・ページサイズ pt） */
export function pdfInfo(file: string): { pages: number; width: number; height: number } {
  const r = spawnSync('pdfinfo', [file], { encoding: 'utf8' });
  if (r.error) throw new Error(`pdfinfo を実行できません（${r.error.message}）。poppler-utils が必要です: bash system/scripts/setup.sh または npm run doctor で確認`);
  if (r.status !== 0) throw new Error(`pdfinfo が失敗しました: ${r.stderr}`);
  const pages = Number(/^Pages:\s+(\d+)/m.exec(r.stdout)?.[1]);
  const m = /^Page size:\s+([\d.]+) x ([\d.]+) pts/m.exec(r.stdout);
  return { pages, width: Number(m?.[1]), height: Number(m?.[2]) };
}
