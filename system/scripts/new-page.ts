/**
 * new:page: ページ雛形から次の page_NNN を作り、book.yaml の pages に挿入する
 *
 *   npm run new:page -- --book <id> [--after <pageId>] [--type other] [--title "..."] [--root <dir>]
 *
 * ページ ID は空いている次の番号。既存ページの ID は付け直さない。book.yaml のコメントはそのまま残す。
 * 終了コード: 0 = 成功 / 1 = 失敗
 */
import { runMain } from './lib/cli.ts';
import { newPageCommand } from './lib/new-page.ts';

await runMain(newPageCommand);
