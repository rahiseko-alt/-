/**
 * render: BOOK のページを PNG / PDF に出力する
 *
 *   npm run render -- --book <id> [--page <id> ...] [--format png|pdf|both] [--dpi N]
 *                     [--guides] [--release] [--out <dir>] [--root <dir>]
 *
 * PNG: books/<id>/output/png/<pageId>.png（画素数 = round((仕上がり + 2 × 塗り足し) mm / 25.4 × dpi)）
 * PDF: books/<id>/output/pdf/<BOOK ID の / を - に>.pdf（仕上がり + 塗り足しのページサイズ）
 * 終了コード: 0 = 成功 / 1 = 失敗
 */
import { runMain } from './lib/cli.ts';
import { renderCommand } from './lib/render.ts';

await runMain(renderCommand);
