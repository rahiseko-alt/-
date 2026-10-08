# books — 制作する BOOK

BOOK は実際に制作する成果物の単位です（パンフレット、募集要項、チラシ、ポスターなど。docs/concept.md §6）。
`config/book.yaml` を持つディレクトリが 1 つの BOOK になり、ネストもできます（例: `books/flyers/open-campus/`）。

現在は Phase 5（完コピ検証）用の `replica/` だけです（12 BOOK・各 1 ページ。参考ページとの対応は references/README.md。文字はダミー、写真は枠のみ。比較の記録と次にやることは各 `reviews/page_001/review.md`）。自社の BOOK は Phase 8 以降に `npm run new:book` で作ります。

## 作り方

```bash
npm run new:book -- brochure --kind brochure --title "学校案内" --size A4 --orientation portrait --pages 4
npm run new:book -- flyers/open-campus --kind flyer --title "（チラシのタイトル）" --size A4 --pages 2
```

| 引数 | 既定 | 内容 |
| --- | --- | --- |
| `<bookId>`（1 番目） | — | BOOK ID = `books/` からの相対パス（system/rules/naming.md §2） |
| `--kind` | `brochure` | `brochure` `admissions` `flyer` `poster` `guide` `event` `other` |
| `--title` | | タイトル |
| `--size` | `A4` | `A3` `A4` `A5` `B4` `B5`（JIS）。`custom` は作成後に book.yaml で `width_mm` / `height_mm` を指定 |
| `--orientation` | `portrait` | `portrait` / `landscape` |
| `--pages` | `4` | 最初に作るページ数 |

`system/templates/book/` と `system/templates/page/` から作られます。同じ BOOK ID がすでにあると作成を拒否します。

ページの追加:

```bash
npm run new:page -- --book brochure --after page_003 --type course --title "学科紹介"
```

空いている次のページ ID（`page_NNN`）で作られ、`book.yaml` の `pages` の `--after` の位置に挿入されます（コメントは保持）。

## BOOK の構成

```text
books/<bookId>/
├─ config/book.yaml          判型・塗り足し・マージン・段組・CSS・ページ順・出力解像度
├─ references.yaml           使う参考資料（BOOK 全体・ページ単位）
├─ backgrounds/              Layer 1 の背景画像 + 生成記録（page_001.png + page_001.prompt.yaml）
├─ pages/
│  └─ page_001/
│     ├─ page.yaml           タイトル・種別・背景・状態
│     ├─ page.html           Layer 2 + 3（Handlebars テンプレート）
│     └─ page.css            そのページだけの CSS（任意。自動で @scope される）
├─ components/               BOOK 固有のパーシャル（*.hbs → {{> book/<名前>}}）
├─ reviews/                  レビュー記録（<pageId>/review.md）と比較出力（<pageId>/compare-*/。比較画像はコミットしない）
└─ output/                   出力（png/<pageId>.png、pdf/<BOOK 名>.pdf）
```

### config/book.yaml

```yaml
id: brochure                 # BOOK ID と一致
title: 学校案内
kind: brochure
format:
  size: A4
  orientation: portrait
  bleed_mm: 3
  safe_mm: 5
  margins_mm: { top: 15, bottom: 15, inside: 18, outside: 15 }
  columns: 12
  gutter_mm: 4
  binding: left              # left | right | none
styles: [shared/layouts/grid.css, shared/layouts/typography.css, shared/layouts/components.css]
theme: {}                    # CSS 変数の上書き（例: { "--fs-body": "9pt" }）
pages: [page_001, page_002, page_003, page_004]   # この順番がページ番号
output:
  png_dpi: 350
  preview_dpi: 150
notes: ""                    # BOOK の状態・次にやること
```

- ページの順番は `pages` の並び。ページ ID の数字ではない（ID は付け直さない）
- 見開きの左右は順番と `binding` で決まる（左綴じ: 奇数ページ = 右）
- 共通部品（shared/components）の既定スタイルは `shared/layouts/components.css`。`npm run new:book` の雛形では `styles` に最初から入っている（外さない）

### page.html の書き方

```hbs
<div class="grid">
  <div class="col-12">{{> section-heading title=page.title en="COURSE"}}</div>
  {{#each facts.courses.courses}}
  <article class="col-6">
    <h3 class="t-h3">{{name}}</h3>
    <p class="t-body">{{description}}</p>
  </article>
  {{/each}}
</div>
{{> folio number=page.number school=facts.school.name side=page.side}}
```

| 使えるデータ | 内容 |
| --- | --- |
| `facts` | company-data/facts/*.yaml（`facts.school.name`、`facts.courses.courses` など） |
| `brand` | `brand.colors`、`brand.fonts`、`brand.logos`、`brand.logo.<id>` |
| `copy` | company-data/copy/*.yaml（`copy.main.catchphrase` など） |
| `photos` | 写真 ID → 写真情報 |
| `book` | この BOOK の book.yaml |
| `page` | page.yaml ＋ `page.number`（1 始まり）・`page.side`（`left` / `right`） |

| ヘルパー | 例 | 内容 |
| --- | --- | --- |
| `asset` | `{{asset "shared/generated-assets/x.png"}}` | ルート相対パスを URL に（ファイルがなければエラー） |
| `photo` | `{{photo "campus-exterior"}}` | company-data の写真 ID を URL に（未登録ならエラー） |
| `qr` | `{{qr facts.school.url size=20}}` | QR コードの SVG（`size` は mm） |
| `num` | `{{num value}}` | 数値を `1,234` 形式に |
| `nl2br` | `{{nl2br copy.main.lead}}` | 改行を `<br>` に（エスケープ済み） |
| `eq` / `join` | `{{#if (eq page.type "cover")}}`、`{{join tags "・"}}` | 比較 / 配列の連結 |

- **厳格モード**: 存在しないキーを参照するとエラー（BOOK・ページ・キー名が表示される）。任意項目は `{{#if}}` で囲む
- 事実（学校名・数字・連絡先など）は必ず `facts` から参照する。直書きは `npm run validate` が警告する
- 3 層の分担は system/rules/page-layers.md

## よく使うコマンド

```bash
npm run dev                                                  # プレビュー http://localhost:5173/
npm run render -- --book brochure                            # PNG + PDF
npm run render -- --book brochure --page page_001 --format png
npm run compare -- --book brochure --page page_016           # 参考ページと比較
npm run validate                                             # 全 BOOK の検証
```

## してはいけないこと

- company-data の値を BOOK に書き写す
- 参考資料の画像そのもの（コピー・切り出し）・文章・固有名詞を BOOK に入れる（参考ページ画像を画像生成の参照入力にして作った Layer 1 背景は可。system/rules/image-generation.md §3。forbidden_terms は validate でエラー。参考画像をページの描画に使うのも validate / render でエラー。`npm run compare` の比較画像も参考ページの画素を含むため `.gitignore` 済みでコミットしない）
- BOOK ごとに company-data や参考資料をコピーする
- 文字を含む画像を背景に使う
