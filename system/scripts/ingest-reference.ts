/**
 * ref:ingest: 参考資料を references/<source>/<kind>/ に取り込む
 *
 *   npm run ref:ingest -- --source <name> --kind <kind> (--pdf <file> | --images <dir>)
 *                         [--dpi 150] [--force] [--root <dir>]
 *
 * PDF は original/ にコピーし pdftoppm で page_NNN.png に変換。画像は自然順に page_NNN.<拡張子> へ。
 * source.yaml と analysis/book.yaml はなければ雛形から作る。forbidden_terms は取り込み後に必ず記入する。
 * 終了コード: 0 = 成功 / 1 = 失敗
 */
import { runMain } from './lib/cli.ts';
import { ingestCommand } from './lib/ingest.ts';

await runMain(ingestCommand);
