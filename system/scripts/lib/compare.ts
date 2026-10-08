// compare: レンダリング PNG と参考ページ画像を比較する（pixelmatch）
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import pixelmatch from 'pixelmatch';
import sharp, { type Sharp } from 'sharp';
import { stringify } from 'yaml';
import {
  isSafeRelPath,
  isValidPageId,
  loadBook,
  loadReferences,
  pageGeometry,
  pageReference,
  resolveInRoot,
} from '../../design-engine/src/index.ts';
import {
  CliError,
  UsageError,
  consoleIo,
  formatDate,
  formatIsoLocal,
  formatStamp,
  parseCli,
  resolveRoot,
  runCommand,
  show,
  userPath,
  type Command,
  type Io,
} from './cli.ts';
import { isPrepSpec, prepareReference } from './prep.ts';
import { fillTemplate, templatePath } from './templates.ts';

export const COMPARE_USAGE = `使い方: npm run compare -- --book <id> --page <id> [オプション]
  --book <id>          対象 BOOK（必須）
  --page <id>          対象ページ（必須）
  --reference <path>   参考画像（既定: references.yaml の <page>.layout_reference の先頭）。
                       ref:prep の指定ファイル（references/<source>/<kind>/prep/<name>.yaml）も指定でき、
                       そのときは正立・単ページ・台形補正した画像を作ってから比較する
  --rendered <png>     レンダリング画像（既定: books/<id>/output/png/<page>.png）
  --no-crop-bleed      レンダリング画像の塗り足しを切り落とさない（既定は切り落とす）
  --threshold <0〜1>   pixelmatch のしきい値（既定: 0.1。大きいほど差に寛容）
  --root <dir>         スタジオのルート（既定: リポジトリルート）
出力: books/<id>/reviews/<page>/compare-<YYYYMMDD-HHmmss>/
      diff.png（差分）・side-by-side.png（左: 参考 / 右: レンダリング）・overlay.png（50% 重ね）・report.yaml
      比較画像は参考ページの画素を含むためコミットしない（.gitignore 済み）。report.yaml と review.md はコミットする
例:
  npm run render -- --book brochure --page page_016 --format png
  npm run compare -- --book brochure --page page_016`;

export interface CompareOptions {
  root: string;
  bookId: string;
  pageId: string;
  /** 参考画像（絶対パス。省略時は references.yaml から） */
  reference?: string;
  /** レンダリング画像（絶対パス。省略時は output/png/<page>.png） */
  rendered?: string;
  cropBleed?: boolean;
  threshold?: number;
  /** 出力ディレクトリ名に使う時刻（テスト用） */
  now?: Date;
}

export interface CompareReport {
  book: string;
  page: string;
  reference: string;
  rendered: string;
  width: number;
  height: number;
  mismatch_pixels: number;
  mismatch_ratio: number;
  threshold: number;
  crop_bleed: boolean;
  dpi: number;
  created: string;
}

export interface CompareResult {
  outDir: string;
  report: CompareReport;
  files: { diff: string; sideBySide: string; overlay: string; report: string };
  /** 作成した review.md（既にあった場合は null） */
  reviewCreated: string | null;
  warnings: string[];
}

/** CLI で受け取った画像パス: ルート相対で存在すればそれ、なければ実行ディレクトリ基準 */
export function resolveImageArg(root: string, p: string): string {
  if (!path.isAbsolute(p) && isSafeRelPath(p)) {
    const inRoot = path.resolve(root, p);
    if (fs.existsSync(inRoot)) return inRoot;
  }
  return userPath(p);
}

const VECTOR_EXT = new Set(['.svg', '.pdf']);

interface RawImage {
  data: Buffer;
  width: number;
  height: number;
}

/** 白地に合成した RGBA の生データ */
async function toRaw(img: Sharp): Promise<RawImage> {
  const { data, info } = await img.flatten({ background: '#ffffff' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function rawPng(raw: RawImage): Sharp {
  return sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 4 } }).png();
}

function uniqueDir(base: string): string {
  if (!fs.existsSync(base)) return base;
  for (let i = 2; ; i++) {
    const d = `${base}-${i}`;
    if (!fs.existsSync(d)) return d;
  }
}

