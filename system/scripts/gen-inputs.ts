/**
 * gen:inputs: Layer 1 の生成指示（books/<bookId>/backgrounds/layer1-orders.yaml）から、
 * 画像生成モデルへ入力する参考ページの切り出しと、必要な画素数の一覧を作る
 *
 *   npm run gen:inputs -- (--book <bookId> ... | --all) [--root <dir>]
 *
 * 出力: .cache/gen-inputs/<bookId>/<id>.png（コミットしない）
 * 終了コード: 0 = 成功 / 1 = 失敗
 */
import { runMain } from './lib/cli.ts';
import { genInputsCommand } from './lib/gen-inputs.ts';

await runMain(genInputsCommand);
