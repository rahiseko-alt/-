// .gitignore: 依存・キャッシュ・ビルド出力・秘密情報を Git 管理から除外し、雛形 .env.example だけは残す。
// 除外の規則はディレクトリだけでなくシンボリックリンクにも効くこと（末尾に / を付けた規則は、
// 作業ツリーに張った node_modules などへのリンクを除外せず、git add -A でコミットさせてしまう。PR #15〜#19）。
// リポジトリの .gitignore だけを入れた一時リポジトリに実際のファイル・リンクを作り、git が未追跡として数えるかで確かめる
// （git があればよく、作業ツリーでなくても動く。利用者の全体設定・既定の除外ファイル ~/.config/git/ignore の影響も受けない）
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HAS_GIT, isolatedGitEnv, REPO_ROOT } from './helpers.ts';

/** 利用者の設定・既定の除外ファイル（~/.config/git/ignore）・親の git の環境変数の影響を受けない git */
function isolatedGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: isolatedGitEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

const tempDirs: string[] = [];

/** リポジトリの .gitignore だけを入れた一時リポジトリを作り、make で中身を作ってから、git add -A で追加される（未追跡で除外されない）パスを返す */
function untrackedAfter(make: (repo: string) => void): { repo: string; untracked: Set<string> } {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gitignore-test-'));
  tempDirs.push(repo);
  isolatedGit(repo, ['init', '-q']);
  fs.copyFileSync(path.join(REPO_ROOT, '.gitignore'), path.join(repo, '.gitignore'));
  make(repo);
  // ディレクトリへのリンクは、git から見ると 1 つのファイル（リンクそのもの）として数えられる
  const out = isolatedGit(repo, ['ls-files', '--others', '--exclude-standard', '-z']);
  return { repo, untracked: new Set(out.split('\0').filter(Boolean)) };
}

/** 除外される（git add -A で追加されない）べきファイル */
const IGNORED_FILES = [
  'node_modules/playwright/package.json',
  'system/design-engine/node_modules/pkg/index.js',
  '.cache/ref-prep/Sample/brochure/prep/page.png',
  '.vite/deps/chunk.js',
  '.build/out.js',
  'coverage/index.html',
  'npm-debug.log',
  'system/fixtures/studio/books/smoke/output/png/page_001.png',
  'system/fixtures/studio/books/smoke/reviews/page_001/review.md',
  'books/brochure/reviews/page_016/compare-20261009-120000/side-by-side.png',
  '.env',
  '.env.local',
  '.env.production',
  'system/scripts/.env',
  'secrets/api-key.json',
  'books/brochure/secrets/token.txt',
];

/** 除外されない（コミットする）べきファイル */
const KEPT_FILES = [
  '.env.example',
  'system/scripts/.env.example',
  'books/brochure/config/book.yaml',
  'books/brochure/reviews/page_016/review.md',
  'books/brochure/reviews/page_016/compare-20261009-120000/report.yaml',
  'company-data/facts/school.yaml',
  'system/fixtures/studio/books/smoke/config/book.yaml',
];

/** 作業ツリーに張るシンボリックリンク（worktree から本体の node_modules などを指す）。リンクそのものが除外されるべき */
const IGNORED_LINKS = [
  'node_modules',
  '.cache',
  '.vite',
  '.build',
  'coverage',
  'secrets',
  'system/design-engine/node_modules',
  'system/fixtures/studio/books/smoke/output',
];

describe.skipIf(!HAS_GIT)('.gitignore', () => {
  let files = { repo: '', untracked: new Set<string>() };
  let links = { repo: '', untracked: new Set<string>() };

  beforeAll(() => {
    files = untrackedAfter((repo) => {
      for (const rel of [...IGNORED_FILES, ...KEPT_FILES]) {
        fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
        fs.writeFileSync(path.join(repo, rel), 'x\n');
      }
    });
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'gitignore-target-'));
    tempDirs.push(target);
    fs.writeFileSync(path.join(target, 'index.js'), 'x\n');
    links = untrackedAfter((repo) => {
      for (const rel of IGNORED_LINKS) {
        fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
        fs.symlinkSync(target, path.join(repo, rel));
      }
      // リンク先がないリンク（壊れたリンク）も同じ
      fs.mkdirSync(path.join(repo, 'system/scripts'), { recursive: true });
      fs.symlinkSync(path.join(target, 'missing'), path.join(repo, 'system/scripts/node_modules'));
    });
  });

  afterAll(() => {
    for (const d of tempDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it.each(IGNORED_FILES)('%s は除外される', (rel) => {
    expect(fs.existsSync(path.join(files.repo, rel))).toBe(true);
    expect(files.untracked.has(rel)).toBe(false);
  });

  it.each(KEPT_FILES)('%s は除外されない', (rel) => {
    expect(files.untracked.has(rel)).toBe(true);
  });

  it('ファイルのうち git add -A で追加されるのは、除外されないものだけ', () => {
    expect([...files.untracked].sort()).toEqual(['.gitignore', ...KEPT_FILES].sort());
  });

  it.each(IGNORED_LINKS)('シンボリックリンク %s は除外される（git add -A で追加されない）', (rel) => {
    expect(fs.lstatSync(path.join(links.repo, rel)).isSymbolicLink()).toBe(true);
    expect(links.untracked.has(rel)).toBe(false);
  });

  it('リンクを張った作業ツリーで git add -A して追加されるのは .gitignore だけ', () => {
    expect([...links.untracked]).toEqual(['.gitignore']);
  });
});
