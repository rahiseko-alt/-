# 命名規則

ID とパスは、スクリプト・テンプレート・レビュー記録から参照される「住所」です。一度使い始めたら変更しません。

## 1. 共通

- ファイル名・ディレクトリ名・ID は **英小文字・数字・ハイフン**（kebab-case）を基本にする。日本語・空白・全角文字は使わない
  - 例外: 参考資料の `<source>` は発行元の通称に合わせて大文字を含んでよい（例: `HAL`、`A-school`）
- YAML の中や テンプレートのヘルパーに渡すパスは、**リポジトリルート相対・`/` 区切り・先頭スラッシュなし**
  - 正: `books/brochure/backgrounds/page_001.png`、`references/HAL/brochure/page_016.png`
  - 誤: `/books/...`、`./backgrounds/...`、`../shared/...`、`books\brochure\...`
- 日付は `YYYY-MM-DD`、日時のディレクトリ名は `YYYYMMDD-HHmmss`

## 2. BOOK

| 項目 | 規則 | 例 |
| --- | --- | --- |
| BOOK ID | `books/` からの相対パス。セグメントは英数字で始まり、英数字・`-`・`_` | `brochure`、`admissions`、`flyers/open-campus` |
| 予約名 | BOOK ID のセグメントに使えない: `config` `pages` `backgrounds` `components` `reviews` `output` | |
| book.yaml の `id` | BOOK ID と完全に一致 | `id: flyers/open-campus` |
| 出力ファイル名 | BOOK ID の `/` を `-` に置換 | `flyers-open-campus.pdf` |

- BOOK は年度で分けず、同じ BOOK を更新していく（版の履歴は Git に残る）。年度ごとに別の成果物として残す必要がある場合は `brochure-2027` のように ID に含める（人間の判断）
- BOOK の種別（`kind`）: `brochure` `admissions` `flyer` `poster` `guide` `event` `other`

## 3. ページ

| 項目 | 規則 | 例 |
| --- | --- | --- |
| ページ ID | `page_` + 3 桁の数字 | `page_001`、`page_016` |
| ページの順番 | `book.yaml` の `pages` の並び順（ID の数字ではない） | |
| ページ番号 | `pages` での位置（1 始まり）。テンプレートで `{{page.number}}` | |

- ページ ID は**識別子**であり、ページ番号ではない。並べ替え・挿入でページ ID を付け直さない（`references.yaml`・レビュー記録・背景画像の名前が ID を参照しているため）
- 新しいページは `npm run new:page` で作る（空いている次の番号が使われ、`--after` の位置に挿入される）
- 見開きの左右（`data-side`）はページ番号と綴じ方向（`binding`）で決まる。並べ替えると左右が入れ替わるので、全ページを再確認する
- ページの種別（`type`）: `cover` `toc` `message` `course` `interview` `data` `access` `back-cover` `other`

## 4. BOOK 内のファイル

| ファイル | 規則 |
| --- | --- |
| `books/<id>/config/book.yaml` | BOOK の設定 |
| `books/<id>/references.yaml` | 参考資料の指定 |
| `books/<id>/pages/<pageId>/page.yaml` `page.html` `page.css` | ページ（`page.css` は任意） |
| `books/<id>/backgrounds/<pageId>.png` | ページの全面背景。同じページに複数: `<pageId>-<用途>.png`（例: `page_001-alt.png`） |
| `books/<id>/backgrounds/<name>.prompt.yaml` | 画像と同じベース名の生成記録（`page_001.png` ↔ `page_001.prompt.yaml`） |
| `books/<id>/backgrounds/layer1-orders.yaml` | Layer 1 の生成指示。素材 id は `<pageId>-<用途>`（例: `page_001-hero`）で、生成画像のベース名になる（`page_001-hero.png` + `page_001-hero.prompt.yaml`） |
| `books/<id>/components/<name>.hbs` | BOOK 固有のパーシャル。`{{> book/<name>}}` で呼ぶ |
| `books/<id>/reviews/<pageId>/review.md` | ページのレビュー記録 |
| `books/<id>/reviews/<pageId>/compare-<YYYYMMDD-HHmmss>/` | 比較の出力（`npm run compare`） |
| `books/<id>/output/png/<pageId>.png` | ページの PNG 出力 |
| `books/<id>/output/pdf/<BOOK ID の / を - に>.pdf` | BOOK の PDF 出力 |

## 5. 参考資料

| 項目 | 規則 | 例 |
| --- | --- | --- |
| ディレクトリ | `references/<source>/<kind>/` | `references/HAL/brochure/` |
| `<source>` | 発行元の通称、または中立な識別名（英数字・ハイフン。大文字可）。パス `references/<source>/...` は禁止語の照合から除外される（system/rules/references.md §2） | `HAL`、`A-school`、`school-a` |
| `<kind>` | 資料の種別（英小文字） | `brochure`、`admissions`、`flyers` |
| ページ画像 | `page_` + 3 桁 + 拡張子（PDF からの取り込みは既定で `.jpg`）。番号は**元資料のページ順**（1 始まり） | `page_001.jpg` |
| 元資料 | `original/` に元のファイル名のまま（空白・日本語は置換してよい） | `original/brochure-2026.pdf` |
| 解析 | `analysis/book.yaml`、`analysis/page_NNN.yaml`（ページ画像と同じ番号） | `analysis/page_016.yaml` |
| 比較用の補正指定 | `prep/page_NNN.yaml`（見開きの片側は `page_NNN-l.yaml` / `page_NNN-r.yaml`） | `prep/page_015-r.yaml` |

見開きで 1 枚になっている資料は、取り込み時のページ画像の番号をそのまま使い、`source.yaml` の `notes` に「page_002 は 2〜3 ページの見開き」のように書く。

## 6. company-data の ID

| 対象 | 規則 | 例 |
| --- | --- | --- |
| 学科 `courses[].id` | 英小文字 kebab-case。学科名の英訳または略称 | `course-a` |
| 教員 `teachers[].id` | 英小文字 kebab-case（姓名のローマ字など） | `yamada-taro` |
| 指標 `metrics[].id` | 指標の意味 | `employment-rate` |
| 窓口 `contacts[].id` | 窓口の意味 | `admissions-office` |
| 写真 `photos[].id` | 内容 + 連番 | `campus-exterior-01` |
| ロゴ `logos[].id` | 用途 | `logo-horizontal` |
| プレースホルダ | `*-todo` | `course-todo` |

（例は形式を示すもので、実在の学科・人物ではありません。）

## 7. 共通資産

| 対象 | 規則 | 例 |
| --- | --- | --- |
| 共通パーシャル | `shared/components/<name>.hbs`（サブディレクトリ可） | `stat-card.hbs` → `{{> stat-card}}` |
| 共通 CSS | `shared/layouts/<name>.css` | `grid.css` |
| 再利用ビジュアル | `shared/generated-assets/<内容>-<特徴>-<連番2桁>.<ext>` + `.prompt.yaml` | `texture-paper-01.png` |

## 8. CSS クラス

- 共通: 役割の接頭辞（`.t-` 文字、`.c-` 文字色、`.bg-` 面、`.col-` 段）
- パーシャル: BEM 形式（`.stat-card` / `.stat-card__value` / `.stat-card--accent`）
- ページ固有: `page.css` は自動でそのページだけに効く（`@scope`）ので、短い名前でよい
