# ページの 3 層構造

最終ページを「1 枚の画像」で作らず、3 層に分けて組み立てます（docs/concept.md §7〜8）。
**表現力は画像生成、正確性はコード。**

## 1. 各層の担当

| 層 | 名前 | 作り方 | 置くもの |
| --- | --- | --- | --- |
| Layer 1 | BASE VISUAL | AI 画像生成・写真（画像ファイル） | 背景、写真、生成ビジュアル、グラデーション、光、テクスチャ、複雑な装飾、写真と背景の融合表現 |
| Layer 2 | STRUCTURE | HTML / CSS / SVG | カード、枠、罫線、半透明パネル、単純図形、マスク、色面、本文量に応じてサイズが変わる領域 |
| Layer 3 | CONTENT | HTML（テキスト）・SVG（QR） | 見出し、本文、数字、学科名、氏名、企業名、URL、ページ番号、QR コード、キャプション |

### 迷ったときの判定

| 要素 | 層 | 理由 |
| --- | --- | --- |
| 文字・数字が少しでも含まれる | Layer 3 | 画像生成は文字を壊す。修正のたびに再生成になる |
| 文章量で大きさ・位置が変わる面や枠 | Layer 2 | 背景に焼き込むと文章を変えたときに合わなくなる |
| 単色・単純なグラデーションの面、直線、円、矢印 | Layer 2 | CSS / SVG で正確に、色をブランドカラーに追従させる |
| 質感・光・ぼかし・複雑な模様・写真の合成 | Layer 1 | コードで描くと弱くなる |
| 学校の写真 | Layer 1（素材）＋ Layer 2（枠） | 写真は company-data/photos。枠・比率・トリミングは HTML/CSS |
| ロゴ | Layer 3 相当（正式データを配置） | company-data/brand/logo の正式データだけを使う。生成しない |

## 2. DOM とファイルの対応

ページは `npm run render` / `npm run dev` のたびに次の構造に合成されます（system/design-engine/src/compose.ts）。

```html
<div class="page" data-book="brochure" data-page="page_001" data-side="right" data-type="cover" data-number="1">
  <div class="layer layer-base">               <!-- Layer 1: page.yaml の background.image（塗り足しまで全面） -->
    <img class="base-image" src="books/brochure/backgrounds/page_001.png" alt="">
  </div>
  <div class="layer layer-main">
    <div class="trim">                          <!-- Layer 2 + 3: page.html の描画結果 -->
      …
    </div>
  </div>
  <div class="layer layer-guides">…</div>      <!-- --guides / ?guides=1 のときだけ -->
</div>
```

| 層 | 書く場所 |
| --- | --- |
| Layer 1（全面背景） | `books/<id>/backgrounds/<pageId>.png` ＋ `<pageId>.prompt.yaml`、`page.yaml` の `background` |
| Layer 1（部分素材・写真） | `page.html` 内の `<img src="{{photo "id"}}">`、`{{> photo-frame ...}}`、`{{asset "shared/generated-assets/..."}}` |
| Layer 2 | `page.html` の要素と `page.css`、共通 CSS（`shared/layouts/`）、共通部品（`shared/components/`） |
| Layer 3 | `page.html` 内の `{{facts...}}` `{{copy...}}` などの参照と、事実ではない見出し・文章 |

```yaml
# page.yaml
id: page_001
title: 表紙
type: cover
background:
  image: books/brochure/backgrounds/page_001.png   # リポジトリルート相対
  fit: cover            # cover | contain
  position: center      # CSS object-position
  opacity: 1
status: draft           # draft | review | approved
notes: ""
```

## 3. 座標と寸法

- `.trim` が仕上がりサイズの座標系（左上が原点）。寸法は **mm**、文字サイズは **pt** で書く
- `.page` は仕上がり + 塗り足し（`--bleed`、既定 3mm）。背景（Layer 1）は塗り足しまで覆う
- 仕上がり線まで届く色面・写真は `.bleed`（全方向）や `.bleed-top` などで塗り足しまで広げる。仕上がり線ぴったりで止めない
- 文字・ロゴ・QR・ページ番号は安全領域（仕上がり線から `--safe`、既定 5mm）の内側に置く。本文は版面（マージン内）に置く
- 左右のマージンは見開きで振り分けられる（右ページ: 左 = ノド、左ページ: 右 = ノド）。`var(--margin-left)` / `var(--margin-right)` を使い、ノド側に文字を寄せすぎない
- 段組は `shared/layouts/grid.css` の `.grid` と `.col-N` を使い、勝手な寸法を増やさない
- 確認は `npm run dev` の `?guides=1`、または `npm run render -- --book <id> --guides --out <一時ディレクトリ>`

## 4. テンプレート（page.html）の書き方

- `page.html` は Handlebars テンプレート。使えるデータ: `facts` `brand` `copy` `photos` `book` `page`（`page.number` = 1 始まりのページ番号、`page.side` = `left` / `right`）
- 厳格モード: 存在しないキーの参照はエラー。任意項目は `{{#if ...}}` で囲む
- ヘルパー: `asset` `photo` `qr` `num` `nl2br` `eq` `join`（詳細は docs/architecture.md）
- 出力は HTML エスケープされる。HTML を直接出したい箇所はテンプレートに直接書く（データ側に HTML を書かない）
- 事実（学校名・数字・連絡先・学科名・氏名・企業名）は必ず `{{facts...}}` で参照する
- `<script>` は使わない（描画結果を静的に保つ）
- CSS は `page.css`（そのページに `@scope` される）か共通 CSS に書く。`style` 属性は位置・寸法の微調整に限る

## 5. 禁止事項

- 文字・数字・ロゴ・QR を含む画像を背景や素材に使う
- ページ全体を 1 枚の画像で作る、スクリーンショットを貼る
- 文章量で変わる枠・カードを背景画像に描き込む
- 参考資料の画像をそのままページの描画に使う（参考画像は比較・目視・画像生成の参照入力に使い、生成した結果を Layer 1 に置く）
- 単純な面・線のために画像を生成する（CSS / SVG で作る）

## 6. チェックリスト

- [ ] 背景画像に文字が入っていない（拡大して確認）
- [ ] すべての事実が `{{facts...}}` / `{{copy...}}` / `{{photo ...}}` 参照になっている（`npm run validate` の警告なし）
- [ ] 文字が安全領域の内側、本文が版面の内側にある（ガイド表示で確認）
- [ ] 仕上がり線まで届く要素が塗り足しまで伸びている
- [ ] 文章を 2 割増やしてもあふれない、または Layer 2 の枠が追従する
- [ ] 背景画像に `.prompt.yaml` がある
