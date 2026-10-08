// ref:ingest: 参考資料（PDF またはページ画像）を references/<source>/<kind>/ に取り込む
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs, promisify } from 'node:util';
import sharp from 'sharp';
import { relFromRoot } from '../../design-engine/src/index.ts';
import {
  CliError,
  UsageError,
  consoleIo,
  formatDate,
  naturalCompare,
  parseCli,
  parsePositiveNumber,
  resolveRoot,
  runCommand,
  show,
  userPath,
  type Command,
  type Io,
} from './cli.ts';
import { fillTemplate, raw, templatePath, yamlString } from './templates.ts';

const execFileAsync = promisify(execFile);

export const INGEST_USAGE = `使い方: npm run ref:ingest -- --source <name> --kind <kind> (--pdf <file> | --images <dir>) [オプション]
  --source <name>    発行元の通称（例: HAL, A-school）。references/<source>/
  --kind <kind>      資料の種別（例: brochure, admissions, flyers）。references/<source>/<kind>/
  --pdf <file>       元の PDF。original/ にコピーし、pdftoppm でページごとの PNG（page_NNN.png）にする
  --images <dir>     ページ画像のディレクトリ。ファイル名の自然順に page_NNN.<拡張子> として取り込む
  --dpi <N>          PDF をページ画像にする解像度（既定: 150）
  --force            既存のページ画像（page_NNN.*）を削除して取り込み直す
  --root <dir>       スタジオのルート（既定: リポジトリルート）
source.yaml と analysis/book.yaml はなければ雛形から作ります（既存のものは変更しません）。
例:
  npm run ref:ingest -- --source HAL --kind brochure --pdf ~/Downloads/hal-brochure.pdf
  npm run ref:ingest -- --source A-school --kind flyers --images ~/scans/a-school-flyer`;

/** 発行元・種別の名前（英数字で始まり、英数字・-・_） */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** そのままコピーする画像形式（拡張子を正規化） */
const COPY_EXT: Record<string, string> = { '.png': '.png', '.jpg': '.jpg', '.jpeg': '.jpg', '.svg': '.svg' };
/** PNG に変換して取り込む画像形式 */
const CONVERT_EXT = new Set(['.webp', '.tif', '.tiff', '.gif', '.avif', '.bmp']);
const PAGE_FILE_RE = /^page_\d{3}\.(png|jpe?g|svg|webp|tiff?)$/i;

export interface IngestOptions {
  root: string;
  source: string;
  kind: string;
  /** 絶対パス */
  pdf?: string;
  /** 絶対パス */
  images?: string;
  dpi?: number;
  force?: boolean;
  date?: string;
}

export interface IngestResult {
  dir: string;
  pages: string[];
  original: string | null;
  createdSource: boolean;
  createdAnalysis: boolean;
  warnings: string[];
}

function pageName(n: number, ext: string): string {
  return `page_${String(n).padStart(3, '0')}${ext}`;
}

async function runTool(cmd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(cmd, args, { maxBuffer: 16 * 1024 * 1024 });
    return stdout;
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    if (e.code === 'ENOENT') {
      throw new CliError(`${cmd} が見つかりません`, 'poppler-utils（pdftoppm / pdfinfo）をインストールしてください。npm run doctor で確認できます');
    }
    throw new CliError(`${cmd} が失敗しました: ${(e.stderr ?? e.message).trim().split('\n')[0]}`);
  }
}

/** PDF のページ数（pdfinfo） */
async function pdfPageCount(pdf: string): Promise<number> {
  const out = await runTool('pdfinfo', [pdf]);
  const m = /^Pages:\s+(\d+)/m.exec(out);
  if (!m) throw new CliError(`PDF のページ数を読み取れません: ${pdf}`);
  return Number(m[1]);
}

/** 元ファイル名を original/ 用に整える（空白は - に） */
function originalName(file: string): string {
  const base = path.basename(file).replace(/\s+/g, '-');
  return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
}

function sameFile(a: string, b: string): boolean {
  const sa = fs.statSync(a);
  const sb = fs.statSync(b);
  return sa.size === sb.size && fs.readFileSync(a).equals(fs.readFileSync(b));
}

