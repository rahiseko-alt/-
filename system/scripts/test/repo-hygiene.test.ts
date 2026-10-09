// リポジトリの衛生: 次のコミットに入るもの（インデックス）と、git add -A で入るもの（除外されない未追跡ファイルと、
// 作業ツリーで変わった追跡ファイル）を確かめる
//   - シンボリックリンクを入れない（PR #15〜#18 に worktree に張った node_modules へのリンクが入り、
//     main を checkout した環境の node_modules が壊れた。PR #19 で修正）
//   - LFS 対象（system/rules/git-workflow.md §4 の拡張子。大文字小文字を問わない。.gitattributes の filter=lfs も）は
//     ファイルの中身ではなく LFS のポインタで入れる（git lfs ls-files に載る状態）。.gitattributes の規則は、
//     大文字小文字を区別する checkout（Linux）でも区別しない checkout（core.ignoreCase=true。macOS・Windows の既定）でも
//     合うこと（片方でしか合わないと、macOS で LFS に入れたものが Linux でポインタのまま戻らない）
// GitHub Actions の CI はないので、commit 前の npm run check で止める。
// このリポジトリの検査は Git の作業ツリーでだけ行う（tarball など .git がない環境・git がない環境では skip）
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HAS_GIT, isolatedGitEnv, REPO_ROOT } from './helpers.ts';

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

/**
 * git add -A で追加・更新されるパス: 除外されない未追跡ファイルと、作業ツリーで変わった追跡ファイル
 * （変更・種類の変化（ファイル → リンクなど）・git add -N したもの。削除は除く）。ディレクトリへのリンクはリンクそのもの 1 件。
 * 追跡ファイルは .gitignore に合っても git add -A で更新される
 */
function pendingFiles(git: Git): string[] {
  const untracked = nulList(git(['ls-files', '--others', '--exclude-standard', '-z']));
  const changed = nulList(git(['diff', '--name-only', '--no-renames', '--diff-filter=AMT', '-z']));
  return [...new Set([...untracked, ...changed])];
}

/** .gitattributes で filter=lfs になるパス（ignoreCase: false は大文字小文字を区別する Linux の checkout、true は区別しない macOS・Windows の既定） */
function lfsFiltered(git: Git, paths: string[], ignoreCase: boolean): Set<string> {
  if (paths.length === 0) return new Set();
  // 出力は "<path>\0filter\0<値>\0" の繰り返し
  const out = nulList(git(['-c', `core.ignoreCase=${ignoreCase}`, 'check-attr', '-z', '--stdin', 'filter'], `${paths.join('\0')}\0`));
  const filtered = new Set<string>();
  for (let i = 0; i + 2 < out.length; i += 3) {
    if (out[i + 2] === 'lfs') filtered.add(out[i] ?? '');
  }
  return filtered;
}

interface LfsRules {
  /** core.ignoreCase が true でも false でも filter=lfs（どの環境でも git add で LFS に入り、checkout で実体に戻る） */
  everywhere: Set<string>;
  /** どちらかで filter=lfs（どこかの環境では git add で LFS に入る） */
  anywhere: Set<string>;
}

function lfsRules(git: Git, paths: string[]): LfsRules {
  const caseSensitive = lfsFiltered(git, paths, false);
  const caseInsensitive = lfsFiltered(git, paths, true);
  return {
    everywhere: new Set([...caseSensitive].filter((p) => caseInsensitive.has(p))),
    anywhere: new Set([...caseSensitive, ...caseInsensitive]),
  };
}

/** LFS 対象: 拡張子（大文字小文字を問わない）か、どこかの環境で .gitattributes の filter=lfs になるもの */
function isLfsTarget(rel: string, rules: LfsRules): boolean {
  return LFS_EXT_RE.test(rel) || rules.anywhere.has(rel);
}

const NO_RULE = '.gitattributes に LFS の規則がない';
const CASE_ONLY_RULE = '.gitattributes の LFS の規則に大文字小文字が合わない。macOS・Windows では LFS に入るが、Linux の checkout では実体に戻らない';

