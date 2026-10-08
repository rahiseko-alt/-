/**
 * ref:prep: 参考ページ画像（写真・スキャン）を比較用に正立・単ページ・台形補正する
 *
 *   npm run ref:prep -- (--spec <references/<source>/<kind>/prep/<name>.yaml> ... | --all) [--root <dir>]
 *
 * 出力: .cache/ref-prep/<source>/<kind>/prep/<name>.png（コミットしない）
 * 終了コード: 0 = 成功 / 1 = 失敗
 */
import { runMain } from './lib/cli.ts';
import { prepCommand } from './lib/prep.ts';

await runMain(prepCommand);
