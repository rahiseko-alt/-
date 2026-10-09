// ref:prep: 参考ページ画像（写真・スキャン）を比較用に正立・単ページ・台形補正する
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import fg from 'fast-glob';
import sharp from 'sharp';
import { ReferencePrepSchema, loadYamlWithSchema, resolveInRoot, type ReferencePrep } from '../../design-engine/src/index.ts';
import { CliError, UsageError, consoleIo, parseCli, resolveRoot, runCommand, show, type Command, type Io } from './cli.ts';
import { readImageMetadata } from './images.ts';

export const PREP_USAGE = `使い方: npm run ref:prep -- (--spec <path> ... | --all) [--root <dir>]
  --spec <path>   指定ファイル references/<source>/<kind>/prep/<name>.yaml（複数可）
  --all           references/*/*/prep/*.yaml をすべて処理する
  --root <dir>    スタジオのルート（既定: リポジトリルート）
出力: .cache/ref-prep/<source>/<kind>/prep/<name>.png（.gitignore 済み。参考ページの画素を含むためコミットしない）
npm run compare -- --reference に指定ファイル（.yaml）を渡すと、この処理を自動で行って比較する
例:
  npm run ref:prep -- --spec references/A/brochure/prep/page_015-r.yaml
  npm run compare -- --book replica/a-brochure --page page_001 --reference references/A/brochure/prep/page_015-r.yaml`;

/** 指定ファイル（リポジトリルート相対）に対応する出力先 */
export function prepCachePath(root: string, specRel: string): string {
  const rel = specRel.replace(/^references\//, '').replace(/\.ya?ml$/i, '');
  return path.join(root, '.cache', 'ref-prep', `${rel}.png`);
}

export function isPrepSpec(p: string): boolean {
  return /\.ya?ml$/i.test(p);
}

type Point = [number, number];

/** 4 組の対応点から射影変換（3×3、h33 = 1）を求める。from → to */
export function homography(from: Point[], to: Point[]): number[] {
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i]!;
    const [u, v] = to[i]!;
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  // ガウスの消去法（部分ピボット）
  const n = 8;
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r]![c]!) > Math.abs(a[pivot]![c]!)) pivot = r;
    if (Math.abs(a[pivot]![c]!) < 1e-12) throw new CliError('corners から変換を求められません（4 点が一直線上にあるか重なっています）');
    [a[c], a[pivot]] = [a[pivot]!, a[c]!];
    [b[c], b[pivot]] = [b[pivot]!, b[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r]![c]! / a[c]![c]!;
      for (let k = c; k < n; k++) a[r]![k]! -= f * a[c]![k]!;
      b[r]! -= f * b[c]!;
    }
  }
  return [...b.map((v, i) => v / a[i]![i]!), 1];
}

export interface PrepResult {
  spec: string;
  out: string;
  width: number;
  height: number;
}

/** 指定ファイルに従って比較用画像を作る（毎回作り直す） */
export async function prepareReference(root: string, specRel: string): Promise<PrepResult> {
  const specAbs = resolveInRoot(root, specRel);
  if (!fs.existsSync(specAbs)) throw new CliError(`指定ファイルが見つかりません: ${specRel}`);
  const spec: ReferencePrep = loadYamlWithSchema(specAbs, ReferencePrepSchema, specRel);
  const imageAbs = resolveInRoot(root, spec.image);
  if (!fs.existsSync(imageAbs)) throw new CliError(`${specRel}: image のファイルがありません: ${spec.image}`);
  // Git LFS のポインタ・壊れた画像は、ファイル名と対処の付いたエラーにする
  await readImageMetadata(imageAbs, spec.image);

  const { data, info } = await sharp(imageAbs).rotate(spec.rotate).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const ch = info.channels;
  const outH = spec.height_px;
  const outW = Math.max(1, Math.round(outH * spec.aspect));
  const src = spec.corners.map(([x, y]) => [x * (W - 1), y * (H - 1)] as Point);
  const dst: Point[] = [
    [0, 0],
    [outW - 1, 0],
    [outW - 1, outH - 1],
    [0, outH - 1],
  ];
  const h = homography(dst, src);
  const out = Buffer.alloc(outW * outH * 3, 255);
  for (let v = 0; v < outH; v++) {
    for (let u = 0; u < outW; u++) {
      const w = h[6]! * u + h[7]! * v + h[8]!;
      const x = (h[0]! * u + h[1]! * v + h[2]!) / w;
      const y = (h[3]! * u + h[4]! * v + h[5]!) / w;
      if (x < 0 || y < 0 || x > W - 1 || y > H - 1) continue;
      // 双線形補間
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const x1 = Math.min(x0 + 1, W - 1);
      const y1 = Math.min(y0 + 1, H - 1);
      const fx = x - x0;
      const fy = y - y0;
      const o = (v * outW + u) * 3;
      for (let c = 0; c < 3; c++) {
        const p00 = data[(y0 * W + x0) * ch + c]!;
        const p10 = data[(y0 * W + x1) * ch + c]!;
        const p01 = data[(y1 * W + x0) * ch + c]!;
        const p11 = data[(y1 * W + x1) * ch + c]!;
        out[o + c] = Math.round(p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) + p01 * (1 - fx) * fy + p11 * fx * fy);
      }
    }
  }
  const outPath = prepCachePath(root, specRel);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await sharp(out, { raw: { width: outW, height: outH, channels: 3 } }).png().toFile(outPath);
  return { spec: specRel, out: outPath, width: outW, height: outH };
}

/** references/*\/*\/prep/*.yaml の一覧（リポジトリルート相対） */
export function listPrepSpecs(root: string): string[] {
  const dir = path.join(root, 'references');
  if (!fs.existsSync(dir)) return [];
  return fg.sync('*/*/prep/*.{yaml,yml}', { cwd: dir, onlyFiles: true }).sort().map((p) => `references/${p}`);
}

export const prepCommand: Command = (argv, io: Io = consoleIo) =>
  runCommand(io, PREP_USAGE, async () => {
    const { values } = parseCli(() =>
      parseArgs({
        args: argv,
        options: {
          spec: { type: 'string', multiple: true },
          all: { type: 'boolean', default: false },
          root: { type: 'string' },
          help: { type: 'boolean', short: 'h', default: false },
        },
        strict: true,
      }),
    );
    if (values.help) {
      io.log(PREP_USAGE);
      return 0;
    }
    const root = resolveRoot(values.root);
    const specs = values.all ? listPrepSpecs(root) : (values.spec ?? []);
    if (specs.length === 0) throw new UsageError(values.all ? 'references/*/*/prep/*.yaml がありません' : '--spec か --all を指定してください');
    for (const s of specs) {
      const r = await prepareReference(root, s.replace(/\\/g, '/'));
      io.log(`ref:prep: ${r.spec} → ${show(root, r.out)}（${r.width}×${r.height}px）`);
    }
    return 0;
  });
