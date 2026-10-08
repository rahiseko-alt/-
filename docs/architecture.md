# アーキテクチャ

publishing-studio の仕組み（データの流れ・データ形式・パス規約・ページ合成・CLI・テスト）をまとめます。
目的と方針は [concept.md](concept.md)、作業のルールは [../system/rules/](../system/rules/README.md) を参照してください。

## 1. 全体像とデータの流れ

```text
                 ┌─────────────────────────┐
                 │ references/<src>/<kind>/ │  参考資料（PDF・page_NNN.png・source.yaml・analysis/）
                 └────────────┬────────────┘
                              │ 解析（人・AI が目視）→ analysis/*.yaml
                              │ 参照（パスのみ）     → books/<id>/references.yaml
                              ▼
┌──────────────┐   ┌───────────────────────────┐   ┌──────────────────┐
│ company-data/ │──▶│ books/<id>/                │◀──│ shared/           │
│ facts/brand/  │   │  config/book.yaml          │   │  components/*.hbs │
│ photos/copy/  │   │  pages/page_NNN/           │   │  layouts/*.css    │
└──────────────┘   │   page.yaml/page.html/css   │   │  generated-assets │
                   │  backgrounds/ components/   │   └──────────────────┘
                   └─────────────┬─────────────┘
                                 ▼
             system/design-engine（load → 検証 → 厳格テンプレート → composePage / composeBook）
                                 │ HTML 文書（ページ = Layer 1/2/3 + ガイド）
          ┌──────────────────────┼─────────────────────────┐
          ▼                      ▼                         ▼
  npm run dev（Vite）     npm run render（Playwright）   npm run validate（dry-compose）
  /preview/<id>/<page>    output/png/<page>.png           エラー・警告の一覧
                          output/pdf/<book>.pdf
                                 │
                                 ▼
               npm run compare → books/<id>/reviews/<page>/compare-<日時>/
```

1. `company-data/` を読み込み、スキーマで検証する（`system/design-engine/src/load.ts`、`schemas/`）
2. BOOK の `book.yaml` と各ページの `page.yaml` を読み込み、検証する
3. ページごとにテンプレートの文脈（`facts` `brand` `copy` `photos` `book` `page`）を作り、`page.html` を**厳格モード**の Handlebars で描画する
4. 判型から CSS 変数を作り、背景（Layer 1）・描画結果（Layer 2/3）・ガイドを 1 枚のページ DOM にまとめる
5. プレビュー（Vite）またはレンダリング（Playwright Chromium）で表示・出力する
6. 参考ページ画像と出力 PNG を比較し、レビュー記録を残す

すべての状態はファイルにあり、同じ入力からは同じ出力になります（フォントもネットワークを使わず `node_modules/@fontsource` から読む）。

## 2. パス規約

- YAML の中・テンプレートのヘルパーに渡すパスは、**リポジトリルート相対・`/` 区切り・先頭スラッシュなし**
  - 例: `books/brochure/backgrounds/page_001.png`、`references/HAL/brochure/page_016.png`、`company-data/photos/campus-exterior.jpg`
  - `..`・絶対パス・`http:` などのスキーム・バックスラッシュは拒否される。シンボリックリンクでルート外を指すパスも拒否される
- ページの HTML は `<base href>` をリポジトリルートに向けるため、同じ相対パスがプレビューでも出力でも有効
  - `render` モード: `<base href="http://127.0.0.1:<port>/">`（`npm run render` が出力の間だけ起動する HTTP サーバー `system/scripts/lib/studio-server.ts`。ルートのファイル・`/@engine/...`・合成した HTML を配信し、Chromium には `file://` を読ませない）。`baseUrl` を渡さずに合成したときは `file://<root>/`
  - `preview` モード: `<base href="/">`（Vite がリポジトリルートを配信）
- `page.css` の中の相対 `url()` は、`page.css` の位置を基準にルート相対へ書き換えられる
- 全 CLI は `--root <dir>` を受け付ける（`npm run dev` だけは環境変数 `STUDIO_ROOT=<dir>`）。既定はリポジトリルート（スクリプトの位置から上へ辿り、`package.json` の `name` が `publishing-studio` のディレクトリ）。テストは `--root system/fixtures/studio`
- ID の規則は [system/rules/naming.md](../system/rules/naming.md)

