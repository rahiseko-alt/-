# shared/layouts — 共通 CSS

全 BOOK で使うレイアウト・組版の CSS です。BOOK は `config/book.yaml` の `styles` に、使うファイルをリポジトリルート相対で列挙します。

```yaml
styles: [shared/layouts/grid.css, shared/layouts/typography.css, shared/layouts/components.css]
```

| ファイル | 内容 |
| --- | --- |
| `grid.css` | 版面グリッド（`.grid` と `.col-N` / `.start-N`）、絶対配置の補助（`.x-col-N` / `.w-cols-N` など） |
| `typography.css` | 和文組版の役割別クラス（`.t-display` 〜 `.t-note`）、書体・ウェイト、縦組み、文字色 |
| `components.css` | shared/components/*.hbs の既定スタイルと Layer 2 の部品（`.panel` `.rule` `.bg-*`） |

## 読み込み順と上書き

ページの HTML では次の順に CSS が読み込まれます（後ろほど優先）。

1. エンジンの `system/design-engine/src/assets/base.css`（リセット、ページ寸法、レイヤー、和文組版の既定、ガイド）
2. `:root` の CSS 変数（ブランド色・書体 → 判型 → book.yaml の `theme`）
3. book.yaml の `styles`（このディレクトリのファイルなど）
4. ページの `page.css`（そのページだけに効く `@scope`）

このディレクトリの CSS は `:root` に変数を定義しません。サイズ等は `var(--fs-body, 9.5pt)` のように既定値つきで参照するので、book.yaml の `theme` で上書きできます。

```yaml
theme:
  "--fs-body": "9pt"
  "--lh-body": "1.8"
```

## 座標系と使える変数

- 著者が配置する基準は `.trim`（仕上がり線の左上が原点、単位は mm）。塗り足しまで広げる要素には `.bleed`（base.css）を付ける
- 判型の変数（compose が book.yaml の `format` から出力）:
  `--trim-w` `--trim-h` `--bleed` `--safe` `--page-w` `--page-h`
  `--margin-top` `--margin-bottom` `--margin-inside` `--margin-outside` `--columns` `--gutter` `--column-w`
- ページの左右で決まる変数（base.css）: `--margin-left` `--margin-right`（右ページはノド = 左、左ページはノド = 右）
- 色: `--color-primary` `--color-secondary` `--color-accent` `--color-text` `--color-muted` `--color-background` `--color-surface`
- 書体: `--font-heading` `--font-body` `--font-serif` `--font-number`

## grid.css

```html
<div class="grid">                       <!-- .trim 直下。マージン内に --columns 段 -->
  <h1 class="col-12 t-h1">…</h1>
  <div class="col-8">…</div>
  <div class="col-4">…</div>
  <div class="col-5 start-8">…</div>     <!-- 8 段目から 5 段分 -->
</div>

<div class="abs x-col-3 w-cols-4" style="top: 120mm">…</div>   <!-- 3 段目の左端から 4 段分の幅 -->
```

| クラス | 内容 |
| --- | --- |
| `.grid` | 版面（マージン内）に絶対配置した CSS Grid。段間 `--gutter`、行間 `--row-gap`（既定 = 段間） |
| `.grid--rows` | 行も `--grid-rows`（既定 12）で等分するモジュラーグリッド |
| `.grid-flow` | 通常フローの段組（高さは内容なり） |
| `.subgrid` | 入れ子の段組（段数 `--sub-columns`、既定 2） |
| `.col-1` 〜 `.col-12` / `.col-full` | N 段分の幅 / 全幅 |
| `.start-1` 〜 `.start-12` | 開始段 |
| `.row-1` 〜 `.row-12` / `.row-start-1` 〜 `.row-start-12` | 行の範囲（`.grid--rows` と併用） |
| `.abs` / `.fill` | 絶対配置 / `.trim` 全面 |
| `.x-col-1` 〜 `.x-col-12` | 絶対配置要素の左端を N 段目にそろえる |
| `.w-cols-1` 〜 `.w-cols-12` | 絶対配置要素の幅を N 段分にする |
| `.y-margin-top` / `.y-margin-bottom` | 版面の上端・下端にそろえる |
| `.inset-safe` | 安全領域の内側いっぱい |
| `.self-start` など | グリッド内の縦位置 |

段数は book.yaml の `format.columns`（既定 12）です。段数を変えた BOOK では `--columns` を超える N を使わないでください。base.css の `.area-margins`（版面の箱）と `.grid-columns`（段組だけ）も使えます。

## typography.css

| クラス | 既定（変数） | 用途 |
| --- | --- | --- |
| `.t-display` | 40pt / 900（`--fs-display`） | 表紙・扉の大見出し |
| `.t-h1` | 24pt / 700（`--fs-h1`） | ページタイトル |
| `.t-h2` | 16pt / 700（`--fs-h2`） | 中見出し |
| `.t-h3` | 12pt / 700（`--fs-h3`） | 小見出し |
| `.t-lead` | 11pt / 500、行送り 1.8（`--fs-lead`） | リード文 |
| `.t-body` / `.t-body-serif` | 9.5pt / 400、行送り 1.75（`--fs-body` `--lh-body`） | 本文（ゴシック / 明朝） |
| `.t-caption` | 7.5pt（`--fs-caption`） | キャプション |
| `.t-note` | 6.5pt（`--fs-note`） | 注記・出典（最小サイズ） |
| `.t-en` | 9pt（`--fs-en`） | 欧文ラベル |
| `.t-num-xl` / `.t-num-l` | 44pt / 28pt | 大きな数字 |
| `.ff-heading` `.ff-body` `.ff-serif` `.ff-number` | | 書体の切り替え |
| `.fw-regular` `.fw-medium` `.fw-bold` `.fw-black` | 400 / 500 / 700 / 900 | ウェイト（Serif は 400 / 700 のみ） |
| `.no-palt` `.nowrap` `.balance` `.pretty` | | 詰め・改行の調整 |
| `.ta-left` `.ta-center` `.ta-right` | | 揃え（本文の既定は両端揃え） |
| `.vertical` / `.tcy` | | 縦組み / 縦中横 |
| `.c-primary` 〜 `.c-muted` / `.c-inverse` | | 文字色 |

見出し（`h1`〜`h6`、`.heading`）の palt・文節改行、本文の両端揃え、禁則（`line-break: strict`）は base.css が既定で適用します。数値の規定（最小サイズ・行送り）は system/rules/typography-ja.md を参照してください。

## components.css

パーシャルのクラスは shared/components/README.md を参照。Layer 2 の部品:

| クラス | 内容 |
| --- | --- |
| `.bg-primary` `.bg-secondary` `.bg-accent` `.bg-surface` `.bg-paper` | 色面 |
| `.panel` / `.panel--dark` | 背景画像の上に文字を載せる半透明パネル（`--panel-color` `--panel-opacity` `--panel-padding`） |
| `.rule` / `.rule--thin` / `.rule--muted` | 罫線（`<hr class="rule">`。`--rule-width` `--rule-color`） |

## 変更するとき

- ここは全 BOOK に影響します。変更後は全 BOOK を `npm run render -- --book <id> --format png` で再出力し、差分を確認してください
- BOOK 固有の調整はここではなく、その BOOK の `page.css` か BOOK 独自の CSS（`books/<id>/` 内に置き `styles` に追加）で行います
