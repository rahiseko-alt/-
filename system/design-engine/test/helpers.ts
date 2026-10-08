// テスト共通: fixture スタジオの場所と一時コピー
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const FIXTURE_ROOT = path.join(REPO_ROOT, 'system/fixtures/studio');

const tempDirs: string[] = [];

/** fixture スタジオを OS の一時ディレクトリへコピーして返す（書き換えテスト用） */
export function copyFixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-fixture-'));
  fs.cpSync(FIXTURE_ROOT, dir, {
    recursive: true,
    filter: (src) => !/[\\/](output|reviews)([\\/]|$)/.test(path.relative(FIXTURE_ROOT, src)),
  });
  tempDirs.push(dir);
  return dir;
}

/** 空の一時ディレクトリ */
export function tempDir(prefix = 'studio-test-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

export function cleanupTemp(): void {
  for (const d of tempDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
}

export function writeFile(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

export function readFile(root: string, rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}
