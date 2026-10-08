# design-engine（ページ合成エンジン）

`company-data/`（自社の正本データ）・`books/<bookId>/`（BOOK とページ）・`shared/`（共通部品）から、
1 ページ（または 1 冊）の HTML 文書を合成するエンジンです。
PNG/PDF 出力（`npm run render`）、検証（`npm run validate`）、プレビュー（`npm run dev`）はすべてこのエンジンを使います。

## 3 層モデル

最終ページは「1 枚の画像」ではなく、次の 3 層を重ねて作ります（構想: `docs/concept.md` 7 章）。

| 層 | 名前 | 何で作るか | どこに書くか | DOM |
| --- | --- | --- | --- | --- |
| Layer 1 | BASE VISUAL | AI 生成画像（背景・光・質感・写真合成） | `books/<id>/backgrounds/` + `page.yaml` の `background` | `.layer.layer-base > img.base-image` |
| Layer 2 | STRUCTURE | HTML / CSS / SVG（カード・罫線・色面・パネル） | `page.html` + `page.css` / `shared/` | `.layer.layer-main > .trim` |
| Layer 3 | CONTENT | HTML（見出し・本文・数字・氏名・URL・QR） | `page.html` から `{{facts...}}` 等で参照 | `.layer.layer-main > .trim` |

- **表現力は画像生成、正確性はコード。** 生成画像に文字を入れない（文字は必ず Layer 3）。
- 学校名・数字・学科名などの事実は `page.html` に直書きせず、必ず `{{facts...}}` で `company-data/` を参照する。

### 合成される DOM

```html
<body class="studio mode-render|mode-preview [show-guides]" data-book="...">
  <div class="page" data-book="brochure" data-page="page_001" data-side="right" data-type="cover" data-number="1">
    <div class="layer layer-base"><img class="base-image" src="books/.../page_001.png"></div>  <!-- Layer 1: 塗り足しまで全面 -->
    <div class="layer layer-main"><div class="trim"> …page.html の描画結果… </div></div>      <!-- Layer 2 + 3 -->
    <div class="layer layer-guides">…</div>                                                       <!-- guides: true のときだけ -->
  </div>
</body>
```

- `.page` の大きさ = 仕上がり + 2 × 塗り足し（A4・塗り足し 3mm なら 216 × 303mm）。
- `.trim` は塗り足し分だけ内側にあり、**著者は仕上がり座標で配置する**。
- `data-side` はページ番号と `binding` から決まる（左綴じ: 奇数 = 右、偶数 = 左／右綴じ: 逆／綴じなし: 常に右）。
  右ページはノド（inside）が左端、左ページはノドが右端。

### 文書の `<head>`（この順に読み込まれる）

1. `<base href>` — render: `baseUrl` を渡せばその URL（`npm run render` は 127.0.0.1 の HTTP 配信）、なければ `file://<root>/`、preview: `/`。アセット参照はすべて**ルート相対・先頭スラッシュなし**なので両モードで同じ HTML が使える
2. フォント — `@fontsource/noto-sans-jp`（400/500/700/900）・`@fontsource/noto-serif-jp`（400/700）。ネットワーク不要
3. `src/assets/base.css` — リセット、ページ・レイヤー、和文組版の既定、ガイド
4. `<style id="studio-vars">` — `@page { size: (W+2b)mm (H+2b)mm }` と `:root` の CSS 変数（ブランド色・書体 → 判型 → `book.yaml` の `theme`）
5. `book.yaml` の `styles`（`<link>`）
6. 各ページの `page.css`（`@scope (.page[data-page="page_NNN"])` でそのページに限定して埋め込む）

## CSS 変数とクラス

| 変数 | 内容 |
| --- | --- |
| `--color-primary` `--color-secondary` `--color-accent` `--color-text` `--color-muted` `--color-background` `--color-surface` | `company-data/brand/colors/colors.yaml` |
| `--font-heading` `--font-body` `--font-serif` `--font-number` | `company-data/brand/fonts/fonts.yaml` |
| `--trim-w` `--trim-h` `--bleed` `--safe` `--page-w` `--page-h` | 判型（mm） |
| `--margin-top` `--margin-bottom` `--margin-inside` `--margin-outside` | マージン（mm） |
| `--margin-left` `--margin-right` | ページの左右に応じてノド/小口を振り分けた値 |
| `--columns` `--gutter` `--column-w` | 段組 |