/** .gitattributes の規則に（どの環境でも）合わない理由。合えば null */
function ruleProblem(rel: string, rules: LfsRules): string | null {
  if (rules.everywhere.has(rel)) return null;
  return rules.anywhere.has(rel) ? CASE_ONLY_RULE : NO_RULE;
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

function lstat(root: string, rel: string): fs.Stats | undefined {
  return fs.lstatSync(path.join(root, rel), { throwIfNoEntry: false });
}

// ---------- 検査（問題のあるパスを返す。空なら問題なし） ----------

/** 追跡している（インデックスにある）シンボリックリンク */
function trackedSymlinks(git: Git): string[] {
  return indexEntries(git).filter((e) => e.mode === SYMLINK_MODE).map((e) => e.path);
}

/** git add -A で追加されてしまうシンボリックリンク（除外されない未追跡のリンクと、追跡中のパスをリンクに置き換えたもの） */
function pendingSymlinks(git: Git, root: string): string[] {
  return pendingFiles(git).filter((rel) => lstat(root, rel)?.isSymbolicLink());
}

/**
 * LFS 対象（拡張子は大文字小文字を問わない。.gitattributes で filter=lfs のものも）なのに、LFS で管理されていない追跡ファイル（理由付き）。
 * LFS で管理されているとは、.gitattributes でどの環境でも filter=lfs になり（checkout で実体に戻る）、インデックスの中身が LFS のポインタであること
 */
function trackedOutsideLfs(git: Git): string[] {
  const files = indexEntries(git).filter((e) => e.mode !== SYMLINK_MODE && e.mode !== GITLINK_MODE);
  const rules = lfsRules(git, files.map((e) => e.path));
  const targets = files.filter((e) => isLfsTarget(e.path, rules));
  const blobs = smallBlobs(git, targets.map((e) => e.sha));
  return targets.flatMap((e) => {
    const problem = ruleProblem(e.path, rules);
    if (problem) return [`${e.path}（${problem}）`];
    if (!isLfsPointer(blobs.get(e.sha) ?? '')) return [`${e.path}（LFS のポインタではなく、中身がそのまま入っている）`];
    return [];
  });
}

/** git add すると LFS に入らない、LFS 対象のファイル（未追跡のものと、作業ツリーで変えた追跡ファイル。理由付き） */
function pendingOutsideLfs(git: Git, root: string): string[] {
  const files = pendingFiles(git).filter((rel) => lstat(root, rel)?.isFile());
  if (files.length === 0) return [];
  const rules = lfsRules(git, files);
  const targets = files.filter((rel) => isLfsTarget(rel, rules));
  if (targets.length === 0) return [];
  const configured = ['filter.lfs.process', 'filter.lfs.clean'].some((key) => {
    try {
      return git(['config', '--get', key]).toString('utf8').trim() !== '';
    } catch {
      return false;
    }
  });
  return targets.flatMap((rel) => {
    const problem = ruleProblem(rel, rules);
    if (problem) return [`${rel}（${problem}）`];
    if (!configured) return [`${rel}（Git LFS のフィルタが未設定。git lfs install --local を実行する）`];
    return [];
  });
}

// ---------- このリポジトリ ----------

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

const RULE_FIX = '.gitattributes に拡張子の大文字小文字を問わない規則（*.[pP][nN][gG] の形）を足す';

describe.skipIf(!isWorkTreeRoot())('このリポジトリの追跡ファイル（Git の作業ツリーでのみ）', () => {
  const git = gitAt(REPO_ROOT);

  it('シンボリックリンクを追跡していない', () => {
    expect(
      trackedSymlinks(git),
      'シンボリックリンクがインデックスにあります。git rm --cached <パス> で外し、作業ツリーに張るリンクなら .gitignore に末尾の / なしで追加する（system/rules/git-workflow.md §5）',
    ).toEqual([]);
  });

  it('git add -A で追加されるシンボリックリンクがない（未追跡のリンク・追跡中のパスをリンクに置き換えたもの）', () => {
    expect(
      pendingSymlinks(git, REPO_ROOT),
      'git add -A でコミットされるシンボリックリンクがあります。追跡中のパスをリンクに置き換えたなら git checkout -- <パス> で戻す（.gitignore は追跡中のパスに効かない）。未追跡のリンクは消すか、.gitignore（末尾の / なし）か .git/info/exclude に追加する（system/rules/git-workflow.md §5）',
    ).toEqual([]);
  });

  it('LFS 対象の追跡ファイルはすべて LFS のポインタ（git lfs ls-files に載る）', () => {
    expect(
      trackedOutsideLfs(git),
      `LFS で管理されていない画像・PDF がインデックスにあります。規則がなければ ${RULE_FIX}。git lfs install --local の後、git rm --cached <パス> → git add <パス> でやり直す（system/rules/git-workflow.md §4）`,
    ).toEqual([]);
  });

  it('LFS 対象の未追跡・変更したファイルは git add で LFS に入る', () => {
    expect(
      pendingOutsideLfs(git, REPO_ROOT),
      `このまま git add すると LFS に入らない画像・PDF があります。規則がなければ ${RULE_FIX}（system/rules/git-workflow.md §4）`,
    ).toEqual([]);
  });
});

// ---------- 検査そのもの（一時リポジトリ） ----------

const tempDirs: string[] = [];
afterEach(() => {
  for (const d of tempDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** リポジトリの .gitattributes と .gitignore を入れた一時リポジトリ（利用者の設定・属性・除外ファイル、親の git の環境変数の影響を受けない） */
function tempRepo(opts: { ignoreCase?: boolean; extraAttributes?: string } = {}): { root: string; git: Git } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-hygiene-'));
  tempDirs.push(root);
  const git = gitAt(root, isolatedGitEnv());
  git(['init', '-q']);
  // macOS・Windows の git init / clone は core.ignoreCase=true を設定する
  if (opts.ignoreCase !== undefined) git(['config', 'core.ignoreCase', String(opts.ignoreCase)]);
  for (const f of ['.gitattributes', '.gitignore']) fs.copyFileSync(path.join(REPO_ROOT, f), path.join(root, f));
  if (opts.extraAttributes) fs.appendFileSync(path.join(root, '.gitattributes'), opts.extraAttributes);
  git(['add', '.gitattributes', '.gitignore']);
  return { root, git };
}

/** 作業ツリーを通さずにインデックスへ直接入れる（LFS のフィルタを使わない） */
function stage(git: Git, mode: string, rel: string, content: string | Buffer): void {
  const blob = git(['hash-object', '-w', '--stdin'], content).toString('utf8').trim();
  git(['update-index', '--add', '--cacheinfo', `${mode},${blob},${rel}`]);
}

function write(root: string, rel: string, content: string | Buffer): void {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content);
}

const POINTER = `version https://git-lfs.github.com/spec/v1\noid sha256:${'a'.repeat(64)}\nsize 2048\n`;
const BINARY = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
/** core.ignoreCase の値（Linux の既定 false と、macOS・Windows の既定 true）。結果はどちらでも同じであること */
const IGNORE_CASE = [false, true];

describe.skipIf(!HAS_GIT)('衛生の検査（一時リポジトリ）', () => {
  it.each(IGNORE_CASE)('.gitattributes は LFS の拡張子すべてを大文字小文字を問わず LFS で扱う（core.ignoreCase=%s で判定）', (ignoreCase) => {
    const { git } = tempRepo();
    const paths = LFS_EXTENSIONS.flatMap((ext) => [
      `books/x/backgrounds/bg.${ext}`,
      `company-data/photos/IMG_0001.${ext.toUpperCase()}`,
      `references/a/original/Scan.${ext.charAt(0).toUpperCase()}${ext.slice(1)}`,
    ]);
    expect([...lfsFiltered(git, paths, ignoreCase)].sort()).toEqual([...paths].sort());
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
    write(root, 'books/x/page.html', '<p></p>\n');
    expect(pendingSymlinks(git, root).sort()).toEqual(['books/x/link.svg', 'link-to-dir']);
  });

  it('追跡中のパスをリンクに置き換えたもの・git add -N したリンクも、git add -A で追加されるリンクとして見つける', () => {
    const { root, git } = tempRepo();
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-hygiene-target-'));
    tempDirs.push(target);
    // 追跡中の出力 PNG と、.gitignore に合う追跡ファイル（.gitignore は追跡中のパスに効かない）をリンクに置き換える
    for (const rel of ['books/x/output/png/page_001.png', '.vite/kept.js']) {
      stage(git, '100644', rel, POINTER);
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.symlinkSync(path.join(target, 'page_001.png'), path.join(root, rel));
    }
    // 追跡中で、作業ツリーでは変わっていないもの・消したものは数えない
    write(root, 'books/x/output/png/page_002.png', POINTER);
    git(['add', 'books/x/output/png/page_002.png']);
    stage(git, '100644', 'books/x/output/png/page_003.png', POINTER);
    // git add -N（intent-to-add）したリンク
    fs.symlinkSync(target, path.join(root, 'books/x/ita-link'));
    git(['add', '-N', 'books/x/ita-link']);
    expect(pendingSymlinks(git, root).sort()).toEqual(['.vite/kept.js', 'books/x/ita-link', 'books/x/output/png/page_001.png']);
  });

  it.each(IGNORE_CASE)('LFS で管理されていない LFS 対象の追跡ファイルを見つける（拡張子の大文字小文字を問わない。core.ignoreCase=%s）', (ignoreCase) => {
    const { git } = tempRepo({ ignoreCase });
    stage(git, '100644', 'books/x/backgrounds/ok.png', POINTER);
    stage(git, '100644', 'company-data/photos/ok.jpg', POINTER);
    stage(git, '100644', 'books/x/backgrounds/raw.png', BINARY);
    stage(git, '100644', 'company-data/photos/IMG_0001.JPG', BINARY);
    stage(git, '100644', 'company-data/photos/upper.PNG', POINTER);
    stage(git, '100644', 'references/a/original/SCAN0001.PDF', POINTER);
    stage(git, '100644', 'references/a/doc.pdf', Buffer.alloc(4096, 0x25));
    stage(git, '100644', 'books/x/backgrounds/bg.prompt.yaml', 'prompt: x\n');
    stage(git, '100644', 'books/x/backgrounds/text.png', 'version https://git-lfs.github.com/spec/v1\n');
    expect(trackedOutsideLfs(git)).toEqual([
      'books/x/backgrounds/raw.png（LFS のポインタではなく、中身がそのまま入っている）',
      'books/x/backgrounds/text.png（LFS のポインタではなく、中身がそのまま入っている）',
      'company-data/photos/IMG_0001.JPG（LFS のポインタではなく、中身がそのまま入っている）',
      'references/a/doc.pdf（LFS のポインタではなく、中身がそのまま入っている）',
    ]);
  });

  it.each(IGNORE_CASE)('大文字小文字の違いで macOS・Windows でだけ合う LFS の規則を見つける（core.ignoreCase=%s）', (ignoreCase) => {
    // git lfs track "*.mp4" が書く形（小文字だけ）の規則。CLIP.MP4 は macOS では LFS に入るが、Linux の checkout では実体に戻らない
    const { root, git } = tempRepo({ ignoreCase, extraAttributes: '*.mp4 filter=lfs diff=lfs merge=lfs -text\n' });
    git(['config', 'filter.lfs.process', 'git-lfs filter-process']);
    stage(git, '100644', 'company-data/photos/clip.mp4', POINTER);
    stage(git, '100644', 'company-data/photos/CLIP.MP4', POINTER);
    write(root, 'books/x/movie.mp4', 'x');
    write(root, 'books/x/MOVIE.MP4', 'x');
    write(root, 'books/x/NOTE.TXT', 'x');
    expect(trackedOutsideLfs(git)).toEqual([`company-data/photos/CLIP.MP4（${CASE_ONLY_RULE}）`]);
    expect(pendingOutsideLfs(git, root)).toEqual([`books/x/MOVIE.MP4（${CASE_ONLY_RULE}）`]);
  });

  it('LFS の拡張子なのに .gitattributes に規則がないものを見つける', () => {
    const { root, git } = tempRepo();
    const attributes = path.join(root, '.gitattributes');
    const withoutTiff = fs.readFileSync(attributes, 'utf8').replace(/^\*\.\[tT\]\[iI\]\[fF\]\[fF\] .*\n/m, '');
    expect(withoutTiff).not.toBe(fs.readFileSync(attributes, 'utf8'));
    fs.writeFileSync(attributes, withoutTiff);
    git(['config', 'filter.lfs.process', 'git-lfs filter-process']);
    stage(git, '100644', 'references/a/scan.tiff', POINTER);
    write(root, 'references/a/scan2.TIFF', 'x');
    expect(trackedOutsideLfs(git)).toEqual([`references/a/scan.tiff（${NO_RULE}）`]);
    expect(pendingOutsideLfs(git, root)).toEqual([`references/a/scan2.TIFF（${NO_RULE}）`]);
  });

  it.each(IGNORE_CASE)('git add しても LFS に入らない未追跡ファイル（LFS のフィルタ未設定）を見つける（core.ignoreCase=%s）', (ignoreCase) => {
    const { root, git } = tempRepo({ ignoreCase });
    for (const rel of ['books/x/backgrounds/bg.png', 'company-data/photos/IMG_0001.JPG', 'books/x/notes.txt', '.cache/ref-prep/p.png']) write(root, rel, 'x');
    // フィルタ未設定（git-lfs がない・git lfs install をしていない）なら LFS に入らない
    expect(pendingOutsideLfs(git, root)).toEqual([
      'books/x/backgrounds/bg.png（Git LFS のフィルタが未設定。git lfs install --local を実行する）',
      'company-data/photos/IMG_0001.JPG（Git LFS のフィルタが未設定。git lfs install --local を実行する）',
    ]);
    git(['config', 'filter.lfs.process', 'git-lfs filter-process']);
    expect(pendingOutsideLfs(git, root)).toEqual([]);
  });

  it('作業ツリーで変えた LFS 対象の追跡ファイルも、git add で LFS に入らなければ見つける（npm run render で更新した出力 PNG など）', () => {
    const { root, git } = tempRepo();
    for (const rel of ['books/x/output/png/page_001.png', 'books/x/output/png/page_002.png']) {
      write(root, rel, POINTER);
      git(['add', rel]);
    }
    // page_001.png だけ書き換える（LFS のフィルタ未設定なので、git add -A で中身がそのまま入る）
    write(root, 'books/x/output/png/page_001.png', BINARY);
    expect(pendingOutsideLfs(git, root)).toEqual(['books/x/output/png/page_001.png（Git LFS のフィルタが未設定。git lfs install --local を実行する）']);
    // フィルタを設定すれば問題ない（ここでは git-lfs の代わりに cat を clean フィルタにする）
    git(['config', 'filter.lfs.clean', 'cat']);
    expect(pendingOutsideLfs(git, root)).toEqual([]);
  });

  it('一時リポジトリは利用者の全体の属性・除外ファイル（~/.config/git/attributes・ignore）とシステムの属性ファイルを読まない', () => {
    const xdg = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-hygiene-xdg-'));
    tempDirs.push(xdg);
    write(xdg, 'git/attributes', '*.bin filter=lfs diff=lfs merge=lfs -text\n*.MP4 filter=lfs diff=lfs merge=lfs -text\n');
    write(xdg, 'git/ignore', '*.txt\n');
    const saved = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = xdg;
    try {
      const { root, git } = tempRepo();
      expect([...lfsFiltered(git, ['data.bin', 'CLIP.MP4', 'bg.png'], false)]).toEqual(['bg.png']);
      write(root, 'notes.txt', 'x');
      expect(nulList(git(['ls-files', '--others', '--exclude-standard', '-z']))).toEqual(['notes.txt']);
      // システムの属性ファイル（/etc/gitattributes）は書き換えずに確かめられないので、環境変数で確かめる
      expect(isolatedGitEnv()).toMatchObject({ GIT_ATTR_NOSYSTEM: '1' });
    } finally {
      if (saved === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = saved;
    }
  });
});
