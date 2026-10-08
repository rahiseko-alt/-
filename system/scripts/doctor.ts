/**
 * doctor: 制作環境の診断
 *
 * 使い方:
 *   npm run doctor
 *   npm run doctor -- --root system/fixtures/studio --quiet
 *
 * 致命的（critical）な項目が NG のときだけ exit 1。
 * 環境が壊れていても診断できるよう、他のプロジェクト内モジュールには依存しない。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { Browser } from 'playwright';

type Status = 'ok' | 'warn' | 'fail';

interface CheckResult {
  name: string;
  status: Status;
  detail: string;
  /** NG のとき exit 1 にするか */
  critical: boolean;
  /** NG / WARN のときの対処 */
  hint?: string;
}

const PROJECT_NAME = 'publishing-studio';
const MIN_NODE_MAJOR = 22;
const SAMPLE_TEXT = '日本語の組版テスト：あア漢字「、。」１２３';
const FONT_PACKAGES = [
  { pkg: '@fontsource/noto-sans-jp', family: 'Noto Sans JP', weights: [400, 500, 700, 900] },
  { pkg: '@fontsource/noto-serif-jp', family: 'Noto Serif JP', weights: [400, 700] },
] as const;

const require = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));

// ---------- 引数・ルート ----------

const USAGE = `使い方: npm run doctor -- [--root <dir>] [--quiet]
  --root <dir>  スタジオのルート（既定: リポジトリルート）
  --quiet       問題のある項目と結果だけを表示`;

function parseCli(): { root: string; quiet: boolean } {
  try {
    const { values } = parseArgs({
      options: {
        root: { type: 'string' },
        quiet: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
      strict: true,
    });
    if (values.help) {
      console.log(USAGE);
      process.exit(0);
    }
    const root = values.root ? resolve(process.cwd(), values.root) : findRepoRoot(scriptDir);
    return { root, quiet: values.quiet ?? false };
  } catch (err) {
    console.error(`引数エラー: ${errorMessage(err)}\n${USAGE}`);
    process.exit(2);
  }
}

/** package.json の name が publishing-studio のディレクトリまで遡る */
function findRepoRoot(start: string): string {
  let dir = start;
  for (;;) {
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: unknown };
        if (pkg.name === PROJECT_NAME) return dir;
      } catch {
        // 壊れた package.json は無視して上へ
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return resolve(scriptDir, '..', '..');
    dir = parent;
  }
}

// ---------- 小物 ----------

function errorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  // Playwright のエラーは長いので先頭行だけ
  return msg.split('\n')[0] ?? msg;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} が ${ms / 1000} 秒以内に終わりませんでした`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** コマンドを実行して最初の出力行を返す（存在しなければ null） */
function runCommand(cmd: string, args: string[], cwd?: string): { ok: boolean; firstLine: string; stdout: string } | null {
  const res = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 20_000 });
  if (res.error) return null;
  const out = `${res.stdout ?? ''}\n${res.stderr ?? ''}`.trim();
  return { ok: res.status === 0, firstLine: out.split('\n')[0]?.trim() ?? '', stdout: res.stdout ?? '' };
}

function packageDir(pkg: string): string | null {
  try {
    return dirname(require.resolve(`${pkg}/package.json`));
  } catch {
    return null;
  }
}

function readVersion(dir: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? '?';
  } catch {
    return '?';
  }
}

// ---------- 各チェック ----------

function checkNode(): CheckResult {
  const major = Number(process.versions.node.split('.')[0]);
  const ok = major >= MIN_NODE_MAJOR;
  return {
    name: 'Node.js',
    status: ok ? 'ok' : 'fail',
    detail: `v${process.versions.node}（必要: ${MIN_NODE_MAJOR} 以上）`,
    critical: true,
    hint: ok ? undefined : `Node.js ${MIN_NODE_MAJOR} を使ってください（.nvmrc 参照）`,
  };
}

function checkPlaywrightPackage(repoRoot: string): CheckResult {
  const dir = packageDir('playwright');
  if (!dir) {
    return { name: 'playwright パッケージ', status: 'fail', detail: '未インストール', critical: true, hint: 'npm ci を実行してください' };
  }
  const installed = readVersion(dir);
  let wanted = '?';
  try {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    wanted = pkg.dependencies?.playwright ?? '?';
  } catch {
    // 読めなければ比較しない
  }
  const pinned = /^\d+\.\d+\.\d+$/.test(wanted);
  const ok = !pinned || wanted === installed;
  return {
    name: 'playwright パッケージ',
    status: ok ? 'ok' : 'fail',
    detail: `${installed}（package.json: ${wanted}）`,
    critical: true,
    hint: ok ? undefined : 'npm ci を実行してバージョンを揃えてください',
  };
}

function checkFontsourceFiles(): CheckResult {
  const found: string[] = [];
  const missing: string[] = [];
  for (const { pkg, weights } of FONT_PACKAGES) {
    const dir = packageDir(pkg);
    if (!dir) {
      missing.push(`${pkg}（未インストール）`);
      continue;
    }
    const lacking = weights.filter((w) => !existsSync(join(dir, `${w}.css`)));
    const filesDir = join(dir, 'files');
    const woff2 = existsSync(filesDir) ? readdirSync(filesDir).filter((f) => f.endsWith('.woff2')).length : 0;
    if (lacking.length > 0) missing.push(`${pkg} ${lacking.join('/')}.css`);
    if (woff2 === 0) missing.push(`${pkg}/files/*.woff2`);
    if (lacking.length === 0 && woff2 > 0) found.push(`${pkg.replace('@fontsource/', '')} ${readVersion(dir)}（${weights.join('/')}）`);
  }
  const ok = missing.length === 0;
  return {
    name: '@fontsource フォント',
    status: ok ? 'ok' : 'fail',
    detail: ok ? found.join(', ') : `不足: ${missing.join(', ')}`,
    critical: true,
    hint: ok ? undefined : 'npm ci を実行してください',
  };
}

/** Playwright 指定版の代わりに使う Chromium（system/scripts/lib/browser.ts と同じ環境変数） */
const CHROMIUM_PATH_ENV = 'STUDIO_CHROMIUM_PATH';

async function checkChromium(): Promise<{ result: CheckResult; browser: Browser | null }> {
  const name = 'Chromium 起動 (Playwright)';
  const hint =
    'npx playwright install chromium を実行してください（共有ライブラリ不足なら sudo npx playwright install-deps chromium）。' +
    `取得できない環境では、手元の Chromium の実行ファイルを ${CHROMIUM_PATH_ENV} に指定できます`;
  try {
    const { chromium } = await import('playwright');
    const value = process.env[CHROMIUM_PATH_ENV]?.trim();
    let bundled = '';
    try {
      bundled = chromium.executablePath();
    } catch {
      // 指定版の場所が分からなくても、指定された実行ファイルで起動を試す
    }
    const override = value && resolve(value) !== (bundled && resolve(bundled)) ? value : null;
    const launch = chromium.launch(override ? { timeout: 60_000, executablePath: override } : { timeout: 60_000 });
    const browser = await withTimeout(launch, 90_000, 'Chromium の起動');
    if (override) {
      return {
        result: {
          name,
          status: 'warn',
          detail: `Chromium ${browser.version()}（${CHROMIUM_PATH_ENV}=${override}。Playwright 指定版ではありません）`,
          critical: true,
          hint: `出力の字形・行送りが指定版とわずかに違うことがあります。render --release は指定版でだけ出力できます（${CHROMIUM_PATH_ENV} を外して npx playwright install chromium）`,
        },
        browser,
      };
    }
    return {
      result: { name, status: 'ok', detail: `Chromium ${browser.version()}`, critical: true },
      browser,
    };
  } catch (err) {
    const detail = process.env[CHROMIUM_PATH_ENV]?.trim() ? `${CHROMIUM_PATH_ENV}=${process.env[CHROMIUM_PATH_ENV]?.trim()}: ${errorMessage(err)}` : errorMessage(err);
    return { result: { name, status: 'fail', detail, critical: true, hint }, browser: null };
  }
}

interface ProbeServer {
  /** http://127.0.0.1:<port> */
  origin: string;
  /** /probe.html で返す HTML */
  html: string;
  close(): Promise<void>;
}

/**
 * フォント確認用の HTTP サーバー（render と同じく file:// を使わない）。
 * /probe.html と、@fontsource パッケージ内のファイル（/fonts/<pkg>/...）だけを配信する
 */
