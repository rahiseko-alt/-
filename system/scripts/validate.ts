/**
 * validate: company-data・BOOK・参考資料の整合性チェック
 *
 *   npm run validate -- [--strict] [--root <dir>]
 *
 * company-data のスキーマ / BOOK 設定 / 参考資料 / 全ページの試し合成 / 事実の直書き /
 * 禁止語（forbidden_terms）/ 背景画像の生成記録 を確認する。
 * 終了コード: 0 = エラーなし（警告はあってよい）/ 1 = エラーあり
 */
import { runMain } from './lib/cli.ts';
import { validateCommand } from './lib/validate.ts';

await runMain(validateCommand);
