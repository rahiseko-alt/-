// 画像ファイルの読み込み: Git LFS のポインタ（実体が未取得）の判定と、sharp で開けない画像の分かるエラー
// 新しいコンテナで git lfs pull をしていないと、画像・PDF は数行のテキスト（ポインタ）のまま。
// sharp は「unsupported image format」としか言わないので、各 CLI と validate はここで見分けて対処を示す。
import fs from 'node:fs';
import sharp, { type Metadata, type SharpOptions } from 'sharp';
import { CliError, firstLine } from './cli.ts';

/** Git LFS のポインタ文書の先頭行（https://github.com/git-lfs/git-lfs/blob/main/docs/spec.md） */
const LFS_POINTER_PREFIX = 'version https://git-lfs.github.com/spec/';

/** ポインタだったときの対処（validate の警告・CLI のエラーで共通） */
export const LFS_PULL_HINT = 'git lfs pull を実行してください';

/** Git LFS のポインタ（実体が未取得）のファイルか。読めないファイル・ディレクトリは false */
export function isLfsPointer(file: string): boolean {
  let fd: number;
  try {
    fd = fs.openSync(file, 'r');
  } catch {
    return false;
  }
  try {
    const buf = Buffer.alloc(LFS_POINTER_PREFIX.length);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, n).toString('utf8') === LFS_POINTER_PREFIX;
  } catch {
    return false;
  } finally {
    fs.closeSync(fd);
  }
}

/** 「<label> は Git LFS のポインタです（実体が未取得）」 */
export function lfsPointerMessage(label: string): string {
  return `${label} は Git LFS のポインタです（実体が未取得）`;
}

/** Git LFS のポインタなら、ファイル名と対処の付いた CliError にする */
export function assertNotLfsPointer(file: string, label: string): void {
  if (isLfsPointer(file)) throw new CliError(lfsPointerMessage(label), LFS_PULL_HINT);
}

export interface ReadImageOptions {
  /** 読めなかったとき（ポインタ以外）の対処 */
  hint?: string;
  sharp?: SharpOptions;
}

/**
 * 画像を sharp で開いて metadata を返す。Git LFS のポインタ・壊れた画像・対応していない形式は、
 * スタックトレースではなくファイル名（label）と対処の付いた CliError にする。
 * これが通れば、同じファイルを sharp で開き直して処理してよい
 */
export async function readImageMetadata(file: string, label: string, opts: ReadImageOptions = {}): Promise<Metadata> {
  assertNotLfsPointer(file, label);
  try {
    return await sharp(file, opts.sharp).metadata();
  } catch (err) {
    throw new CliError(`画像を読めません: ${label}（${firstLine(err)}）`, opts.hint);
  }
}