| ID | 形式 | 例 |
| --- | --- | --- |
| BOOK ID | `books/` からの相対パス。セグメントは `[A-Za-z0-9][A-Za-z0-9_-]*`。予約名 `config` `pages` `backgrounds` `components` `reviews` `output` は不可 | `brochure`、`flyers/open-campus` |
| ページ ID | `^page_\d{3}$` | `page_001` |
| BOOK のファイル名 | BOOK ID の `/` を `-` に置換 | `flyers-open-campus` |

## 3. データ形式

スキーマ（zod）は `system/design-engine/src/schemas/` にあります。
company-data と解析結果は未知のキーを許容、`book.yaml` / `page.yaml` は未知のキーを警告します。

### 3.1 company-data

`facts/*.yaml` はすべて読み込まれ、ファイル名（拡張子なし）で `facts.<名前>` になります。`copy/*.yaml` も同様に `copy.<名前>` です。
文字列項目と数値項目は、未確定の間 `"TODO: ..."` を許容します（`validate` で警告、`--strict` でエラー）。

```yaml
# facts/school.yaml
name: AIビジネス専門学校           # 必須
name_en: "TODO: ..."
short_name: "TODO: ..."
corporation: "TODO: ..."
established: "TODO: ..."           # 数値 または TODO
address: { postal_code: "TODO: ...", prefecture: "TODO: ...", city: "TODO: ...", line1: "TODO: ...", line2: "TODO: ..." }
tel: "TODO: ..."
fax: "TODO: ..."
email: "TODO: ..."
url: "TODO: ..."
access: ["TODO: ..."]
```

```yaml
# facts/courses.yaml
courses:
  - id: course-a                   # 必須・一意
    name: "TODO: ..."              # 必須
    name_en: "TODO: ..."
    years: 2                       # 必須（数値 または TODO）
    capacity: 40                   # 数値 または TODO
    description: "TODO: ..."       # 必須
    tags: []
    curriculum: []                 # 文字列 または オブジェクトの配列
    qualifications: []
    careers: []
    photo: campus-exterior-01      # photos.yaml の ID
```

（数値は形式の例です。実際の値は company-data にあります。）

| ファイル | 形 |
| --- | --- |
| `facts/teachers.yaml` | `teachers: [{ id, name, name_kana?, title?, course_ids?[], profile?, photo? }]` |
| `facts/results.yaml` | `metrics: [{ id, label, value, unit?, as_of?, source?, note? }]`、`employers?: [{ name, note? }]`、`certifications?: [{ name, count?, as_of? }]` |
| `facts/contacts.yaml` | `contacts: [{ id, label, tel?, email?, url?, hours?, note? }]`、`sns?: [{ service, url }]` |
| `brand/colors/colors.yaml` | `colors: { primary, secondary, accent, text, muted, background, surface }`（16 進、必須）、`status?: provisional \| final` |
| `brand/fonts/fonts.yaml` | `families: { heading, body, serif, number }`（CSS font-family。既定 Noto Sans JP / Noto Serif JP） |
| `brand/logo/logo.yaml` | `logos: [{ id, file, variant?, note? }]`（空配列可） |
| `photos/photos.yaml` | `photos: [{ id, file, caption?, credit?, rights?, tags?[] }]`（空配列可） |
| `copy/*.yaml` | 自由形式 |

色は CSS 変数 `--color-primary` 〜 `--color-surface`、書体は `--font-heading` `--font-body` `--font-serif` `--font-number` になります。
色が `TODO` のままの場合は灰色で代替して警告を出します。

### 3.2 BOOK

```yaml
# books/brochure/config/book.yaml
id: brochure                 # books/ からの相対パスと一致
title: 学校案内
kind: brochure               # brochure | admissions | flyer | poster | guide | event | other
format:
  size: A4                   # A3 | A4 | A5 | B4 | B5 | custom（B は JIS）
  orientation: portrait      # portrait | landscape
  # width_mm / height_mm      … size: custom のときだけ
  bleed_mm: 3
  safe_mm: 5
  margins_mm: { top: 15, bottom: 15, inside: 18, outside: 15 }
  columns: 12
  gutter_mm: 4
  binding: left              # left | right | none
styles: [shared/layouts/grid.css, shared/layouts/typography.css, shared/layouts/components.css]
theme: { "--fs-body": "9pt" }   # :root の CSS 変数を上書き
pages: [page_001, page_002]     # 並び順 = ページ番号
output:
  png_dpi: 350
  preview_dpi: 150
notes: ""
```

