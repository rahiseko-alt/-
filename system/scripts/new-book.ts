/**
 * new:book: system/templates/book/ と page/ から新しい BOOK を作る
 *
 *   npm run new:book -- <bookId> [--kind brochure] [--title "..."] [--size A4]
 *                       [--orientation portrait] [--pages 4] [--root <dir>]
 *
 * books/<bookId>/ が既にあれば何もしない（上書きしない）。
 * 終了コード: 0 = 成功 / 1 = 失敗
 */
import { runMain } from './lib/cli.ts';
import { newBookCommand } from './lib/new-book.ts';

await runMain(newBookCommand);
