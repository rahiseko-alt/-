# 出力（PNG / PDF）のルール

出力は `npm run render` だけで行います（Playwright の Chromium で、プレビューと同じ HTML を描画）。

## 1. 判型・塗り足し・安全領域

`books/<id>/config/book.yaml` の `format` で決めます。

| 項目 | 既定 | 意味 |
| --- | --- | --- |
| `size` / `orientation` | `A4` / `portrait` | 仕上がりサイズ（A3 / A4 / A5 / B4 / B5 は JIS 規格、`custom` は `width_mm` / `height_mm`） |
| `bleed_mm` | 3 | 塗り足し（仕上がり線の外側、片側）。仕上がり線まで届く背景・写真・色面はここまで伸ばす |
| `safe_mm` | 5 | 安全領域（仕上がり線の内側）。文字・ロゴ・QR・ノンブルはこの内側 |
| `margins_mm` | 上 15 / 下 15 / ノド 18 / 小口 15 | 版面のマージン（本文を置く範囲） |
| `columns` / `gutter_mm` | 12 / 4 | 段組 |
| `binding` | `left` | 綴じ方向（`left` 左綴じ＝横組み冊子、`right` 右綴じ＝縦組み冊子、`none` 一枚もの） |

- 出力されるページの大きさは **仕上がり + 2 × 塗り足し**（A4・3mm なら 216 × 303mm）
- 断裁のずれを考え、切れてはいけない要素は安全領域の内側に置く
- QR コードは一辺 15mm 以上（`{{> qr-block}}` の既定は 20mm）。周囲の余白（`{{qr}}` の `margin`、既定は規格どおり 4 モジュール。4 未満にすると警告）を削らず、濃い背景の上では白地のパネルに載せる

## 2. 解像度

| 用途 | 解像度 | 指定 |
| --- | --- | --- |
| 印刷用 PNG | 350dpi（`output.png_dpi`） | 既定（`--dpi` 省略時） |
| 作業確認 | 150dpi（`output.preview_dpi` は目安） | `--dpi 150 --out <一時ディレクトリ>` を明示する（`output/` に置かない） |
| 動作確認（フィクスチャのスモークレンダリングなど） | 72dpi | `--dpi 72 --out <一時ディレクトリ>` |

- PNG のピクセル数: `round((仕上がり mm + 2 × 塗り足し mm) / 25.4 × dpi)`
  - A4 縦・塗り足し 3mm: 350dpi で 2976 × 4175 px、150dpi で 1276 × 1789 px
- PNG は 1 枚 1 億画素まで（Chromium のスクリーンショットは約 1.3 億画素を超えると下側が欠けるため、超える指定は書き出す前にエラー）。A4 は約 990dpi、A3 は約 700dpi まで
- 配置する画像（背景・写真）は、配置サイズで 300〜350dpi 相当の画素数を目安にする（system/rules/image-generation.md）

## 3. コマンド

```bash
# PNG と PDF（既定: --format both、--dpi は book.yaml の png_dpi）
npm run render -- --book brochure

# 特定ページだけ PNG（--page は複数指定可）
npm run render -- --book brochure --page page_001 --page page_002 --format png

# 作業確認用（低解像度・ガイド付き・一時ディレクトリへ）
npm run render -- --book brochure --page page_016 --format png --dpi 150 --guides --out /tmp/brochure-check

# 入稿・公開用（TODO が残っている・ガイドが付いていると失敗する）
npm run render -- --book brochure --release
```

| オプション | 内容 |
| --- | --- |
| `--book <id>` | 対象 BOOK（必須） |
| `--page <id>` | 対象ページ（複数可。省略時は全ページ） |
| `--format png\|pdf\|both` | 出力形式（既定 `both`） |
| `--dpi N` | PNG の解像度（既定 `book.yaml` の `output.png_dpi`） |
| `--guides` | 仕上がり線・塗り足し・安全領域・マージン・段組のガイドを重ねる |
| `--release` | 描画結果に `TODO` が含まれる、6.5pt 未満（白抜きは 7pt 未満、12pt 未満でウェイト 500 未満）や安全領域の外の文字がある、またはガイドが有効なら失敗する（通常の出力ではどれも警告） |
| `--out <dir>` | 出力先（既定 `books/<id>/output`） |
| `--root <dir>` | スタジオのルート（既定 リポジトリルート。テストは `system/fixtures/studio`） |