```yaml
# books/brochure/pages/page_001/page.yaml
id: page_001
title: 表紙
type: cover                  # cover | toc | message | course | interview | data | access | back-cover | other
background:                  # Layer 1（任意）
  image: books/brochure/backgrounds/page_001.png
  fit: cover                 # cover | contain（既定 cover）
  position: center           # CSS object-position（既定 center）
  opacity: 1                 # 0〜1（既定 1）
status: draft                # draft | review | approved
notes: ""
```

```yaml
# books/brochure/references.yaml
references:
  - references/HAL/brochure/
page_016:
  layout_reference: [references/HAL/brochure/page_016.png]
  visual_reference: [references/A-school/brochure/page_031.png]
  information_reference: [references/B-school/brochure/page_008.png]
```

トップレベルは `references` 配列と任意個の `page_NNN` キーだけです（`page_NNN` は BOOK 側のページ ID）。

```yaml
# books/brochure/backgrounds/page_001.prompt.yaml（生成記録。画像と同じベース名）
tool: "（生成ツール）"
model: "（モデル）"
prompt: "..."
negative_prompt: "text, letters, typography, words, numbers, logo, watermark, signature, QR code, caption"
seed: 123456
size: 2976x4175
created: 2026-10-07T14:30:00+09:00
author: codex
reference_inputs:            # 生成モデルへ直接入力した参考画像と方式
  - { path: references/HAL/brochure/page_016.png, usage: composition, strength: 0.6 }
params: { steps: 30 }        # その他の生成条件
source_refs: []              # 入力せず見て参考にしたページ
notes: "拡大・加工の手順"
```

雛形: `system/templates/book/`、`system/templates/page/`、`system/templates/background.prompt.yaml`、`system/templates/review.md`。

### 3.3 参考資料

```yaml
# references/HAL/brochure/source.yaml
source: HAL
title: "（資料名）"
kind: brochure
obtained: 2026-10-01
original: references/HAL/brochure/original/brochure.pdf
pages: 48
usage: reference-only        # 固定
forbidden_terms: ["（他校名）", "（固有コピー）"]
notes: ""
```

```yaml
# references/HAL/brochure/analysis/page_016.yaml（キーは system/templates/reference/analysis.yaml）
grid: ""
margins: ""
gutter: ""
photo_ratios: ""
heading_hierarchy: ""
colors: ""
rules: ""          # 罫線
cards: ""
density: ""
page_type: ""
eye_flow: ""
background: ""
image_crop: ""
rhythm: ""
notes: ""
```

値の形（文字列・オブジェクト・配列）は自由です。

### 3.4 比較の report.yaml

```yaml
book: brochure
page: page_016
reference: references/HAL/brochure/page_016.png
rendered: books/brochure/output/png/page_016.png
width: 2894
height: 4093
mismatch_pixels: 123456
mismatch_ratio: 0.0104
threshold: 0.1
created: 2026-10-07T14:30:12+09:00
```

（数値は形式の例です。）

## 4. テンプレート（Handlebars）

`page.html` と パーシャルは Handlebars テンプレートです。

### 文脈

```text
{
  facts:  { school, courses, teachers, results, contacts, <追加の facts> },
  brand:  { colors, color_status, fonts, logos, logo: { <id>: logo } },
  copy:   { main, <追加の copy> },
  photos: { <id>: photo },
  book:   <book.yaml>,
  page:   <page.yaml> + { number: <pages での位置 1 始まり>, side: "left" | "right" }
}
```

### 厳格モード

- 存在しないキーの参照（出力・ヘルパー引数・ハッシュ引数・`{{#each}}` の引数）は、BOOK・ページ・ファイル・キー名つきのエラーになる（事実の正確性の原則）
- 例外は `{{#if x}}` / `{{#unless x}}` の第 1 引数だけで、存在しなければ偽として扱う（任意項目の分岐用）
- 出力は HTML エスケープされる

### ヘルパー

