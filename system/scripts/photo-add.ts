/**
 * photo:add: 学校の写真を company-data/photos/ に取り込み、photos.yaml に登録する
 *
 *   npm run photo:add -- --file <画像> --id <写真ID> --rights "<使用条件・肖像の同意>" [--caption "..."] [--credit "..."] [--tags a,b] [--max-px 6000] [--root <dir>]
 *
 * 向きを補正して EXIF（撮影位置など）を消し、長辺を上限に収める。権利・同意が確認できた写真だけを登録する
 * 終了コード: 0 = 成功 / 1 = 失敗
 */
import { runMain } from './lib/cli.ts';
import { photoAddCommand } from './lib/photo-add.ts';

await runMain(photoAddCommand);