async function startProbeServer(): Promise<ProbeServer> {
  const probe: ProbeServer = { origin: '', html: '', close: async () => undefined };
  const server = createServer((req, res) => {
    let pathname = '';
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    } catch {
      // 不正なエンコードは 404
    }
    if (pathname === '/probe.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(probe.html);
      return;
    }
    const m = /^\/fonts\/(@fontsource\/[^/]+)\/(.+)$/.exec(pathname);
    const dir = m && FONT_PACKAGES.some((f) => f.pkg === m[1]) ? packageDir(m[1]!) : null;
    const file = dir && m ? resolve(dir, m[2]!) : null;
    const rel = dir && file ? relative(dir, file) : '';
    if (!dir || !file || !rel || rel.startsWith('..') || isAbsolute(rel) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': file.endsWith('.css') ? 'text/css; charset=utf-8' : file.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => done());
  });
  probe.origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  probe.close = () =>
    new Promise<void>((done) => {
      server.closeAllConnections();
      server.close(() => done());
    });
  return probe;
}

interface FontProbe {
  family: string;
  loadedFaces: number;
  check: boolean;
}

/** @fontsource の CSS を HTTP 配信で読み込み、Noto で日本語が描画されるか確認 */
async function checkJapaneseRendering(browser: Browser | null): Promise<CheckResult[]> {
  const rows = FONT_PACKAGES.map(({ family }) => `日本語描画: ${family}`);
  if (!browser) {
    return rows.map((name) => ({ name, status: 'fail', detail: 'Chromium が起動できないため未確認', critical: true }));
  }

  let server: ProbeServer | null = null;
  const context = await browser.newContext();
  try {
    server = await startProbeServer();
    const links: string[] = [];
    for (const { pkg } of FONT_PACKAGES) {
      if (packageDir(pkg)) links.push(`<link rel="stylesheet" href="${server.origin}/fonts/${pkg}/400.css">`);
    }
    const ids = FONT_PACKAGES.map((_, i) => `probe-${i}`);
    const body = FONT_PACKAGES.map(
      ({ family }, i) => `<p id="${ids[i]}" style="font-family: '${family}', monospace; font-size: 16px">${SAMPLE_TEXT}</p>`,
    ).join('\n');
    server.html = `<!doctype html>\n<html lang="ja"><head><meta charset="utf-8">${links.join('')}</head><body>${body}</body></html>`;
    const page = await context.newPage();
    await page.goto(`${server.origin}/probe.html`, { waitUntil: 'load', timeout: 30_000 });

    const probes = await withTimeout(
      page.evaluate(
        async ({ families, text }) => {
          const out: FontProbe[] = [];
          for (const family of families) {
            const spec = `16px "${family}"`;
            const faces = await document.fonts.load(spec, text);
            out.push({ family, loadedFaces: faces.length, check: document.fonts.check(spec, text) });
          }
          await document.fonts.ready;
          return out;
        },
        { families: FONT_PACKAGES.map((f) => f.family), text: SAMPLE_TEXT },
      ),
      30_000,
      'フォント読み込み',
    );

    // 実際に描画に使われたフォントを CDP で確認（document.fonts.check は未登録フォントでも true を返すため）
    const rendered = new Map<string, string[] | null>();
    try {
      const cdp = await context.newCDPSession(page);
      await cdp.send('DOM.enable');
      await cdp.send('CSS.enable');
      const { root } = await cdp.send('DOM.getDocument');
      for (const [i, { family }] of FONT_PACKAGES.entries()) {
        const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: `#${ids[i]}` });
        const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
        rendered.set(
          family,
          fonts.filter((f) => f.isCustomFont && f.familyName.startsWith(family)).map((f) => f.familyName),
        );
      }
      await cdp.detach();
    } catch {
      // CDP が使えない場合は document.fonts の結果だけで判定
    }

    return FONT_PACKAGES.map(({ family }, i): CheckResult => {
      const name = rows[i] ?? family;
      const probe = probes.find((p) => p.family === family);
      const used = rendered.get(family);
      const loadedOk = !!probe && probe.loadedFaces > 0 && probe.check;
      const renderOk = used === undefined || used === null || used.length > 0;
      const ok = loadedOk && renderOk;
      const parts = [
        `fonts.check=${probe?.check ?? false}`,
        `読込 ${probe?.loadedFaces ?? 0} 面`,
        used === undefined || used === null
          ? '描画フォント未確認'
          : used.length > 0
            ? `描画: ${family}（@fontsource）`
            : '描画: フォールバック（Noto 未使用）',
      ];
      return {
        name,
        status: ok ? 'ok' : 'fail',
        detail: parts.join(', '),
        critical: true,
        hint: ok ? undefined : 'npm ci で @fontsource を入れ直してください',
      };
    });
  } catch (err) {
    return rows.map((name) => ({
      name,
      status: 'fail',
      detail: errorMessage(err),
      critical: true,
      hint: 'npm ci で @fontsource を入れ直してください',
    }));
  } finally {
    await context.close().catch(() => undefined);
    await server?.close();
  }
}

