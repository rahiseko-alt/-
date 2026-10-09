// photo:add: 学校の写真を company-data/photos/ に取り込み、photos.yaml に登録する
// 向きを補正して EXIF（撮影位置・機種・日時など）を消し、長辺を上限に収めてから書き出す。
// 権利・肖像の同意（rights）が確認できた写真だけを登録する（system/rules/company-data.md §2）。
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { isMap, isScalar, isSeq, parseDocument, stringify, type Node, type Pair } from 'yaml';
import { PhotosFileSchema, isInside, isReferencePath, loadYamlWithSchema, toPosix } from '../../design-engine/src/index.ts';
import { CliError, UsageError, consoleIo, parseCli, resolveRoot, runCommand, show, userPath, type Command, type Io } from './cli.ts';
import { readImageMetadata } from './images.ts';

export const PHOTO_ADD_USAGE = `使い方: npm run photo:add -- --file <画像> --id <写真ID> --rights "<使用条件・肖像の同意>" [--caption "..."] [--credit "..."] [--tags a,b] [--max-px 6000] [--root <dir>]

  学校の写真を company-data/photos/<写真ID>.jpg（透過があれば .png）に取り込み、photos.yaml に登録する。
  向きを補正して EXIF（撮影位置・機種・日時など）を消し、長辺を --max-px 以下に縮める（拡大はしない）。
  権利・肖像の同意が確認できた写真だけを登録する（--rights は必須。"TODO" は不可）。
  参考資料（references/ など）の写真、AI 生成画像は登録しない。

  --file <画像>     取り込む画像（JPEG・PNG・WebP・TIFF。HEIC は先に JPEG へ変換する）
  --id <写真ID>     英小文字・数字・ハイフン（内容 + 連番。例: campus-exterior-01）
  --rights "..."    使用条件（媒体・期限の制限、写っている人の掲載同意の状況など）
  --caption "..."   キャプション（省略可）
  --credit "..."    撮影者・提供元（省略可）
  --tags a,b        タグ（カンマ区切り。省略可）
  --max-px <N>      長辺の上限（既定 6000。350dpi で約 435mm）
  --root <dir>      スタジオのルート（既定: リポジトリルート）`;

export const PHOTO_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DEFAULT_MAX_PX = 6000;
const PRINT_DPI = 350;
const INPUT_RE = /\.(jpe?g|png|webp|tiff?)$/i;

export interface PhotoAddOptions {
  root: string;
  file: string;
  id: string;
  rights: string;
  caption?: string;
  credit?: string;
  tags?: string[];
  maxPx?: number;
}

export interface PhotoAddResult {
  file: string;
  width: number;
  height: number;
  /** 350dpi で印刷できる大きさ（mm） */
  printMm: [number, number];
}

/** 1 件分のブロック形式の項目（"- id: ..."）を、indent 桁の位置に書く */
function entryBlock(entry: Record<string, unknown>, indent: number): string {
  const pad = ' '.repeat(indent);
  return stringify([entry], { lineWidth: 0 })
    .trimEnd()
    .split('\n')
    .map((l) => pad + l)
    .join('\n');
}

/** 位置 at を含む行の先頭からの桁 */
function columnOf(text: string, at: number): number {
  return at - (text.lastIndexOf('\n', at - 1) + 1);
}