`book.yaml` の `theme: { "--color-accent": "#ff6600" }` で BOOK ごとに上書きできます。

| クラス | 用途 |
| --- | --- |
| `.bleed` | `.trim` 内の要素を塗り足し端まで全面に広げる |
| `.bleed-top` `.bleed-bottom` `.bleed-left` `.bleed-right` | その辺だけ塗り足し端まで出す（絶対配置要素用） |
| `.area-margins` / `.area-safe` | 版面（マージン内）／安全領域の絶対配置ボックス |
| `.grid-columns` | `--columns` / `--gutter` の CSS Grid |
| `.heading` `.phrase` | 見出し組（`palt`・文節改行）／文節改行だけ |
| `.num` `.serif` `.palt` | 数字用書体（等幅数字）／明朝／プロポーショナル詰め |

和文の既定: `line-break: strict`、見出しは `font-feature-settings: "palt"`・`word-break: auto-phrase`・`text-spacing-trim: trim-start`（`trim-both` は Chromium 141 未対応）、
本文 `p` は両端揃え（`text-justify` は Chromium 未対応のため指定しない）、`hanging-punctuation` は対応ブラウザのみ（Chromium 141 は未対応）。

## テンプレート（page.html）

Handlebars で書きます。データは次の形で渡されます。

```text
facts   company-data/facts/<name>.yaml の内容そのもの   例: {{facts.school.name}}、{{#each facts.courses.courses}}
brand   { colors, color_status, fonts, logos（配列）, logo（id -> logo） }   例: {{asset brand.logo.main.file}}
copy    company-data/copy/<name>.yaml の内容             例: {{copy.brochure.catch}}
photos  id -> photo（photos.yaml）                      例: {{photos.campus.caption}}
book    book.yaml（既定値補完済み）                        例: {{book.title}}
page    page.yaml + { number（1 始まり）, side }          例: {{page.number}}
```

### 厳格モード（事実の正確性）

存在しないキーを参照すると**エラーで止まり**、BOOK・ページ・ファイル位置・キー名を表示します。

```text
[テンプレートエラー book=brochure page=page_003 at books/brochure/pages/page_003/page.html:12:7] キー "facts.school.fax" がデータに存在しません …
```

- 出力 `{{...}}`、ヘルパーの引数とハッシュ値、`{{#each}}` 等の対象、`as |x|` 経由の参照はすべて厳格。
- **`{{#if x}}` / `{{#unless x}}` の第 1 引数だけは、無ければ偽**として扱う（任意項目の出し分け用）。
- 出力は既定で HTML エスケープ。`{{{...}}}` は使わない（必要なら `nl2br` 等のヘルパーを使う）。

### ヘルパー

| ヘルパー | 例 | 結果 |
| --- | --- | --- |
| `asset` | `{{asset "books/brochure/backgrounds/page_001.png"}}` | ルート相対 URL。ファイルが無い・ルート外ならエラー |
| `photo` | `{{photo "campus"}}` | `photos.yaml` の写真 URL。未知の ID・ファイル無しはエラー |
| `qr` | `{{qr facts.school.url size=22}}` | インライン `<svg class="qr">`（`size` は mm、`margin` `ecl` `dark` `light` も可） |
| `num` | `{{num 12345}}` | `12,345`（数値以外はそのまま） |
| `nl2br` | `{{nl2br copy.brochure.lead}}` | エスケープ後に改行を `<br>` |
| `eq` | `{{#if (eq page.type "cover")}}` | 厳密等価 |
| `join` | `{{join tags " / "}}` | 配列を連結（区切り省略時は「、」） |

### パーシャル

- `shared/components/**/*.hbs` → `shared/components` からの相対パス（拡張子なし）。例: `{{> stat-card}}`、`{{> cards/photo-card}}`
- `books/<id>/components/*.hbs` → `book/<名前>`。例: `{{> book/page-number}}`

### page.css

ページ専用の CSS。合成時に `@scope (.page[data-page="page_NNN"]) { … }` で包むため、
1 冊にまとめた PDF でも他ページに影響しません。相対 `url()` は page.css の位置基準でルート相対に書き換えます。
`@import` は使えません（共通 CSS は `book.yaml` の `styles` へ）。