| ヘルパー | 書き方 | 結果 |
| --- | --- | --- |
| `asset` | `{{asset "shared/generated-assets/x.png"}}` | ルート相対パスを現在のモードで有効な URL に。ファイルがなければエラー |
| `photo` | `{{photo "campus-exterior-01"}}` | company-data の写真の URL。未登録の ID はエラー |
| `qr` | `{{qr facts.school.url size=20}}` | インライン SVG の QR コード（`size` は mm、ほかに `margin` `ecl` `dark` `light`）。内容に TODO があると警告 |
| `num` | `{{num value}}` | 数値を `1,234`（ja-JP）に。数値以外はそのまま |
| `nl2br` | `{{nl2br text}}` | エスケープした文字列の改行を `<br>` に |
| `eq` | `{{#if (eq page.type "cover")}}` | 等しいか |
| `join` | `{{join tags "・"}}` | 配列の連結（既定の区切りは「、」） |

### パーシャル

- `shared/components/**/*.hbs` → パス（拡張子なし）で登録。例: `{{> stat-card}}`、`{{> cards/photo-card}}`
- `books/<id>/components/*.hbs` → `book/<名前>` で登録。例: `{{> book/badge}}`
- 共通パーシャルのパラメータ: [shared/components/README.md](../shared/components/README.md)

## 5. ページの合成（design-engine）

```ts
composePage({ root, bookId, pageId, mode: 'render' | 'preview', guides?: boolean, baseUrl?: string }) // → { html, warnings }
composeBook({ root, bookId, pageIds?, mode, guides?, baseUrl? })                                    // → { html, warnings, pageIds }
```

`baseUrl` は render だけで使う HTTP 配信のルート URL（`http(s)://<ホスト>/` の形。ほかの形・preview との組み合わせは `StudioError`）。`npm run render` は studio-server の URL を渡す。省略すると `<base href>` とエンジンアセットは `file://`。

`composeBook` は全ページ（または指定ページ）を `book.yaml` の順に 1 つの HTML にまとめ、CSS の改ページで区切ります（PDF 用）。

### 文書の構成（読み込み順）

1. フォント: `@fontsource/noto-sans-jp`（400/500/700/900）、`@fontsource/noto-serif-jp`（400/700）の CSS
2. エンジンの `system/design-engine/src/assets/base.css`（リセット、ページ寸法、レイヤー、和文組版の既定、ガイド）
3. `<style id="studio-vars">`: `@page { size: <W+2b>mm <H+2b>mm; margin: 0 }` と `:root` の変数（ブランド色・書体 → 判型 → `book.theme`）
4. `book.yaml` の `styles`
5. 各ページの `page.css`（`@scope (.page[data-page="page_NNN"])` で囲まれる）

判型の CSS 変数: `--trim-w` `--trim-h` `--bleed` `--safe` `--page-w` `--page-h` `--margin-top` `--margin-bottom` `--margin-inside` `--margin-outside` `--columns` `--gutter` `--column-w`。
ページの左右で決まる変数（base.css）: `--margin-left` `--margin-right`。

### ページの DOM

```html
<div class="page" data-book="brochure" data-page="page_001" data-side="right" data-type="cover" data-number="1">
  <div class="layer layer-base">                       <!-- Layer 1: page.yaml の background（塗り足しまで全面） -->
    <img class="base-image" src="books/brochure/backgrounds/page_001.png" alt="" style="object-fit:cover;object-position:center;opacity:1">
  </div>
  <div class="layer layer-main">
    <div class="trim"> …page.html の描画結果… </div>   <!-- Layer 2 + 3。仕上がり座標系 -->
  </div>
  <div class="layer layer-guides">                     <!-- guides のときだけ -->
    guide-bleed / guide-trim / guide-safe / guide-margins / guide-columns
  </div>
</div>
```

- `.page` の大きさ = 仕上がり + 2 × 塗り足し。`.trim` は塗り足し分だけ内側に置かれ、著者は仕上がり座標（mm）で配置する
- `.bleed`（`.bleed-top` 等）を付けた要素は塗り足しの端まで広がる
- `data-side` はページ番号と綴じ方向で決まる（左綴じ: 奇数 = 右、偶数 = 左／右綴じ: 逆／綴じなし: 常に右）。右ページはノドが左
- 本文に `TODO` が残っていると警告（`render --release` ではエラー）
- 描画結果の文字を走査し、6.5pt 未満の文字、白抜き（RGB がすべて 230 以上）で 7pt 未満または 12pt 未満でウェイト 500 未満の文字、安全領域（`safe_mm`）の外の文字を警告（`render --release` ではエラー）。字の大きさは CSS の transform・SVG の座標変換を含めた実寸、位置は文字の送り方向と直角の向きを 1em の枠で測る。`data-print-qa="ignore"` の中と写真枠のプレースホルダは対象外（`system/scripts/lib/print-qa.ts`）