/** 比較を実行して diff / side-by-side / overlay / report.yaml を書き出す */
export async function comparePage(opts: CompareOptions): Promise<CompareResult> {
  const { root, bookId, pageId } = opts;
  if (!isValidPageId(pageId)) throw new CliError(`ページ ID は page_NNN 形式です（"${pageId}"）`);
  const book = loadBook(root, bookId);
  if (!book.config.pages.includes(pageId)) {
    throw new CliError(`${book.configPath} の pages にないページです: ${pageId}`, `指定できるページ: ${book.config.pages.join(', ')}`);
  }
  const threshold = opts.threshold ?? 0.1;
  if (!(threshold >= 0 && threshold <= 1)) throw new CliError(`--threshold は 0〜1 の数です（${threshold}）`);
  const cropBleed = opts.cropBleed ?? true;
  const warnings: string[] = [];

  // 参考画像
  let reference = opts.reference;
  if (!reference) {
    const refs = loadReferences(root, bookId);
    const first = refs ? pageReference(refs, pageId)?.layout_reference[0] : undefined;
    if (!first) {
      throw new CliError(
        `${book.relDir}/references.yaml に ${pageId}.layout_reference がありません`,
        `references.yaml に「${pageId}: { layout_reference: [references/<source>/<kind>/page_NNN.png] }」を書くか、--reference で画像を指定してください`,
      );
    }
    reference = resolveInRoot(root, first);
  }
  if (!fs.existsSync(reference) || !fs.statSync(reference).isFile()) throw new CliError(`参考画像が見つかりません: ${show(root, reference)}`);
  // ref:prep の指定ファイルなら、比較用の画像を作ってそれを使う（report には指定ファイルを記録する）
  const referenceLabel = show(root, reference);
  if (isPrepSpec(reference)) {
    const rel = path.relative(root, reference).split(path.sep).join('/');
    reference = (await prepareReference(root, rel)).out;
  }

  // レンダリング画像
  const rendered = opts.rendered ?? path.join(book.dir, 'output', 'png', `${pageId}.png`);
  if (!fs.existsSync(rendered)) {
    throw new CliError(
      `レンダリング画像が見つかりません: ${show(root, rendered)}`,
      `先に npm run render -- --book ${bookId} --page ${pageId} --format png を実行してください`,
    );
  }

  // 塗り足しの切り落とし（dpi は画像の幅と判型から求める）
  const geometry = pageGeometry(book.config.format);
  const meta = await sharp(rendered).metadata();
  const rw = meta.width ?? 0;
  const rh = meta.height ?? 0;
  if (rw === 0 || rh === 0) throw new CliError(`レンダリング画像を読み込めません: ${show(root, rendered)}`);
  // 1mm あたりの画素数（縦横それぞれ。PNG の画素数は四捨五入されているため軸ごとに求める）
  const sx = rw / geometry.boxWidthMm;
  const sy = rh / geometry.boxHeightMm;
  const dpi = sx * 25.4;
  if (Math.abs(sx - sy) / sx > 0.01) {
    warnings.push(`レンダリング画像の縦横比が判型（${geometry.boxWidthMm}×${geometry.boxHeightMm}mm）と一致しません（${rw}×${rh}px）`);
  }
  let renderedImg = sharp(rendered);
  let width = rw;
  let height = rh;
  if (cropBleed && geometry.bleedMm > 0) {
    const bleedX = Math.round(geometry.bleedMm * sx);
    const bleedY = Math.round(geometry.bleedMm * sy);
    width = Math.min(Math.round(geometry.trimWidthMm * sx), rw - bleedX);
    height = Math.min(Math.round(geometry.trimHeightMm * sy), rh - bleedY);
    if (width <= 0 || height <= 0) throw new CliError('塗り足しを切り落とすと画像が空になります（--no-crop-bleed を試してください）');
    renderedImg = renderedImg.extract({ left: bleedX, top: bleedY, width, height });
  }
  const a = await toRaw(renderedImg);
  if (a.width !== width || a.height !== height) throw new CliError(`レンダリング画像の切り出しに失敗しました（${a.width}×${a.height}px）`);

  // 参考画像を同じ大きさに引き伸ばす（ベクター画像は近い解像度でラスタライズ）
  const refExt = path.extname(reference).toLowerCase();
  const refInput = VECTOR_EXT.has(refExt) ? sharp(reference, { density: Math.max(1, Math.min(dpi, 2400)) }) : sharp(reference);
  const refMeta = await sharp(reference).metadata();
  if (refMeta.width && refMeta.height) {
    const ra = refMeta.width / refMeta.height;
    const ta = width / height;
    if (Math.abs(ra - ta) / ta > 0.02) {
      warnings.push(`参考画像の縦横比（${refMeta.width}×${refMeta.height}）がレンダリング（${width}×${height}）と異なるため、引き伸ばしで歪んでいます`);
    }
  }
  const b = await toRaw(refInput.resize(width, height, { fit: 'fill' }));

  // 差分
  const diff = Buffer.alloc(width * height * 4);
  const mismatch = pixelmatch(b.data, a.data, diff, width, height, { threshold });

  // 出力
  const now = opts.now ?? new Date();
  const stamp = formatStamp(now);
  const outDir = uniqueDir(path.join(book.dir, 'reviews', pageId, `compare-${stamp}`));
  fs.mkdirSync(outDir, { recursive: true });
  const files = {
    diff: path.join(outDir, 'diff.png'),
    sideBySide: path.join(outDir, 'side-by-side.png'),
    overlay: path.join(outDir, 'overlay.png'),
    report: path.join(outDir, 'report.yaml'),
  };
  await rawPng({ data: diff, width, height }).toFile(files.diff);

  const gap = Math.max(8, Math.round(width * 0.02));
  await sharp({ create: { width: width * 2 + gap, height, channels: 4, background: '#808080' } })
    .composite([
      { input: b.data, raw: { width, height, channels: 4 }, left: 0, top: 0 },
      { input: a.data, raw: { width, height, channels: 4 }, left: width + gap, top: 0 },
    ])
    .png()
    .toFile(files.sideBySide);

  const overlay = Buffer.alloc(width * height * 4);
  for (let i = 0; i < overlay.length; i += 4) {
    overlay[i] = ((b.data[i] ?? 0) + (a.data[i] ?? 0)) >> 1;
    overlay[i + 1] = ((b.data[i + 1] ?? 0) + (a.data[i + 1] ?? 0)) >> 1;
    overlay[i + 2] = ((b.data[i + 2] ?? 0) + (a.data[i + 2] ?? 0)) >> 1;
    overlay[i + 3] = 255;
  }
  await rawPng({ data: overlay, width, height }).toFile(files.overlay);

  const report: CompareReport = {
    book: bookId,
    page: pageId,
    reference: referenceLabel,
    rendered: show(root, rendered),
    width,
    height,
    mismatch_pixels: mismatch,
    mismatch_ratio: Number((mismatch / (width * height)).toFixed(6)),
    threshold,
    crop_bleed: cropBleed,
    dpi: Number(dpi.toFixed(2)),
    created: formatIsoLocal(now),
  };
  fs.writeFileSync(
    files.report,
    `# npm run compare の結果（diff.png / side-by-side.png / overlay.png と同じディレクトリ）\n` +
      `# mismatch_ratio は推移の参考値。合否は画像を目視して決める（system/rules/review.md）\n` +
      stringify(report),
    'utf8',
  );

  // レビュー記録の雛形（なければ作る）
  const reviewPath = path.join(book.dir, 'reviews', pageId, 'review.md');
  let reviewCreated: string | null = null;
  if (!fs.existsSync(reviewPath)) {
    const text = fillTemplate(fs.readFileSync(templatePath('review.md'), 'utf8'), 'review.md', {
      __BOOK_ID__: bookId,
      __PAGE_ID__: pageId,
      __DATE__: formatDate(opts.now ?? new Date()),
      __REFERENCE__: report.reference,
      __COMPARE_DIR__: `${show(root, outDir)}/`,
      __MISMATCH_RATIO__: String(report.mismatch_ratio),
    });
    fs.writeFileSync(reviewPath, text, 'utf8');
    reviewCreated = reviewPath;
  }

  return { outDir, report, files, reviewCreated, warnings };
}