## API（`src/index.ts`）

```ts
import {
  composePage, composeBook,               // 合成
  loadCompanyData, loadBook, loadPage, listBooks, loadReferences, // 読み込み
  pageGeometry, renderPixelSize, renderViewport,                 // 判型
  findRepoRoot, resolveStudioRoot, resolveInRoot,                // パス
  writeTempHtml,                                                  // Playwright 用（baseUrl なしで合成したとき）
} from '../design-engine/src/index.ts';
```

### 合成

```ts
composePage({ root, bookId, pageId, mode: 'render' | 'preview', guides?: boolean, baseUrl?: string }): { html: string; warnings: string[] }
composeBook({ root, bookId, pageIds?, mode, guides?, baseUrl? }): { html: string; warnings: string[]; pageIds: string[] }
buildTemplateContext(company, bookConfig, pageConfig, pageNumber): TemplateContext
baseHref(root, mode, baseUrl?): string
```

- 同期関数。データ・テンプレートの問題は `StudioError`（`issues` 付き）／`TemplateError`（`book` `page` `file` `key` `line` 付き）を投げる。
- `warnings`: 本文に `TODO` がある、色が未確定（`TODO:`）で仮色を使った、未知のキー等。
- `composeBook` のページ順は常に `book.yaml` の `pages` 順。ページごとに CSS 改ページ（`break-after: page`）。

### 読み込み

```ts
loadCompanyData(root): CompanyData            // facts / brand / photos / photoList / copy / files
loadBook(root, bookId): LoadedBook            // { id, dir, relDir, configPath, config, warnings }
loadPage(root, bookId, pageId): LoadedPage    // { id, config, template, templatePath, css, cssPath, ... }
listBooks(root): string[]                     // books/ 配下の config/book.yaml を持つディレクトリ（ネスト ID 対応）
loadReferences(root, bookId): BookReferences | null      // books/<id>/references.yaml
loadReferenceSource(root, 'references/HAL/brochure'): ReferenceSource
listReferenceSources(root): string[]          // source.yaml を持つ references/<source>/<kind>
loadAnalysis(root, relPath): Analysis
readYamlFile(abs, label) / loadYamlWithSchema(abs, schema, label)
walkStrings(obj) / collectTodos(obj)          // validate・--release 用
```

### 判型（mm）

```ts
pageGeometry(format): PageGeometry   // trimWidthMm, trimHeightMm, bleedMm, boxWidthMm(=W+2b), boxHeightMm, margins, columns, ...
trimSizeMm(format) / pageSide(number, binding) / sideMargins(geometry, side)
mmToCssPx(mm) / mmToPixels(mm, dpi)
renderPixelSize(geometry, dpi)       // { width: round((W+2b)/25.4*dpi), height: ... }
renderViewport(geometry, dpi)        // Playwright 用 { width, height（CSS px）, deviceScaleFactor: dpi/96 }
pngDeviceScaleFactor(geometry, dpi)  // PNG 撮影用の倍率（dpi/96 を基本に、CSS px の整数に丸めて描かれるページが目標の画素数を覆うよう微調整）
formatCssVars(geometry)
```

判型: `A3` 297×420、`A4` 210×297、`A5` 148×210、`B4` 257×364、`B5` 182×257（B は JIS）。
`orientation: landscape` で幅と高さを入れ替え。`custom` は `width_mm`/`height_mm` をそのまま使う。

### パス

```ts
findRepoRoot(start?)          // package.json の name が publishing-studio のディレクトリ
resolveStudioRoot(root?)      // --root（省略時リポジトリルート）を絶対パスに
resolveInRoot(root, relPath)  // ルート外・絶対パス・".."・スキーム付き・シンボリックリンク脱出を拒否
listBookIds(root) / bookRelDir(id) / pageRelDir(id, pageId) / bookFileName(id) / isValidBookId / isValidPageId
listInvalidBookDirs(root)     // config/book.yaml はあるが BOOK ID に使えない名前のディレクトリ（validate がエラーにする）
isReferencePath(rel) / findReferenceUrls(htmlOrCss, root, { baseDir?, css? })  // 参考資料（references/）を描画に使っていないかの検査
```