### プレビュー（Vite）

`npm run dev`（`system/design-engine/vite.config.ts` + `src/vite-plugin.ts`）。ルートはリポジトリルート。

| URL | 内容 |
| --- | --- |
| `/` | BOOK とページの一覧 |
| `/preview/<bookId>/<pageId>` | 1 ページ（`?guides=1` でガイド表示） |
| `/preview/<bookId>` | BOOK 全体 |

`company-data/`・`books/`・`shared/`・`system/design-engine/src/assets/` の変更で自動的に再読み込みします。

## 6. CLI

`system/scripts/*.ts`（共通処理は `system/scripts/lib/`）。すべて `npm run <名前> -- <引数>` で実行し、`--root <dir>` を受け付けます。

| コマンド | 引数 | 動作 |
| --- | --- | --- |
| `render` | `--book <id>` `[--page <id> ...]` `[--format png\|pdf\|both]`（既定 both） `[--dpi N]`（既定 `png_dpi`） `[--guides]` `[--release]` `[--out <dir>]`（既定 `books/<id>/output`） | 合成した HTML を 127.0.0.1 の HTTP サーバー経由で開く（`file://` を禁止したブラウザでも同じ出力。HTTP 404 も読み込み失敗として警告）。Chromium は Playwright 指定版。取得できない環境では環境変数 `STUDIO_CHROMIUM_PATH` に手元の Chromium を指定できる（警告つき。版が違うと字形・行送りがわずかに変わるため `--release` では失敗）。PNG: Playwright Chromium、ビューポート = ページボックス（CSS px）、`deviceScaleFactor = dpi / 96`（CSS px の丸めの分だけ微調整。§7）、フォントと画像の読み込み完了を待つ。PNG の画素数 = `round((W + 2b) / 25.4 × dpi)`。PDF: `composeBook` → `page.pdf`（塗り足し込みの mm、`printBackground`、`preferCSSPageSize`）。`--release` は TODO・ガイド・印刷に向かない文字（§5 の印刷チェック）・指定版以外の Chromium があると失敗。書き出したファイルを表示 |
| `compare` | `--book <id>` `--page <id>` `[--reference <path>]` `[--rendered <png>]` `[--crop-bleed]`（既定 有効） `[--threshold 0.1]` | 参考画像（既定 `references.yaml` の `layout_reference[0]`）と出力 PNG（既定 `output/png/<page>.png`）を比較。出力の塗り足しを切り落とし、参考画像を同じ大きさに変形（fill）して pixelmatch。`diff.png` `side-by-side.png` `overlay.png` `report.yaml` を `books/<id>/reviews/<page>/compare-<YYYYMMDD-HHmmss>/` に出力（比較画像は参考ページの画素を含むため `.gitignore` 済み。コミットするのは `report.yaml`） |
| `validate` | `[--strict]` | 下表。エラーがあれば終了コード 1 |
| `new:book` | `<bookId>` `[--kind brochure]` `[--title "..."]` `[--size A4]` `[--orientation portrait]` `[--pages 4]` | `system/templates/book/` から BOOK を作り、ページを `system/templates/page/` から作る。既存なら拒否。置換: `__BOOK_ID__` `__TITLE__` `__KIND__` `__SIZE__` `__ORIENTATION__` `__PAGE_ID__` `__PAGE_TYPE__` `__PAGE_TITLE__` `__DATE__` |
| `new:page` | `--book <id>` `[--after <pageId>]` `[--type other]` `[--title "..."]` | 空いている次の `page_NNN` を作り、`book.yaml` の `pages` に挿入（コメント保持） |
| `ref:ingest` | `--source <name>` `--kind <kind>` `(--pdf <file> \| --images <dir>)` `[--dpi 150]` `[--format jpg\|png]`（既定 jpg） | PDF を `original/` にコピーし `pdftoppm` で `page_NNN.jpg`（`--format png` で `.png`）、または画像を `page_NNN.<ext>` に正規化。`source.yaml` と `analysis/book.yaml` がなければ雛形から作成。次の手順（forbidden_terms の記入）を表示 |
| `ref:prep` | `(--spec <path> ... \| --all)` | `references/<source>/<kind>/prep/<name>.yaml`（`image`・`rotate`（時計回り 0/90/180/270）・`corners`（正立後の 左上・右上・右下・左下、比率）・`aspect`（幅/高さ）・`height_px`）に従い、ページ画像を回転→射影変換（双線形補間）して `.cache/ref-prep/<source>/<kind>/prep/<name>.png` に出力。`compare` の参照（`--reference` / `layout_reference`）に指定ファイルを書くと自動で実行 |
| `gen:inputs` | `(--book <id> ... \| --all)` | `books/<id>/backgrounds/layer1-orders.yaml`（Layer 1 の生成指示）を読み、補正後の参考ページ（`reference_prep`。なければ `reference_image`）から各素材の `crop_mm`（仕上がり線基準の mm）を切り出して `.cache/gen-inputs/<id>/<素材 id>.png` に出力（ページ外は白）。素材ごとに必要な画素数（BOOK の `png_dpi` と 350dpi）・人物の有無・生成済みかを表示 |
| `doctor` | `[--quiet]` | Node 22 以上、Chromium の起動（`STUDIO_CHROMIUM_PATH` があればその Chromium。指定版でなければ WARN）、@fontsource、Noto での日本語描画、sharp、git-lfs、poppler（`pdfinfo` / `pdftoppm`。テストと PDF 取り込みに必要なので致命的）を確認。致命的な問題で終了コード 1 |
| `setup` | `[--quiet]` | `system/scripts/setup.sh`: Git LFS（install --local / pull）、必要時のみ `npm ci`、Chromium の確認とインストール、`pdfinfo` / `pdftoppm` がなければ `apt-get install poppler-utils`（root かパスワードなし sudo のとき）、`npm run doctor`。冪等 |
| `dev` | （環境変数 `STUDIO_ROOT=<dir>` `PORT=<番号>`） | Vite プレビュー（既定: リポジトリルート・ポート 5173）。`--root` は使えない |
| `typecheck` / `test` / `check` | | `tsc` / `vitest run` / typecheck → validate → test |