export const compareCommand: Command = (argv, io: Io = consoleIo) =>
  runCommand(io, COMPARE_USAGE, async () => {
    const { values } = parseCli(() =>
      parseArgs({
        args: argv,
        options: {
          book: { type: 'string' },
          page: { type: 'string' },
          reference: { type: 'string' },
          rendered: { type: 'string' },
          'crop-bleed': { type: 'boolean', default: true },
          threshold: { type: 'string' },
          root: { type: 'string' },
          help: { type: 'boolean', short: 'h', default: false },
        },
        strict: true,
        allowNegative: true,
      }),
    );
    if (values.help) {
      io.log(COMPARE_USAGE);
      return 0;
    }
    if (!values.book) throw new UsageError('--book を指定してください');
    if (!values.page) throw new UsageError('--page を指定してください');
    let threshold = 0.1;
    if (values.threshold != null) {
      threshold = Number(values.threshold);
      if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new UsageError(`--threshold は 0〜1 の数です（"${values.threshold}"）`);
    }
    const root = resolveRoot(values.root);
    const r = await comparePage({
      root,
      bookId: values.book,
      pageId: values.page,
      reference: values.reference ? resolveImageArg(root, values.reference) : undefined,
      rendered: values.rendered ? resolveImageArg(root, values.rendered) : undefined,
      cropBleed: values['crop-bleed'],
      threshold,
    });
    const rep = r.report;
    io.log(`compare: ${rep.book} / ${rep.page}`);
    io.log(`  参考        ${rep.reference}`);
    io.log(`  レンダリング ${rep.rendered}${rep.crop_bleed ? '（塗り足しを切り落とし）' : ''}`);
    io.log(`  比較サイズ  ${rep.width}×${rep.height}px（${rep.dpi}dpi 相当）`);
    io.log(`  差分        ${rep.mismatch_pixels} px（mismatch_ratio ${rep.mismatch_ratio}、threshold ${rep.threshold}）`);
    io.log('');
    io.log(`出力: ${show(root, r.outDir)}/`);
    for (const f of [r.files.sideBySide, r.files.overlay, r.files.diff, r.files.report]) io.log(`  ${path.basename(f)}`);
    if (r.warnings.length > 0) {
      io.log(`\n警告:`);
      for (const w of r.warnings) io.log(`  - ${w}`);
    }
    io.log('');
    io.log('次にやること: side-by-side.png → overlay.png → diff.png の順に画像を開いて目視し、');
    io.log(
      r.reviewCreated
        ? `  レビュー記録 ${show(root, r.reviewCreated)} を作成しました。所見と修正内容を記入してください（system/rules/review.md）`
        : `  ${show(root, path.join(path.dirname(r.outDir), 'review.md'))} にラウンドを追記してください（system/rules/review.md）`,
    );
    return 0;
  });