### スキーマ（zod v4、`src/schemas/`）

`SchoolSchema` `CoursesFileSchema` `TeachersFileSchema` `ResultsFileSchema` `ContactsFileSchema`
`ColorsFileSchema` `FontsFileSchema` `LogosFileSchema` `PhotosFileSchema`
`BookConfigSchema`（`BookFormatSchema`）`PageConfigSchema` `BookReferencesSchema`
`ReferenceSourceSchema` `AnalysisSchema` `BackgroundPromptSchema`、各型（`BookConfig` 等）。
`safeParseData(schema, data, label)` は日本語メッセージの issues（`ファイル: パス: メッセージ`）を返します。

- company-data と解析結果は未知キーを許容。book.yaml / page.yaml の未知キーは警告。
- 数値項目と色は `"TODO: ..."` プレースホルダを許容（色は描画時に仮のグレー + 警告）。
- YAML 内のパスはすべてルート相対・`/` 区切り・先頭スラッシュなし・`..` 禁止。

## Playwright で描画するとき（render モード）

`npm run render` は `baseUrl` を付けて合成し、127.0.0.1 の HTTP サーバー（`system/scripts/lib/studio-server.ts`）経由で開きます（`file://` を使わない。`file://` を禁止したブラウザでも同じ出力）。

`baseUrl` なしで合成した render モードの HTML は `file://` のフォント・画像を参照するため、**`page.setContent()` では読み込めません**。
`writeTempHtml(html)` でファイルに書き出し、`page.goto(file.url)` で開いてください（design-engine のテストはこの方法）。

```ts
const { html } = composePage({ root, bookId, pageId, mode: 'render' });
const file = writeTempHtml(html);
const vp = renderViewport(pageGeometry(book.config.format), dpi);
const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.deviceScaleFactor });
await page.goto(file.url);
await page.evaluate(() => document.fonts.ready);
// …撮影…
file.dispose();
```

`.page` の CSS px 幅は Chromium のレイアウト単位（1/64px）に丸められ、さらに描画時は CSS px の整数に丸められます
（216mm = 816.375px のページは 816px で描かれる）。`deviceScaleFactor: dpi/96` のままだと右端・下端に 1〜数 px の白い隙間が出るため、
PNG を撮るときは `pngDeviceScaleFactor()` を使い、最終 PNG は `renderPixelSize()` の値に切り出してください（`npm run render` はそうしています）。
Chromium のスクリーンショットは約 1.3 億画素を超えると下側が描かれないまま返るため、`npm run render` は 1 枚 1 億画素までに制限しています。

## プレビュー（npm run dev）

```bash
npm run dev                                         # リポジトリルートをプレビュー
STUDIO_ROOT=system/fixtures/studio npm run dev      # fixture などの別スタジオ
```

| URL | 内容 |
| --- | --- |
| `/` | BOOK とページの一覧 |
| `/preview/<bookId>/<pageId>` | 1 ページ（`?guides=1` でガイド表示） |
| `/preview/<bookId>` | BOOK 全ページ |
| `/@engine/...` | エンジン同梱アセット（base.css・フォント） |

`company-data/`・`books/`・`shared/`・`system/design-engine/src/assets/` の変更で自動的にフルリロードします
（`output/`・`reviews/` への書き込みでは再読み込みしません）。

## ファイル構成

```text
src/
  index.ts          公開 API
  schemas/          zod スキーマと型
  paths.ts          ルート探索・BOOK 列挙・安全なパス解決
  load.ts           YAML 読み込み（company-data / books / references）
  format.ts         判型 → 寸法（mm）・CSS 変数
  template.ts       厳格 Handlebars 環境・ヘルパー・パーシャル
  compose.ts        composePage / composeBook
  engine-assets.ts  base.css・フォントの場所と URL
  html-file.ts      一時 HTML ファイル（Playwright 用）
  vite-plugin.ts    プレビュー用 Vite プラグイン
  assets/base.css   基本スタイル
test/               vitest（fixture: system/fixtures/studio）
vite.config.ts      npm run dev の設定
```

テスト: `npx vitest run system/design-engine`（Chromium で実寸・フォント読み込み・PDF ページ数も確認します）。