### validate の検査項目

| # | 検査 | 結果 |
| --- | --- | --- |
| 1 | company-data のスキーマ。`TODO` プレースホルダ | スキーマ違反はエラー。TODO は警告（`--strict` でエラー） |
| 2 | 全 BOOK（BOOK ID に使えない名前のディレクトリもエラーとして報告）: `book.yaml` のスキーマ・id とパスの一致、`pages` のページの存在（`page.yaml` + `page.html`）、`page.yaml` のスキーマ・id、背景画像・`styles` の存在、`references.yaml` のスキーマと参照先の存在 | エラー |
| 3 | `references/*/*/source.yaml` のスキーマ | エラー |
| 4 | 全ページの試し合成（厳格テンプレートのエラー、存在しない素材、参考資料 `references/` を指す URL: `{{asset}}`・属性の `src`/`href`/`srcset`・`style` や `page.css`・`styles` の `url()`） | エラー |
| 4 | `page.css` が、BOOK の `styles`（共通 CSS）と同じクラス名を、`page.html`・BOOK 固有の部品の `class` 属性に直接書いた要素に使って装飾している（共通パーシャルが出力する要素の上書きだけなら対象外） | 警告 |
| 5 | 事実の直書き: company-data の文字列（4 文字以上、TODO 以外）が `books/**/page.html` やパーシャルにそのまま書かれている | 警告（`{{facts...}}` を使う） |
| 6 | 禁止語: いずれかの `source.yaml` の `forbidden_terms` が `books/**`・`company-data/**`・`shared/**` のテキストファイルに出現 | エラー |
| 7 | `backgrounds/*.{png,jpg,jpeg,webp}` に同じベース名の `.prompt.yaml` がない | 警告 |
| 7 | `backgrounds/layer1-orders.yaml` の形式・`book` の不一致・参照先の欠落 | エラー |
| 7 | `backgrounds/layer1-orders.yaml` の素材のうち、同じベース名の画像がまだないもの（全件そろって `status: pending` のままなら generated を促す） | 警告 |
| 7 | 生成済みの Layer 1 画像: BOOK の `png_dpi` で `size_mm` に足りない画素数、`size_mm` と 2% 以上違う縦横比、透明部分のない `cutout`、同じ素材 ID の画像の重複、`negative_prompt` に必須の 10 語がない記録 | 警告（画像を読めなければエラー） |

