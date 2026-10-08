# shared/components — 共通パーシャル

全 BOOK から使える Handlebars パーシャルです。BOOK をまたいで再利用する部品だけをここに置きます（docs/concept.md §14-10「デザインを資産にする」）。

- 登録名は `shared/components/` からの相対パス（拡張子なし）。例: `stat-card.hbs` → `{{> stat-card}}`、`cards/photo-card.hbs` → `{{> cards/photo-card}}`
- BOOK 固有の部品は `books/<bookId>/components/<名前>.hbs` に置き、`{{> book/<名前>}}` で呼びます
- 既定スタイルは `shared/layouts/components.css` にあります。`npm run new:book` で作った BOOK の `styles` には最初から入っています（手で作った BOOK や、外した場合は `book.yaml` の `styles` に追加してください）

```yaml
styles: [shared/layouts/grid.css, shared/layouts/typography.css, shared/layouts/components.css]
```

## 厳格モードでの書き方（必読）

テンプレートは厳格モードで描画されます（system/rules/page-layers.md）。

- パーシャル内で参照するキーが存在しないと、BOOK・ページ・キー名つきのエラーで止まります
- 呼び出し側で `key=値` として渡した値（ハッシュ引数）も厳格に評価されます。**存在しないキーを渡すとエラー**です
  - 例: 単位のない指標で `unit=this.unit` と書くとエラー → 指標オブジェクトを丸ごと `{{> stat-card this}}` で渡す
- 任意パラメータはパーシャル内で `{{#if 名前}}` で囲みます（`#if` / `#unless` の第 1 引数だけは「無ければ偽」）
- `{{#if (eq variant "dark")}}` のようにサブ式に任意パラメータを渡すとエラーになるので、`{{#if variant}}...{{variant}}...{{/if}}` の形にする
- パラメータはページの文脈（`facts` `page` など）と合成されます。ループ内で呼ぶと外側の同名キーが見えることがあるため、パラメータ名は表の名前だけを使ってください
- 学校名・数値などの事実をパーシャルに直書きしない。必ず呼び出し側から company-data の値を渡す

新しいパーシャルを追加したら、この README の表に必須・任意パラメータを追記してください。

---

## stat-card

数値カード。Layer 2 の面・罫線と、Layer 3 のラベル・数値を持ちます。

| パラメータ | 必須 | 内容 |
| --- | --- | --- |
| `label` | 必須 | 指標名 |
| `value` | 必須 | 値。数値なら `{{num}}` で桁区切り（`1,234`）。文字列はそのまま |
| `unit` | 任意 | 単位（`%`、`名` など） |
| `note` | 任意 | 注記 |
| `as_of` | 任意 | 基準日・年度 |
| `source` | 任意 | 出典 |
| `variant` | 任意 | `accent` / `inverse` / `outline` |

`facts.results.metrics` の各要素はこのパラメータ名と同じ形なので、そのまま渡せます。

```hbs
<div class="grid">
  {{#each facts.results.metrics}}
  <div class="col-4">{{> stat-card this}}</div>
  {{/each}}
</div>

{{> stat-card label=facts.results.metrics.0.label value=facts.results.metrics.0.value variant="accent"}}
```

## section-heading

セクション見出し（`<header>` + `<h2>`）。

| パラメータ | 必須 | 内容 |
| --- | --- | --- |
| `title` | 必須 | 見出し。改行を含めると `<br>` になる（`{{nl2br}}`） |
| `number` | 任意 | セクション番号（`"01"` など） |
| `en` | 任意 | 欧文の小見出し（大文字で表示） |
| `lead` | 任意 | リード文。改行は `<br>` |
| `variant` | 任意 | `inverse`（濃い面の上の白抜き）/ `center`（中央揃え） |

```hbs
{{> section-heading title=page.title en="COURSE" number="01"}}
{{> section-heading title=copy.main.catchphrase lead=copy.main.lead variant="inverse"}}
```

## photo-frame

写真枠（`<figure>`）。画像そのものは Layer 1 の素材で、枠・比率・キャプションを Layer 2/3 として扱います。

| パラメータ | 必須 | 内容 |
| --- | --- | --- |
| `id` | どちらか | company-data/photos/photos.yaml の写真 ID。`{{photo id}}` で解決（未登録ならエラー） |
| `src` | どちらか | リポジトリルート相対の画像パス（`shared/generated-assets/...` など）。`{{asset src}}` で解決（ファイルがなければエラー） |
| `ratio` | 任意 | 縦横比（CSS `aspect-ratio`。例: `"4 / 3"`） |
| `position` | 任意 | トリミング位置（CSS `object-position`。例: `"50% 30%"`） |
| `alt` | 任意 | 代替テキスト |
| `caption` | 任意 | キャプション |
| `variant` | 任意 | `round`（角丸）/ `bleed`（塗り足しまで全面。`.trim` 直下で使う） |

- `id` と `src` の両方を省くと「TODO: 写真未設定」のプレースホルダになります。本文に `TODO` が残るため `npm run render -- --book <id> --release` は失敗します（写真待ちの出し忘れ防止）
- 参考資料（`references/`）の画像を `src` に指定してはいけません（system/rules/references.md。`npm run validate` / `npm run render` がエラーにします）
- `id` を指定したのに写真が未登録の場合はエラーです。写真待ちの間は `id` を渡さずプレースホルダにしてください

```hbs
{{> photo-frame id="campus-exterior" ratio="3 / 2" caption=facts.school.name}}
{{> photo-frame src="shared/generated-assets/texture-paper-01.png" ratio="1 / 1"}}
{{> photo-frame ratio="4 / 3"}}
```

## qr-block

QR コード + 説明。QR は `{{qr}}` ヘルパーで SVG として生成します（画像に焼き込まない）。

| パラメータ | 必須 | 内容 |
| --- | --- | --- |
| `url` | 必須 | QR にする文字列。company-data の値を渡す |
| `label` | 任意 | 説明（「公式サイト」など） |
| `caption` | 任意 | 補足表示（URL の文字列など） |
| `size` | 任意 | 一辺の長さ（mm）。既定 20。印刷物では 15mm 以上を目安にする |

```hbs
{{> qr-block url=facts.school.url label="公式サイト" caption=facts.school.url}}
{{> qr-block url=facts.contacts.contacts.0.url size=18}}
```

`url` に `TODO` が含まれる間は、描画時に警告が出ます。

## folio

ノンブル（ページ番号）と学校名。`.trim` の直下に置くと、下端の小口側に絶対配置されます。

| パラメータ | 必須 | 内容 |
| --- | --- | --- |
| `number` | 必須 | ページ番号（`page.number` = book.yaml の pages での順番、1 始まり） |
| `school` | 必須 | 学校名（`facts.school.name` を渡す。直書きしない） |
| `side` | 任意 | `left` / `right`。`page.side` を渡すと小口側に寄せる（省略時は右寄せ） |
| `variant` | 任意 | `inverse`（濃い背景の上の白抜き） |

```hbs
{{> folio number=page.number school=facts.school.name side=page.side}}
```

位置は CSS 変数 `--folio-bottom`（既定 7mm）と `--margin-outside` で決まります。
