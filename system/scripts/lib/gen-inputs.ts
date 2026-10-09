// gen:inputs: Layer 1 の生成指示（layer1-orders.yaml）から、画像生成モデルへ入力する参考ページの切り出しを作る
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import fg from 'fast-glob';
import sharp from 'sharp';
import { Layer1OrdersSchema, loadBook, loadYamlWithSchema, resolveInRoot, trimSizeMm, type Layer1Orders } from '../../design-engine/src/index.ts';
import { CliError, UsageError, consoleIo, parseCli, resolveRoot, runCommand, show, type Command, type Io } from './cli.ts';
import { readImageMetadata } from './images.ts';
import { prepareReference } from './prep.ts';
import { LAYER1_ORDERS_FILE } from './validate.ts';

export const GEN_INPUTS_USAGE = `使い方: npm run gen:inputs -- (--book <bookId> ... | --all) [--root <dir>]

  books/<bookId>/backgrounds/layer1-orders.yaml（Layer 1 の生成指示）を読み、画像生成モデルへ入力する
  参考ページの切り出しを .cache/gen-inputs/<bookId>/<id>.png に書き出す（コミットしない）。
  切り出すのは補正後の参考ページ（reference_prep。なければ reference_image）の crop_mm の範囲で、ページ外は白。
  参考画像の文字・ロゴ・QR などは自動では塗らない。各指示の mask のとおり塗りつぶしてから入力する。
  素材ごとに、必要な画素数（BOOK の png_dpi と 350dpi）・人物の有無・生成済みかどうかを表示する。

  --book <bookId>   対象の BOOK（複数可）
  --all             layer1-orders.yaml があるすべての BOOK
  --root <dir>      スタジオのルート（既定: リポジトリルート）`;

/** 印刷用の目安の解像度（system/rules/image-generation.md §6） */
const PRINT_DPI = 350;
const IMAGE_RE = /\.(png|jpe?g|webp)$/i;

export function genInputsDir(root: string, bookId: string): string {
  return path.join(root, '.cache', 'gen-inputs', ...bookId.split('/'));
}

/** layer1-orders.yaml がある BOOK の ID 一覧 */
export function listOrderBooks(root: string): string[] {
  const dir = path.join(root, 'books');
  if (!fs.existsSync(dir)) return [];
  return fg
    .sync(`**/backgrounds/${LAYER1_ORDERS_FILE}`, { cwd: dir, onlyFiles: true })
    .map((p) => p.slice(0, -`/backgrounds/${LAYER1_ORDERS_FILE}`.length))
    .sort();
}

/** mm を dpi の画素数にする（validate の Layer 1 の解像度の検査と共通） */
export function pxAt(mm: number, dpi: number): number {
  return Math.round((mm / 25.4) * dpi);
}

export interface GenInputItem {
  id: string;
  kind: string;
  people: boolean;
  optional: boolean;
  sizeMm: [number, number];
  /** BOOK の png_dpi で必要な画素数 */
  minPx: [number, number];
  /** 350dpi の画素数 */
  printPx: [number, number];
  /** 切り出した入力画像（絶対パス） */
  input: string;
  /** 切り出し範囲が参考ページの外だけだった */
  outside: boolean;
  generated: boolean;
}

export interface GenInputsResult {
  bookId: string;
  dpi: number;
  source: string;
  items: GenInputItem[];
}

