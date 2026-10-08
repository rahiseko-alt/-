/**
 * compare: レンダリング PNG と参考ページ画像を比較する（Phase 5 の比較ループ）
 *
 *   npm run compare -- --book <id> --page <id> [--reference <path>] [--rendered <png>]
 *                      [--no-crop-bleed] [--threshold 0.1] [--root <dir>]
 *
 * 出力: books/<id>/reviews/<page>/compare-<YYYYMMDD-HHmmss>/
 *       diff.png・side-by-side.png・overlay.png・report.yaml（review.md がなければ雛形も作る）
 * 終了コード: 0 = 成功 / 1 = 失敗
 */
import { runMain } from './lib/cli.ts';
import { compareCommand } from './lib/compare.ts';

await runMain(compareCommand);
