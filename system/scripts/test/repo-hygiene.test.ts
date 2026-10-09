// リポジトリの衛生: 次のコミットに入るもの（インデックス）と、git add -A で入るもの（除外されない未追跡ファイル）を確かめる
//   - シンボリックリンクを入れない（PR #15〜#18 に worktree に張った node_modules へのリンクが入り、
//     main を checkout した環境の node_modules が壊れた。PR #19 で修正）
//   - LFS 対象（system/rules/git-workflow.md §4 の拡張子。大文字小文字を問わない。.gitattributes の filter=lfs も）は
//     ファイルの中身ではなく LFS のポインタで入れる（git lfs ls-files に載る状態）
// GitHub Actions の CI はないので、commit 前の npm run check で止める。
// このリポジトリの検査は Git の作業ツリーでだけ行う（tarball など .git がない環境・git がない環境では skip）
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isolatedGitEnv, REPO_ROOT } from './helpers.ts';

/** LFS で管理する拡張子（.gitattributes・system/rules/git-workflow.md §4） */
const LFS_EXTENSIONS = ['png', 'jpg', 'jpeg', 'pdf', 'webp', 'tif', 'tiff', 'psd', 'ai'];
const LFS_EXT_RE = new RegExp(`\\.(?:${LFS_EXTENSIONS.join('|')})$`, 'i');
const SYMLINK_MODE = '120000';
/** サブモジュール（ほかのリポジトリのコミットを指す） */
const GITLINK_MODE = '160000';
/** LFS のポインタは 1024 バイト未満のテキスト（git-lfs の docs/spec.md） */
const POINTER_MAX_BYTES = 1024;

type Git = (args: string[], input?: string | Buffer) => Buffer;

function gitAt(cwd: string, env: NodeJS.ProcessEnv = process.env): Git {
  return (args, input) => execFileSync('git', args, { cwd, env, input, maxBuffer: 1 << 30, stdio: ['pipe', 'pipe', 'pipe'] });
}

function nulList(buf: Buffer): string[] {
  return buf.toString('utf8').split('\0').filter(Boolean);
}

interface IndexEntry {
  mode: string;
  sha: string;
  path: string;
}

/** インデックス（HEAD + ステージした変更 = 次のコミットに入るもの） */
function indexEntries(git: Git): IndexEntry[] {
  return nulList(git(['ls-files', '-s', '-z'])).map((rec) => {
    // "<mode> <sha> <stage>\t<path>"
    const tab = rec.indexOf('\t');
    const [mode = '', sha = ''] = rec.slice(0, tab).split(' ');
    return { mode, sha, path: rec.slice(tab + 1) };
  });
}

/** 除外されない未追跡ファイル（git add -A で追加されるもの。ディレクトリへのリンクはリンクそのもの 1 件） */
function untrackedFiles(git: Git): string[] {
  return nulList(git(['ls-files', '--others', '--exclude-standard', '-z']));
}

/** .gitattributes で filter=lfs になるパス */
function lfsFiltered(git: Git, paths: string[]): Set<string> {
  if (paths.length === 0) return new Set();
  // 出力は "<path>\0filter\0<値>\0" の繰り返し
  const out = nulList(git(['check-attr', '-z', '--stdin', 'filter'], `${paths.join('\0')}\0`));
  const filtered = new Set<string>();
  for (let i = 0; i + 2 < out.length; i += 3) {
    if (out[i + 2] === 'lfs') filtered.add(out[i] ?? '');
  }
  return filtered;
}

function isLfsPointer(text: string): boolean {
  return text.startsWith('version https://git-lfs.github.com/spec/v1\n') && /^oid sha256:[0-9a-f]{64}$/m.test(text) && /^size \d+$/m.test(text);
}