/** photos.yaml の photos に 1 件追記した YAML を返す（コメント・ほかの行・字下げはそのまま） */
export function appendPhotoEntry(text: string, entry: Record<string, unknown>, label: string): string {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) throw new CliError(`${label}: YAML 構文エラー（${doc.errors[0]?.message.split('\n')[0] ?? ''}）`);
  const pair = isMap(doc.contents) ? (doc.contents.items.find((p) => isScalar(p.key) && p.key.value === 'photos') as Pair<unknown, unknown> | undefined) : undefined;
  const value = pair?.value as Node | null | undefined;
  const keyRange = (pair?.key as Node | null | undefined)?.range;
  let out: string | null = null;
  if (!pair) {
    out = `${text.replace(/\n*$/, '\n')}photos:\n${entryBlock(entry, 2)}\n`;
  } else if (keyRange && (value == null || (isScalar(value) && value.value == null) || (isSeq(value) && value.flow && value.items.length === 0))) {
    // "photos:"・"photos: ~"・"photos: null"・"photos: []" → ブロック形式に（同じ行のコメントは photos: の行に残す）
    const lineStart = text.lastIndexOf('\n', keyRange[0] - 1) + 1;
    const nl = text.indexOf('\n', keyRange[1]);
    const lineEnd = nl < 0 ? text.length : nl;
    const line = text.slice(lineStart, lineEnd);
    const m = /^(\s*photos\s*:)\s*(?:~|null|Null|NULL|\[\s*\])?\s*(#.*)?$/.exec(line);
    if (m) {
      const head = `${m[1]}${m[2] ? ` ${m[2].trimEnd()}` : ''}`;
      out = `${text.slice(0, lineStart)}${head}\n${entryBlock(entry, 2)}${nl < 0 ? '\n' : text.slice(lineEnd)}`;
    }
  } else if (isSeq(value) && !value.flow && value.items.length > 0) {
    // 既存の項目と同じ字下げで、最後の項目の後ろに足す（字下げ 4・字下げなしの書き方も）
    const first = value.items[0] as Node | null;
    const last = value.items[value.items.length - 1] as Node | null;
    const firstAt = first?.range?.[0];
    const end = last?.range?.[1];
    if (firstAt != null && end != null) {
      const dash = text.lastIndexOf('-', firstAt - 1);
      const indent = dash >= 0 ? columnOf(text, dash) : 2;
      const lineEnd = text.indexOf('\n', end - 1);
      const at = lineEnd < 0 ? text.length : lineEnd;
      out = `${text.slice(0, at).replace(/\n*$/, '')}\n${entryBlock(entry, indent)}${text.slice(at)}`;
    }
  }
  const ok = (candidate: string | null): candidate is string => {
    if (candidate == null) return false;
    const check = parseDocument(candidate);
    const photos = (check.toJS() as { photos?: Array<{ id?: unknown }> } | null)?.photos ?? [];
    return check.errors.length === 0 && photos[photos.length - 1]?.id === entry.id;
  };
  if (ok(out)) return out;
  // 位置で書き換えられない書き方は Document API で再出力（コメントは残るが桁揃えは崩れる）
  const current = (doc.toJS() as { photos?: unknown[] } | null)?.photos ?? [];
  doc.set('photos', doc.createNode([...(Array.isArray(current) ? current : []), entry]));
  const fallback = doc.toString({ lineWidth: 0 });
  if (ok(fallback)) return fallback;
  throw new CliError(`${label}: photos への追記に失敗しました（書き換えずに中止）`);
}