function checkSystemFonts(): CheckResult {
  const name = 'システム日本語フォント';
  const hint =
    'sudo apt-get install -y fonts-noto-cjk（描画は @fontsource の Noto Sans JP / Noto Serif JP を使う。システムフォントは、それらにない文字（ギリシャ文字・ローマ数字 Ⅰ〜Ⅹ・≒ など）の代替にだけ使われ、環境ごとに字形が変わるため紙面では使わない。npm run render が警告する）';
  const res = runCommand('fc-list', [':lang=ja', 'family']);
  if (!res) return { name, status: 'warn', detail: 'fc-list がありません（fontconfig 未導入）', critical: false, hint };
  const families = [
    ...new Set(
      res.stdout
        .split('\n')
        .map((line) => line.split(',')[0]?.trim() ?? '')
        .filter((f) => f.length > 0),
    ),
  ].sort();
  if (families.length === 0) return { name, status: 'warn', detail: '日本語フォントなし', critical: false, hint };
  const noto = families.filter((f) => /Noto (Sans|Serif) CJK/.test(f));
  const shown = (noto.length > 0 ? noto : families).slice(0, 3).join(', ');
  return {
    name,
    status: noto.length > 0 ? 'ok' : 'warn',
    detail: `${families.length} ファミリー（${shown}${families.length > 3 ? ' など' : ''}）${noto.length > 0 ? '' : '／Noto CJK なし'}`,
    critical: false,
    hint: noto.length > 0 ? undefined : hint,
  };
}

async function checkSharp(): Promise<CheckResult> {
  const name = 'sharp（画像処理）';
  try {
    const sharp = (await import('sharp')).default;
    const buf = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } }).png().toBuffer();
    if (buf.length === 0) throw new Error('PNG を生成できませんでした');
    return { name, status: 'ok', detail: `sharp ${sharp.versions.sharp} / libvips ${sharp.versions.vips}`, critical: true };
  } catch (err) {
    return {
      name,
      status: 'fail',
      detail: errorMessage(err),
      critical: true,
      hint: 'npm ci を実行してください（OS/CPU が変わった場合は node_modules を削除して入れ直す）',
    };
  }
}

function checkGitLfs(root: string): CheckResult[] {
  const lfs = runCommand('git', ['lfs', 'version']);
  if (!lfs || !lfs.ok) {
    return [
      {
        name: 'git-lfs',
        status: 'warn',
        detail: lfs ? 'git lfs が使えません' : 'git がありません',
        critical: false,
        hint: 'git-lfs をインストールし、bash system/scripts/setup.sh を実行してください',
      },
    ];
  }
  const rows: CheckResult[] = [{ name: 'git-lfs', status: 'ok', detail: lfs.firstLine, critical: false }];

  const inRepo = runCommand('git', ['-C', root, 'rev-parse', '--is-inside-work-tree']);
  if (!inRepo?.ok) return rows;
  const files = runCommand('git', ['-C', root, 'lfs', 'ls-files']);
  if (!files?.ok) {
    rows.push({ name: 'LFS 実体', status: 'warn', detail: `確認できません: ${files?.firstLine ?? ''}`, critical: false });
    return rows;
  }
  // 形式: "<oid> <*|-> <path>"  * = 実体あり, - = ポインタのまま
  const entries = files.stdout.split('\n').filter((l) => l.trim().length > 0);
  const pointers = entries.filter((l) => / - /.test(l)).length;
  rows.push({
    name: 'LFS 実体',
    status: pointers === 0 ? 'ok' : 'warn',
    detail:
      entries.length === 0
        ? 'LFS 管理ファイルなし'
        : pointers === 0
          ? `${entries.length} 件すべて取得済み`
          : `${entries.length} 件中 ${pointers} 件がポインタのまま`,
    critical: false,
    hint: pointers === 0 ? undefined : 'git lfs pull を実行してください',
  });
  return rows;
}