export async function ingestReference(opts: IngestOptions): Promise<IngestResult> {
  const { root, source, kind } = opts;
  if (!NAME_RE.test(source)) throw new CliError(`--source は英数字・-・_ で指定してください（"${source}"）`);
  if (!NAME_RE.test(kind)) throw new CliError(`--kind は英数字・-・_ で指定してください（"${kind}"）`);
  if (!!opts.pdf === !!opts.images) throw new CliError('--pdf か --images のどちらか一方を指定してください');
  const dpi = opts.dpi ?? 150;
  const date = opts.date ?? formatDate();
  const dir = path.join(root, 'references', source, kind);
  const warnings: string[] = [];

  // 入力の確認
  let inputs: string[] = [];
  if (opts.pdf) {
    if (!fs.existsSync(opts.pdf) || !fs.statSync(opts.pdf).isFile()) throw new CliError(`PDF が見つかりません: ${opts.pdf}`);
  } else if (opts.images) {
    if (!fs.existsSync(opts.images) || !fs.statSync(opts.images).isDirectory()) throw new CliError(`画像のディレクトリが見つかりません: ${opts.images}`);
    const all = fs
      .readdirSync(opts.images, { withFileTypes: true })
      .filter((d) => d.isFile() && !d.name.startsWith('.'))
      .map((d) => d.name);
    inputs = all.filter((n) => path.extname(n).toLowerCase() in COPY_EXT || CONVERT_EXT.has(path.extname(n).toLowerCase())).sort(naturalCompare);
    const skipped = all.filter((n) => !inputs.includes(n));
    if (skipped.length > 0) warnings.push(`画像ではないため取り込まなかったファイル: ${skipped.join(', ')}`);
    if (inputs.length === 0) throw new CliError(`取り込める画像がありません（png / jpg / jpeg / svg / webp / tif / gif）: ${opts.images}`);
    if (inputs.length > 999) throw new CliError(`画像が多すぎます（${inputs.length} 枚。page_NNN は 999 まで）`);
  }

  // 既存のページ画像（--force のときも、新しいページ画像の用意ができるまでは消さない）
  const existing = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => PAGE_FILE_RE.test(n)) : [];
  if (existing.length > 0 && !opts.force) {
    throw new CliError(
      `${relFromRoot(root, dir)}/ には既にページ画像があります（${existing.length} 枚）`,
      '取り込み直す場合は --force を付けてください（既存の page_NNN.* を削除します）',
    );
  }
  // 元 PDF のコピー先（同じ名前の別の PDF があれば、何かを変更する前に止める）
  const origDest = opts.pdf ? path.join(dir, 'original', originalName(opts.pdf)) : null;
  if (opts.pdf && origDest && fs.existsSync(origDest) && !sameFile(origDest, opts.pdf) && !opts.force) {
    throw new CliError(`同じ名前の別の PDF があります: ${relFromRoot(root, origDest)}`, '--force で上書きできます');
  }

  // 1. 一時ディレクトリにページ画像を作る（PDF の検査・変換に失敗したら既存のものには触れない）
  const staged: string[] = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ref-ingest-'));
  try {
    if (opts.pdf) {
      const count = await pdfPageCount(opts.pdf);
      if (count > 999) throw new CliError(`ページ数が多すぎます（${count} ページ。page_NNN は 999 まで）`);
      // pdftoppm でページ画像に変換（p-N.png → page_NNN.png）
      const rawDir = path.join(tmp, 'raw');
      fs.mkdirSync(rawDir);
      await runTool('pdftoppm', ['-png', '-r', String(dpi), opts.pdf, path.join(rawDir, 'p')]);
      const outs = fs
        .readdirSync(rawDir)
        .map((n) => ({ n, m: /^p-(\d+)\.png$/.exec(n) }))
        .filter((x): x is { n: string; m: RegExpExecArray } => x.m != null)
        .sort((a, b) => Number(a.m[1]) - Number(b.m[1]));
      if (outs.length === 0) throw new CliError('pdftoppm がページ画像を出力しませんでした');
      for (const o of outs) {
        const name = pageName(Number(o.m[1]), '.png');
        fs.renameSync(path.join(rawDir, o.n), path.join(tmp, name));
        staged.push(name);
      }
    } else if (opts.images) {
      for (const [i, n] of inputs.entries()) {
        const ext = path.extname(n).toLowerCase();
        const src = path.join(opts.images, n);
        const copyExt = COPY_EXT[ext];
        const name = pageName(i + 1, copyExt ?? '.png');
        if (copyExt) fs.copyFileSync(src, path.join(tmp, name));
        else await sharp(src).png().toFile(path.join(tmp, name));
        staged.push(name);
      }
    }

    // 2. 用意できたら既存のページ画像と入れ替える
    fs.mkdirSync(dir, { recursive: true });
    for (const n of existing) fs.rmSync(path.join(dir, n));
    for (const name of staged) fs.copyFileSync(path.join(tmp, name), path.join(dir, name));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const pages = staged;

  // 3. 元 PDF を original/ にコピー（変換に成功した PDF だけ）
  let original: string | null = null;
  if (opts.pdf && origDest) {
    fs.mkdirSync(path.dirname(origDest), { recursive: true });
    if (!fs.existsSync(origDest) || !sameFile(origDest, opts.pdf)) fs.copyFileSync(opts.pdf, origDest);
    original = relFromRoot(root, origDest);
  }

  // source.yaml（なければ作る）
  const sourcePath = path.join(dir, 'source.yaml');
  let createdSource = false;
  if (!fs.existsSync(sourcePath)) {
    const text = fillTemplate(fs.readFileSync(templatePath('reference/source.yaml'), 'utf8'), 'source.yaml', {
      __SOURCE__: source,
      __KIND__: kind,
      __DATE__: date,
      __ORIGINAL__: original ? yamlString(original) : raw('null'),
      __PAGES__: raw(String(pages.length)),
    });
    fs.writeFileSync(sourcePath, text, 'utf8');
    createdSource = true;
  } else {
    warnings.push(`${relFromRoot(root, sourcePath)} は既にあるため変更していません（pages: ${pages.length}${original ? `、original: ${original}` : ''} を必要なら反映してください）`);
  }

  // analysis/book.yaml（なければ作る）
  const analysisPath = path.join(dir, 'analysis', 'book.yaml');
  let createdAnalysis = false;
  if (!fs.existsSync(analysisPath)) {
    fs.mkdirSync(path.dirname(analysisPath), { recursive: true });
    fs.copyFileSync(templatePath('reference/analysis.yaml'), analysisPath);
    createdAnalysis = true;
  }

  return { dir, pages, original, createdSource, createdAnalysis, warnings };
}