/** blob の中身（POINTER_MAX_BYTES 以上のものは読まずに null） */
function smallBlobs(git: Git, shas: string[]): Map<string, string | null> {
  const result = new Map<string, string | null>();
  const unique = [...new Set(shas)];
  if (unique.length === 0) return result;
  const small: string[] = [];
  for (const line of git(['cat-file', '--batch-check=%(objectname) %(objectsize)'], `${unique.join('\n')}\n`).toString('utf8').split('\n')) {
    const [sha = '', size] = line.split(' ');
    if (!sha) continue;
    const n = Number(size);
    if (Number.isFinite(n) && n < POINTER_MAX_BYTES) small.push(sha);
    else result.set(sha, null);
  }
  if (small.length === 0) return result;
  // 出力は "<sha> <type> <size>\n<中身>\n" の繰り返し
  const out = git(['cat-file', '--batch'], `${small.join('\n')}\n`);
  let pos = 0;
  while (pos < out.length) {
    const eol = out.indexOf(0x0a, pos);
    const [sha = '', , size = '0'] = out.subarray(pos, eol).toString('utf8').split(' ');
    const start = eol + 1;
    const end = start + Number(size);
    result.set(sha, out.subarray(start, end).toString('utf8'));
    pos = end + 1;
  }
  return result;
}

const OUTSIDE_RULES = '.gitattributes の LFS の規則に合わない。拡張子が大文字なら小文字にする';

// ---------- 検査（問題のあるパスを返す。空なら問題なし） ----------

/** 追跡している（インデックスにある）シンボリックリンク */
function trackedSymlinks(git: Git): string[] {
  return indexEntries(git).filter((e) => e.mode === SYMLINK_MODE).map((e) => e.path);
}

/** git add -A で追加されてしまうシンボリックリンク（除外されない未追跡のリンク） */
function untrackedSymlinks(git: Git, root: string): string[] {
  return untrackedFiles(git).filter((rel) => fs.lstatSync(path.join(root, rel), { throwIfNoEntry: false })?.isSymbolicLink());
}

/**
 * LFS 対象（拡張子は大文字小文字を問わない。.gitattributes で filter=lfs のものも）なのに、LFS で管理されていない追跡ファイル（理由付き）。
 * LFS で管理されているとは、.gitattributes で filter=lfs になり（checkout で実体に戻る）、インデックスの中身が LFS のポインタであること
 */
function trackedOutsideLfs(git: Git): string[] {
  const files = indexEntries(git).filter((e) => e.mode !== SYMLINK_MODE && e.mode !== GITLINK_MODE);
  const filtered = lfsFiltered(git, files.map((e) => e.path));
  const targets = files.filter((e) => LFS_EXT_RE.test(e.path) || filtered.has(e.path));
  const blobs = smallBlobs(git, targets.map((e) => e.sha));
  return targets.flatMap((e) => {
    if (!filtered.has(e.path)) return [`${e.path}（${OUTSIDE_RULES}）`];
    if (!isLfsPointer(blobs.get(e.sha) ?? '')) return [`${e.path}（LFS のポインタではなく、中身がそのまま入っている）`];
    return [];
  });
}

/** git add すると LFS に入らない、LFS 対象の未追跡ファイル（理由付き） */
function untrackedOutsideLfs(git: Git, root: string): string[] {
  const targets = untrackedFiles(git).filter((rel) => LFS_EXT_RE.test(rel) && fs.lstatSync(path.join(root, rel), { throwIfNoEntry: false })?.isFile());
  if (targets.length === 0) return [];
  const filtered = lfsFiltered(git, targets);
  const configured = ['filter.lfs.process', 'filter.lfs.clean'].some((key) => {
    try {
      return git(['config', '--get', key]).toString('utf8').trim() !== '';
    } catch {
      return false;
    }
  });
  return targets.flatMap((rel) => {
    if (!filtered.has(rel)) return [`${rel}（${OUTSIDE_RULES}）`];
    if (!configured) return [`${rel}（Git LFS のフィルタが未設定。git lfs install --local を実行する）`];
    return [];
  });
}

// ---------- このリポジトリ ----------

const HAS_GIT = spawnSync('git', ['--version'], { stdio: 'ignore' }).status === 0;