/** poppler（pdfinfo・pdftoppm）: ref:ingest の PDF 取り込みと、npm run check（テスト）の PDF 検証に必要 */
function checkPoppler(): CheckResult {
  const name = 'poppler（pdfinfo / pdftoppm）';
  const missing = ['pdfinfo', 'pdftoppm'].filter((cmd) => !runCommand(cmd, ['-v']));
  if (missing.length === 0) {
    const v = runCommand('pdftoppm', ['-v']);
    return { name, status: 'ok', detail: v?.firstLine ?? 'あり', critical: true };
  }
  return {
    name,
    status: 'fail',
    detail: `${missing.join(' / ')} が見つかりません（npm run check のテストと ref:ingest の PDF 取り込みに必要）`,
    critical: true,
    hint: 'bash system/scripts/setup.sh（root かパスワードなし sudo なら自動で入れる）、または sudo apt-get install -y poppler-utils',
  };
}

// ---------- 表示 ----------

const STATUS_LABEL: Record<Status, string> = { ok: 'OK', warn: 'WARN', fail: 'NG' };

/** 全角文字を幅 2 として数える */
function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    const wide =
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2e80 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe4f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x20000 && cp <= 0x3fffd);
    w += wide ? 2 : 1;
  }
  return w;
}

function pad(s: string, width: number): string {
  return s + ' '.repeat(Math.max(0, width - displayWidth(s)));
}

function printReport(results: CheckResult[], root: string, quiet: boolean): void {
  const shown = quiet ? results.filter((r) => r.status !== 'ok') : results;
  if (!quiet) console.log(`publishing-studio 環境診断（root: ${root}）\n`);

  if (shown.length > 0) {
    const statusW = Math.max(displayWidth('状態'), ...shown.map((r) => STATUS_LABEL[r.status].length));
    const nameW = Math.max(displayWidth('項目'), ...shown.map((r) => displayWidth(r.name)));
    console.log(`${pad('状態', statusW)}  ${pad('項目', nameW)}  詳細`);
    console.log(`${'-'.repeat(statusW)}  ${'-'.repeat(nameW)}  ${'-'.repeat(20)}`);
    for (const r of shown) {
      console.log(`${pad(STATUS_LABEL[r.status], statusW)}  ${pad(r.name, nameW)}  ${r.detail}`);
    }
    const hints = shown.filter((r) => r.status !== 'ok' && r.hint);
    if (hints.length > 0) {
      console.log('\n対処:');
      for (const r of hints) console.log(`  - ${r.name}: ${r.hint}`);
    }
    console.log('');
  }

  const count = (s: Status) => results.filter((r) => r.status === s).length;
  const criticalFails = results.filter((r) => r.status === 'fail' && r.critical);
  const summary = `doctor: OK ${count('ok')} / WARN ${count('warn')} / NG ${count('fail')}`;
  console.log(
    criticalFails.length > 0
      ? `${summary} — 致命的な問題があります: ${criticalFails.map((r) => r.name).join(', ')}`
      : `${summary} — 制作環境は利用可能です`,
  );
}

// ---------- main ----------

async function main(): Promise<number> {
  const { root, quiet } = parseCli();
  const repoRoot = findRepoRoot(scriptDir);
  const results: CheckResult[] = [];

  results.push(checkNode());
  results.push(checkPlaywrightPackage(repoRoot));
  results.push(checkFontsourceFiles());

  const { result: chromiumResult, browser } = await checkChromium();
  results.push(chromiumResult);
  try {
    results.push(...(await checkJapaneseRendering(browser)));
  } finally {
    await browser?.close().catch(() => undefined);
  }

  results.push(checkSystemFonts());
  results.push(await checkSharp());
  results.push(...checkGitLfs(root));
  results.push(checkPoppler());

  printReport(results, root, quiet);
  return results.some((r) => r.status === 'fail' && r.critical) ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(`doctor の実行に失敗しました: ${errorMessage(err)}`);
    process.exitCode = 1;
  },
);