export const ingestCommand: Command = (argv, io: Io = consoleIo) =>
  runCommand(io, INGEST_USAGE, async () => {
    const { values } = parseCli(() =>
      parseArgs({
        args: argv,
        options: {
          source: { type: 'string' },
          kind: { type: 'string' },
          pdf: { type: 'string' },
          images: { type: 'string' },
          dpi: { type: 'string' },
          force: { type: 'boolean', default: false },
          root: { type: 'string' },
          help: { type: 'boolean', short: 'h', default: false },
        },
        strict: true,
      }),
    );
    if (values.help) {
      io.log(INGEST_USAGE);
      return 0;
    }
    if (!values.source) throw new UsageError('--source を指定してください');
    if (!values.kind) throw new UsageError('--kind を指定してください');
    if (!values.pdf && !values.images) throw new UsageError('--pdf か --images を指定してください');
    if (values.pdf && values.images) throw new UsageError('--pdf と --images は同時に指定できません');
    const dpi = parsePositiveNumber('--dpi', values.dpi, { integer: true, max: 1200 });
    if (dpi != null && values.images) io.log('（--dpi は --pdf のときだけ使います。画像はそのまま取り込みます）');
    const root = resolveRoot(values.root);
    const r = await ingestReference({
      root,
      source: values.source,
      kind: values.kind,
      pdf: values.pdf ? userPath(values.pdf) : undefined,
      images: values.images ? userPath(values.images) : undefined,
      dpi,
      force: values.force,
    });
    const rel = show(root, r.dir);
    io.log(`ref:ingest: ${rel}/ に ${r.pages.length} ページを取り込みました`);
    if (r.original) io.log(`  元資料   ${r.original}`);
    io.log(`  ページ   ${r.pages[0]} 〜 ${r.pages[r.pages.length - 1]}`);
    if (r.createdSource) io.log(`  作成     ${rel}/source.yaml`);
    if (r.createdAnalysis) io.log(`  作成     ${rel}/analysis/book.yaml`);
    if (r.warnings.length > 0) {
      io.log('\n警告:');
      for (const w of r.warnings) io.log(`  - ${w}`);
    }
    io.log('\n次にやること:');
    io.log(`  1. 【必須】${rel}/source.yaml の forbidden_terms を埋める（他校の学校名・略称・英語名・固有の学科名・コピー・人物名・企業名）`);
    io.log('     空のままだと、参考資料の固有情報が自社の BOOK に混入しても npm run validate で検出できません');
    io.log(`  2. ${rel}/source.yaml の title・obtained・notes を記入する`);
    io.log('  3. ページ画像を開いて目視確認する（向き・欠け・見開き・ページ番号のずれ）');
    io.log(`  4. 解析結果を ${rel}/analysis/book.yaml と analysis/page_NNN.yaml（雛形: system/templates/reference/analysis.yaml）に書く`);
    io.log('  5. npm run validate');
    return 0;
  });