実際のリポジトリ（company-data がプレースホルダ、books が空）で終了コード 0 になることが前提です。

## 7. 出力の寸法

| 項目 | 計算 |
| --- | --- |
| ページボックス | 仕上がり + 2 × 塗り足し（A4 縦・3mm → 216 × 303mm） |
| ビューポート（CSS px） | mm × 96 / 25.4（216mm → 約 816.4px） |
| PNG の画素数 | `round(mm / 25.4 × dpi)`（350dpi → 2976 × 4175、150dpi → 1276 × 1789、72dpi → 612 × 859）。1 枚 1 億画素まで（超えると Chromium のスクリーンショットの下側が欠けるため、書き出す前にエラー） |
| PNG の倍率 | `deviceScaleFactor` は `dpi / 96` を基本に、Chromium が CSS px の整数に丸めて描くページボックス（816.375px → 816px）が目標の画素数を覆うよう 0.1% 未満だけ拡大（右端・下端に白い隙間を作らない） |
| PDF | 塗り足し込みのページサイズ、RGB、フォントはサブセット埋め込み。CMYK・PDF/X・トンボは範囲外 |

詳細: [system/rules/output.md](../system/rules/output.md)

## 8. 開発環境

| 環境 | 準備 |
| --- | --- |
| Dev Container / Codespaces | `.devcontainer/devcontainer.json` → `system/devcontainer/Dockerfile`（Playwright 1.56.1 のイメージ + Noto CJK・Git LFS・poppler）。作成時に `setup.sh` |
| Codex cloud | セットアップスクリプトに `bash system/scripts/setup.sh`（poppler-utils も `apt-get` で入れる） |
| Claude Code on the web | `.claude/settings.json` の SessionStart フック（リモート時のみ `setup.sh --quiet`） |

Playwright のバージョン（`package.json`）と Dockerfile のベースイメージのタグは必ず同時に更新します（system/devcontainer/README.md）。

## 9. テスト戦略

- テストランナー: vitest（`vitest.config.ts`）。対象は `system/**/test/**/*.test.ts`。Playwright を使うテストがあるため、タイムアウトは 60 秒
- テスト用データ: `system/fixtures/studio/`（架空の「サンプル学園」。TODO なしの完全な company-data、共通パーシャル、`books/smoke`（A4・塗り足し 3mm・2 ページ: SVG 背景 + QR + facts の表紙、`{{#each}}` + パーシャル + `num` のデータページ）、`references/Sample/brochure/`（forbidden_terms あり））。スクリプトは `--root system/fixtures/studio` で実行する
- バイナリをリポジトリに追加しない: フィクスチャの画像は SVG、テストが作る PNG / PDF は OS の一時ディレクトリへ出力する（フィクスチャの `output/` `reviews/` は `.gitignore` 済み）
- 主な観点
  - スキーマ: 正常系・必須項目の欠落・TODO の許容・パスの安全性
  - 判型: 各サイズ・向き・custom の寸法、ページの左右、CSS 変数
  - テンプレート: 厳格モードのエラー（キー名・ページ名を含む）、`#if` の扱い、各ヘルパー、パーシャルの登録名
  - 合成: DOM 構造、`<base href>`、背景、ガイド、`page.css` のスコープ
  - レンダリング（ブラウザ）: PNG の画素数、PDF のページ数・サイズ・フォント埋め込み
  - CLI: validate の各検査（禁止語・直書き・記録漏れ）、compare の出力、new:book / new:page / ref:ingest の生成物
  - 実リポジトリ: `npm run validate` が終了コード 0
- GitHub Actions の CI は使わない。テストを含む検証は各作業セッション内（ローカル / Dev Container / Claude Code / Codex）で `npm run doctor` → `npm run check` → 変更した BOOK の `npm run render` → 出力 PNG の目視の順に行い、通ってから commit / push する