/** REPO_ROOT が Git の作業ツリーの最上位か（tarball を別のリポジトリの中に展開した場合などは false） */
function isWorkTreeRoot(): boolean {
  if (!HAS_GIT) return false;
  try {
    const top = gitAt(REPO_ROOT)(['rev-parse', '--show-toplevel']).toString('utf8').trim();
    return fs.realpathSync(top) === fs.realpathSync(REPO_ROOT);
  } catch {
    return false;
  }
}

describe.skipIf(!isWorkTreeRoot())('このリポジトリの追跡ファイル（Git の作業ツリーでのみ）', () => {
  const git = gitAt(REPO_ROOT);

  it('シンボリックリンクを追跡していない', () => {
    expect(
      trackedSymlinks(git),
      'シンボリックリンクがインデックスにあります。git rm --cached <パス> で外し、作業ツリーに張るリンクなら .gitignore に末尾の / なしで追加する（system/rules/git-workflow.md §5）',
    ).toEqual([]);
  });

  it('git add -A で追加されるシンボリックリンクがない', () => {
    expect(
      untrackedSymlinks(git, REPO_ROOT),
      '除外されていないシンボリックリンクがあります（git add -A でコミットされる）。リンクを消すか、.gitignore（末尾の / なし）か .git/info/exclude に追加する',
    ).toEqual([]);
  });

  it('LFS 対象の追跡ファイルはすべて LFS のポインタ（git lfs ls-files に載る）', () => {
    expect(
      trackedOutsideLfs(git),
      'LFS で管理されていない画像・PDF がインデックスにあります。拡張子が大文字なら小文字に直し、git lfs install --local の後、git rm --cached <パス> → git add <パス> でやり直す（system/rules/git-workflow.md §4、naming.md）',
    ).toEqual([]);
  });

  it('LFS 対象の未追跡ファイルは git add で LFS に入る', () => {
    expect(untrackedOutsideLfs(git, REPO_ROOT), 'このまま git add すると LFS に入らない画像・PDF があります（system/rules/git-workflow.md §4）').toEqual([]);
  });
});

// ---------- 検査そのもの（一時リポジトリ） ----------