/** 生成指示 1 BOOK 分の入力画像を作る（毎回作り直す） */
export async function makeGenInputs(root: string, bookId: string): Promise<GenInputsResult> {
  const book = loadBook(root, bookId);
  const bgDir = path.join(book.dir, 'backgrounds');
  const ordersRel = `${book.relDir}/backgrounds/${LAYER1_ORDERS_FILE}`;
  const ordersAbs = path.join(bgDir, LAYER1_ORDERS_FILE);
  if (!fs.existsSync(ordersAbs)) throw new CliError(`生成指示がありません: ${ordersRel}`);
  const orders: Layer1Orders = loadYamlWithSchema(ordersAbs, Layer1OrdersSchema, ordersRel);
  if (orders.book !== bookId) throw new CliError(`${ordersRel}: book "${orders.book}" が BOOK ID "${bookId}" と一致しません`);

  let source: string;
  if (orders.reference_prep) {
    source = (await prepareReference(root, orders.reference_prep)).out;
  } else {
    source = resolveInRoot(root, orders.reference_image);
    if (!fs.existsSync(source)) throw new CliError(`${ordersRel}: reference_image のファイルがありません: ${orders.reference_image}`);
  }
  const meta = await readImageMetadata(source, show(root, source));
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  const trim = trimSizeMm(book.config.format);
  const scale = W / trim.width; // 参考ページの 1mm あたりの画素数
  const dpi = book.config.output.png_dpi;
  const existing = fs.existsSync(bgDir) ? fs.readdirSync(bgDir) : [];

  const outDir = genInputsDir(root, bookId);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const items: GenInputItem[] = [];
  for (const item of orders.items) {
    const [x, y, w, h] = item.crop_mm;
    const left = Math.round(x * scale);
    const top = Math.round(y * scale);
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    // 参考ページと重なる部分だけを切り出し、外側は白で埋める
    const ix0 = Math.max(0, left);
    const iy0 = Math.max(0, top);
    const ix1 = Math.min(W, left + cw);
    const iy1 = Math.min(H, top + ch);
    const outside = ix1 <= ix0 || iy1 <= iy0;
    const composites = outside
      ? []
      : [
          {
            input: await sharp(source).extract({ left: ix0, top: iy0, width: ix1 - ix0, height: iy1 - iy0 }).toBuffer(),
            left: ix0 - left,
            top: iy0 - top,
          },
        ];
    const input = path.join(outDir, `${item.id}.png`);
    await sharp({ create: { width: cw, height: ch, channels: 3, background: { r: 255, g: 255, b: 255 } } })
      .composite(composites)
      .png()
      .toFile(input);
    const [sw, sh] = item.size_mm;
    items.push({
      id: item.id,
      kind: item.kind,
      people: item.people,
      optional: item.optional,
      sizeMm: [sw, sh],
      minPx: [pxAt(sw, dpi), pxAt(sh, dpi)],
      printPx: [pxAt(sw, PRINT_DPI), pxAt(sh, PRINT_DPI)],
      input,
      outside,
      generated: existing.some((n) => IMAGE_RE.test(n) && n.replace(/\.[^.]+$/, '') === item.id),
    });
  }
  return { bookId, dpi, source, items };
}

export const genInputsCommand: Command = (argv, io: Io = consoleIo) =>
  runCommand(io, GEN_INPUTS_USAGE, async () => {
    const { values } = parseCli(() =>
      parseArgs({
        args: argv,
        options: {
          book: { type: 'string', multiple: true },
          all: { type: 'boolean', default: false },
          root: { type: 'string' },
          help: { type: 'boolean', short: 'h', default: false },
        },
        strict: true,
      }),
    );
    if (values.help) {
      io.log(GEN_INPUTS_USAGE);
      return 0;
    }
    const root = resolveRoot(values.root);
    const books = values.all ? listOrderBooks(root) : (values.book ?? []);
    if (books.length === 0) {
      throw new UsageError(values.all ? `books/**/backgrounds/${LAYER1_ORDERS_FILE} がありません` : '--book か --all を指定してください');
    }
    let pending = 0;
    for (const bookId of books) {
      const r = await makeGenInputs(root, bookId);
      io.log(`gen:inputs: ${r.bookId}（参考: ${show(root, r.source)}、png_dpi ${r.dpi}）→ ${show(root, genInputsDir(root, r.bookId))}/`);
      for (const it of r.items) {
        if (!it.generated) pending++;
        const flags = [it.kind, it.people ? '人物あり' : '', it.optional ? '任意' : '', it.generated ? '生成済み' : '未生成'].filter(Boolean).join('・');
        io.log(
          `  ${it.id}  ${it.sizeMm[0]}×${it.sizeMm[1]}mm  ${flags}  必要 ${it.minPx[0]}×${it.minPx[1]}px（350dpi: ${it.printPx[0]}×${it.printPx[1]}px）`,
        );
        if (it.outside) io.error(`  警告: ${it.id} の crop_mm が参考ページの外です（入力画像は白一色）`);
      }
    }
    io.log(`未生成 ${pending} 件。生成手順: system/prompts/generate-background.md`);
    return 0;
  });