export async function addPhoto(opts: PhotoAddOptions): Promise<PhotoAddResult> {
  const root = path.resolve(opts.root);
  if (!PHOTO_ID_RE.test(opts.id)) throw new UsageError(`--id は英小文字・数字・ハイフンで指定してください（例: campus-exterior-01）: ${opts.id}`);
  const rights = opts.rights.trim();
  if (!rights || /^todo/i.test(rights)) {
    throw new CliError(
      '--rights に使用条件と肖像の同意の状況を書いてください（"TODO" は不可）',
      '権利・掲載同意が確認できていない写真は登録しません（system/rules/company-data.md §2）。確認してから取り込んでください',
    );
  }
  const src = path.resolve(opts.file); // CLI は実行ディレクトリ基準の絶対パスを渡す（userPath）
  if (!fs.existsSync(src) || !fs.statSync(src).isFile()) throw new CliError(`画像が見つかりません: ${opts.file}`);
  if (/\.(heic|heif)$/i.test(src)) {
    throw new CliError(`HEIC は読み込めません: ${opts.file}`, 'iPhone の「写真」やプレビューなどで JPEG に書き出してから取り込んでください');
  }
  if (!INPUT_RE.test(src)) throw new CliError(`対応していない形式です: ${opts.file}（JPEG・PNG・WebP・TIFF）`);
  // 参考資料（references/）と、参考ページの画素を含む派生物（.cache/・比較出力）の画像は登録しない。
  // 画像とルートの両方について、シンボリックリンクの先も確かめる
  const roots = new Set([root, fs.realpathSync(root)]);
  for (const p of new Set([src, fs.realpathSync(src)])) {
    for (const r of roots) {
      if (isInside(r, p) && isReferencePath(toPosix(path.relative(r, p)))) {
        throw new CliError(`参考資料の画像は自社の写真として登録できません: ${show(r, p)}`, '参考資料の写真・ロゴは使わない（system/rules/references.md）');
      }
    }
  }

  const photosDir = path.join(root, 'company-data', 'photos');
  const yamlFile = path.join(photosDir, 'photos.yaml');
  const yamlRel = 'company-data/photos/photos.yaml';
  const text = fs.existsSync(yamlFile) ? fs.readFileSync(yamlFile, 'utf8') : 'photos: []\n';
  const current = fs.existsSync(yamlFile) ? (loadYamlWithSchema(yamlFile, PhotosFileSchema, yamlRel).photos ?? []) : [];
  if (current.some((p) => p.id === opts.id)) throw new CliError(`写真 ID "${opts.id}" はすでに ${yamlRel} にあります`);

  const maxPx = opts.maxPx ?? DEFAULT_MAX_PX;
  // Git LFS のポインタ・壊れた画像は、ファイル名と対処の付いたエラーにする
  const meta = await readImageMetadata(src, opts.file);
  // 透明な部分があるときだけ PNG（アルファチャンネルがあっても全面不透明なら JPEG）
  const transparent = (meta.hasAlpha ?? false) && !(await sharp(src).stats()).isOpaque;
  const ext = transparent ? 'png' : 'jpg';
  const out = path.join(photosDir, `${opts.id}.${ext}`);
  for (const e of ['jpg', 'png']) {
    if (fs.existsSync(path.join(photosDir, `${opts.id}.${e}`))) throw new CliError(`${show(root, path.join(photosDir, `${opts.id}.${e}`))} がすでにあります`);
  }
  // rotate(): EXIF の向きを画素に反映。withIccProfile('srgb'): 色を sRGB に変換し、小さな sRGB プロファイルだけを付ける
  // （16bit の画像は sharp が内部で P3 として扱うため、変換しないと色がずれる）。EXIF・XMP などは書き出さない（sharp の既定）
  let img = sharp(src).rotate().resize({ width: maxPx, height: maxPx, fit: 'inside', withoutEnlargement: true });
  img = ext === 'png' ? img.withIccProfile('srgb').png() : img.flatten({ background: '#ffffff' }).withIccProfile('srgb').jpeg({ quality: 92, chromaSubsampling: '4:4:4', mozjpeg: true });
  const entry: Record<string, unknown> = { id: opts.id, file: `company-data/photos/${opts.id}.${ext}` };
  if (opts.caption) entry.caption = opts.caption;
  if (opts.credit) entry.credit = opts.credit;
  entry.rights = rights;
  if (opts.tags && opts.tags.length > 0) entry.tags = opts.tags;
  const next = appendPhotoEntry(text, entry, yamlRel);
  fs.mkdirSync(photosDir, { recursive: true });
  // 画像と YAML を両方とも一時ファイルに書いてから置き換える（どちらかで失敗したら何も残さない）
  const tmp = `${out}.tmp-${process.pid}`;
  const yamlTmp = `${yamlFile}.tmp-${process.pid}`;
  let placed = false;
  try {
    await img.toFile(tmp);
    fs.writeFileSync(yamlTmp, next, 'utf8');
    fs.renameSync(tmp, out);
    placed = true;
    fs.renameSync(yamlTmp, yamlFile);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    fs.rmSync(yamlTmp, { force: true });
    if (placed) fs.rmSync(out, { force: true });
    throw err;
  }
  const done = await sharp(out).metadata();
  const width = done.width ?? 0;
  const height = done.height ?? 0;
  const mm = (px: number) => Math.round((px / PRINT_DPI) * 25.4);
  return { file: out, width, height, printMm: [mm(width), mm(height)] };
}

export const photoAddCommand: Command = (argv, io: Io = consoleIo) =>
  runCommand(io, PHOTO_ADD_USAGE, async () => {
    const { values } = parseCli(() =>
      parseArgs({
        args: argv,
        options: {
          file: { type: 'string' },
          id: { type: 'string' },
          rights: { type: 'string' },
          caption: { type: 'string' },
          credit: { type: 'string' },
          tags: { type: 'string' },
          'max-px': { type: 'string' },
          root: { type: 'string' },
          help: { type: 'boolean', short: 'h', default: false },
        },
        strict: true,
      }),
    );
    if (values.help) {
      io.log(PHOTO_ADD_USAGE);
      return 0;
    }
    if (!values.file || !values.id || values.rights === undefined) throw new UsageError('--file・--id・--rights は必須です');
    let maxPx: number | undefined;
    if (values['max-px'] !== undefined) {
      maxPx = Number(values['max-px']);
      if (!Number.isInteger(maxPx) || maxPx < 100) throw new UsageError(`--max-px は 100 以上の整数で指定してください: ${values['max-px']}`);
    }
    const root = resolveRoot(values.root);
    const tags = values.tags?.split(',').map((t) => t.trim()).filter(Boolean);
    const r = await addPhoto({ root, file: userPath(values.file), id: values.id, rights: values.rights, caption: values.caption, credit: values.credit, tags, maxPx });
    io.log(`photo:add: ${show(root, r.file)}（${r.width}×${r.height}px、350dpi で ${r.printMm[0]}×${r.printMm[1]}mm まで）`);
    io.log(`  company-data/photos/photos.yaml に "${values.id}" を登録しました。BOOK からは {{photo "${values.id}"}} で参照します`);
    return 0;
  });