const tempDirs: string[] = [];
afterEach(() => {
  for (const d of tempDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** リポジトリの .gitattributes と .gitignore を入れた一時リポジトリ（利用者の設定・親の git の環境変数の影響を受けない） */
function tempRepo(): { root: string; git: Git } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-hygiene-'));
  tempDirs.push(root);
  const git = gitAt(root, isolatedGitEnv());
  git(['init', '-q']);
  git(['config', 'core.excludesFile', os.devNull]);
  for (const f of ['.gitattributes', '.gitignore']) fs.copyFileSync(path.join(REPO_ROOT, f), path.join(root, f));
  git(['add', '.gitattributes', '.gitignore']);
  return { root, git };
}

/** 作業ツリーを通さずにインデックスへ直接入れる（LFS のフィルタを使わない） */
function stage(git: Git, mode: string, rel: string, content: string | Buffer): void {
  const blob = git(['hash-object', '-w', '--stdin'], content).toString('utf8').trim();
  git(['update-index', '--add', '--cacheinfo', `${mode},${blob},${rel}`]);
}

const POINTER = `version https://git-lfs.github.com/spec/v1\noid sha256:${'a'.repeat(64)}\nsize 2048\n`;

describe.skipIf(!HAS_GIT)('衛生の検査（一時リポジトリ）', () => {
  it('.gitattributes は LFS の拡張子すべてを LFS で扱う（小文字の拡張子）', () => {
    const { git } = tempRepo();
    const paths = LFS_EXTENSIONS.map((ext) => `books/x/backgrounds/bg.${ext}`);
    expect([...lfsFiltered(git, paths)].sort()).toEqual([...paths].sort());
  });

  it('インデックスのシンボリックリンクを見つける（node_modules・.vite など）', () => {
    const { git } = tempRepo();
    expect(trackedSymlinks(git)).toEqual([]);
    stage(git, SYMLINK_MODE, 'node_modules', '/home/user/dtp/node_modules');
    stage(git, SYMLINK_MODE, 'books/x/assets/link.svg', '../../../references/a/page_001.svg');
    stage(git, '100644', 'books/x/config/book.yaml', 'id: x\n');
    expect(trackedSymlinks(git).sort()).toEqual(['books/x/assets/link.svg', 'node_modules']);
  });

  it('除外されない未追跡のシンボリックリンクを見つけ、.gitignore で除外されるリンクは数えない', () => {
    const { root, git } = tempRepo();
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-hygiene-target-'));
    tempDirs.push(target);
    for (const rel of ['node_modules', '.cache', '.vite', 'link-to-dir', 'books/x/link.svg']) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.symlinkSync(target, path.join(root, rel));
    }
    fs.writeFileSync(path.join(root, 'books/x/page.html'), '<p></p>\n');
    expect(untrackedSymlinks(git, root).sort()).toEqual(['books/x/link.svg', 'link-to-dir']);
  });

  it('LFS で管理されていない LFS 対象の追跡ファイルを見つける（拡張子の大文字小文字を問わない）', () => {
    const { git } = tempRepo();
    const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    stage(git, '100644', 'books/x/backgrounds/ok.png', POINTER);
    stage(git, '100644', 'company-data/photos/ok.jpg', POINTER);
    stage(git, '100644', 'books/x/backgrounds/raw.png', binary);
    stage(git, '100644', 'company-data/photos/IMG_0001.JPG', binary);
    stage(git, '100644', 'company-data/photos/upper.PNG', POINTER);
    stage(git, '100644', 'references/a/doc.pdf', Buffer.alloc(4096, 0x25));
    stage(git, '100644', 'books/x/backgrounds/bg.prompt.yaml', 'prompt: x\n');
    stage(git, '100644', 'books/x/backgrounds/text.png', 'version https://git-lfs.github.com/spec/v1\n');
    expect(trackedOutsideLfs(git)).toEqual([
      'books/x/backgrounds/raw.png（LFS のポインタではなく、中身がそのまま入っている）',
      'books/x/backgrounds/text.png（LFS のポインタではなく、中身がそのまま入っている）',
      // 大文字の拡張子は .gitattributes の規則に合わないので、ポインタで入れても checkout で実体に戻らない
      'company-data/photos/IMG_0001.JPG（.gitattributes の LFS の規則に合わない。拡張子が大文字なら小文字にする）',
      'company-data/photos/upper.PNG（.gitattributes の LFS の規則に合わない。拡張子が大文字なら小文字にする）',
      'references/a/doc.pdf（LFS のポインタではなく、中身がそのまま入っている）',
    ]);
  });

  it('git add しても LFS に入らない未追跡ファイル（大文字の拡張子・LFS のフィルタ未設定）を見つける', () => {
    const { root, git } = tempRepo();
    for (const rel of ['books/x/backgrounds/bg.png', 'company-data/photos/IMG_0001.JPG', 'books/x/notes.txt', '.cache/ref-prep/p.png']) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), 'x');
    }
    // フィルタ未設定（git-lfs がない・git lfs install をしていない）なら、小文字の拡張子でも LFS に入らない
    expect(untrackedOutsideLfs(git, root)).toEqual([
      'books/x/backgrounds/bg.png（Git LFS のフィルタが未設定。git lfs install --local を実行する）',
      'company-data/photos/IMG_0001.JPG（.gitattributes の LFS の規則に合わない。拡張子が大文字なら小文字にする）',
    ]);
    git(['config', 'filter.lfs.process', 'git-lfs filter-process']);
    expect(untrackedOutsideLfs(git, root)).toEqual(['company-data/photos/IMG_0001.JPG（.gitattributes の LFS の規則に合わない。拡張子が大文字なら小文字にする）']);
  });
});
