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

/** pdfinfo の出力（ページ数・ページサイズ pt） */
export function pdfInfo(file: string): { pages: number; width: number; height: number } {
  const r = spawnSync('pdfinfo', [file], { encoding: 'utf8' });
  if (r.error) throw new Error(`pdfinfo を実行できません（${r.error.message}）。poppler-utils が必要です: bash system/scripts/setup.sh または npm run doctor で確認`);
  if (r.status !== 0) throw new Error(`pdfinfo が失敗しました: ${r.stderr}`);
  const pages = Number(/^Pages:\s+(\d+)/m.exec(r.stdout)?.[1]);
  const m = /^Page size:\s+([\d.]+) x ([\d.]+) pts/m.exec(r.stdout);
  return { pages, width: Number(m?.[1]), height: Number(m?.[2]) };
}