## 4. 出力先

| 形式 | パス |
| --- | --- |
| PNG | `books/<id>/output/png/<pageId>.png`（1 ページ 1 ファイル） |
| PDF | `books/<id>/output/pdf/<BOOK ID の / を - に置換>.pdf`（全ページを 1 ファイル。ページ順は `book.yaml` の `pages`） |

- 出力物はリポジトリに含める（Git LFS）。ガイド付き・低解像度の確認用出力は `--out` で一時ディレクトリに出し、`output/` に置かない
- 出力の前に `npm run validate` を通す

## 5. PDF の性質と制限

- Chromium の PDF 出力は **RGB** です。**CMYK ではなく、PDF/X（X-1a / X-4 など）にも準拠していません**
- トンボ（トリムマーク）は付きません。ページサイズは仕上がり + 塗り足しです
- 書体はサブセットとして埋め込まれます。`pdffonts <PDF>` で Noto Sans JP / Noto Serif JP が `emb yes` になっていることを確認する
  - `@fontsource` のフォントファイルは内部名が可変フォントの既定インスタンスのままのため、`pdffonts` では `NotoSansJPThin-Regular`・`NotoSansJPThin-Bold`・`NotoSerifJPExtraLight-Bold` のように表示されます。末尾（`-Regular` `-Bold` など）が実際のウェイトで、細字で出力されているわけではありません
- 特色（スポットカラー）、オーバープリント、総インキ量の管理はできません
- 文字・罫線・QR はベクター、背景画像・写真はラスターとして出力されます

**入稿用データへの変換（CMYK 変換・PDF/X 化・トンボ付与・特色指定）は本システムの範囲外です。**
入稿形式は必ず印刷会社に確認し、必要な変換は印刷会社または専用の DTP ソフトで行ってください【要確認: 印刷会社の入稿規定（カラーモード、PDF/X の要否、トンボ、塗り足し幅、最小文字サイズ、画像解像度）】。
RGB から CMYK への変換で鮮やかな色（特に青・緑・蛍光色）はくすむため、ブランドカラーを決めるときは CMYK での見え方を印刷会社と確認する【要確認】。

## 6. 出力後の確認

```bash
pdfinfo books/brochure/output/pdf/brochure.pdf     # ページ数・ページサイズ（pt）
pdffonts books/brochure/output/pdf/brochure.pdf    # 書体の埋め込み
```

PDF のページサイズは、Chromium が 0.24pt（1/300 インチ）刻みに丸めるため、計算値と最大 ±0.6pt（約 0.2mm）ずれます。
内容は拡大縮小されず、ずれた分だけ右端・下端の塗り足しが増減します（仕上がり線の位置は正しい）。

| 判型（塗り足し 3mm） | 計算値（pt） | 実際の `pdfinfo`（pt） |
| --- | --- | --- |
| A4 縦（216 × 303mm） | 612.28 × 858.90 | 612 × 858.96 |
| B5 横（263 × 188mm） | 745.51 × 532.91 | 745.92 × 533.04 |

- [ ] ページ数と順番、左右（ノンブルの位置）が正しい
- [ ] ページサイズが仕上がり + 塗り足し（上の丸めの範囲 ±0.6pt で一致）
- [ ] 背景・写真が塗り足しまで伸びている、文字が安全領域の内側
- [ ] 書体が埋め込まれている
- [ ] QR コードをスマートフォンで読み取れる（PNG を画面に表示して確認）
- [ ] 入稿・公開前のチェック（system/rules/review.md §6）
