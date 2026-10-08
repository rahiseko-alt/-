# 自社データ（company-data）のルール

`company-data/` は AIビジネス専門学校の情報の唯一の正本です（docs/concept.md §4）。記入方法とキーの一覧は company-data/README.md、スキーマは `system/design-engine/src/schemas/company.ts` にあります。

## 1. 単一の正本

- 学校名・住所・電話番号・URL・学科・教員・実績・ブランドカラー・書体・ロゴ・写真・共通コピーは `company-data/` にだけ書く
- BOOK・shared には値を書かず、テンプレートから参照する
  - 事実: `{{facts.school.name}}`、`{{#each facts.courses.courses}}...{{/each}}`
  - 共通コピー: `{{copy.main.catchphrase}}`（改行あり: `{{nl2br copy.main.lead}}`）
  - 写真: `{{photo "<写真ID>"}}`、ロゴ: `{{asset brand.logo.<ID>.file}}`
  - 色・書体: CSS で `var(--color-primary)`、`var(--font-heading)`
- 同じ値を 2 か所に書かない。BOOK 用に言い回しを変えたい文は、BOOK の `page.html` に書いてよい（事実ではない文に限る）。数値・固有名詞・連絡先は必ず参照にする

## 2. 事実の正確性

- 値は学校から受け取った資料・学校担当者の確認にもとづいて記入する。推測・概算・Web 検索で埋めない
- 不明な値は `"TODO: <何を記入するか>"` のまま残す。AI が TODO を勝手に埋めてはいけない
- 実績（`facts/results.yaml`）の数値には `as_of`（基準日・年度）と `source`（出典）を必ず書く。出典を示せない数値は掲載しない
- 記入・変更したコミットのメッセージに出典（資料名・ページ、確認者）を書く
- 教員・人物は掲載の同意が取れている人だけ、写真は権利・肖像の同意が確認できるものだけを登録する（`photos.yaml` の `rights` に条件を書く）

## 3. TODO プレースホルダ

- 文字列項目: `"TODO: 住所を記入"` の形（必ず `TODO` で始める）
- 数値項目も未確定の間は `"TODO: ..."` 文字列でよい（`{{num}}` はそのまま出力する）
- `npm run validate` は TODO を警告、`npm run validate -- --strict` はエラーにする
- `npm run render -- --book <id> --release` は、描画結果に `TODO` が残っていると失敗する
- 該当しない任意項目は TODO を残さず行ごと削除する

## 4. 参照のしかた（厳格モード）

- 存在しないキーを参照すると描画はエラーで止まる（BOOK・ページ・キー名が表示される）。これは誤った情報を出さないための仕様
- 任意項目は `{{#if facts.school.fax}}FAX {{facts.school.fax}}{{/if}}` のように `#if` で囲む
- 配列の特定要素を使う場合は ID で探すより `{{#each}}` で回すことを優先する。添字（`facts.results.metrics.0`）は並び順が変わると別の値を指すので、使う場合は page.yaml の `notes` に理由を書く
- 数値は `{{num value}}`（`1,234` 形式）で出力する

## 5. 変更の手順

1. `company-data/` の該当 YAML を変更する
2. `npm run validate`（形式・直書き・禁止語の確認）
3. 値を使っているすべての BOOK を再出力して目視確認する（`npm run render -- --book <id> --format png`）
   - 文字数が増えて枠からあふれていないか、改行位置が崩れていないか
4. 変更・出典・再出力した BOOK をコミットメッセージに書いてコミットする

## 6. 追加・拡張

- 新しい種類の事実は `facts/<名前>.yaml` を追加する（`facts.<名前>` として参照可能。形式は自由）
- 既存 5 ファイル（school / courses / teachers / results / contacts）のキー名は変更しない。キーを追加するとスキーマ上は許容されるが、docs/architecture.md と company-data/README.md を更新すること
- 写真は `company-data/photos/` 以下、ロゴは `company-data/brand/logo/` に置き、YAML の `file` はリポジトリルート相対で書く。バイナリは Git LFS で管理される

## 7. 禁止事項

- 参考資料（`references/`）の学校名・実績・数字・人物・企業名・ロゴ・学科名・インタビュー・写真・固有コピーを入れる（system/rules/references.md）
- AI 生成画像を `photos.yaml` に登録する、ロゴを作る・生成する・トレースする
- BOOK ごとに company-data を複製する、BOOK 内に事実を直書きする
- ブランドカラーを BOOK の CSS に 16 進で直書きする（`book.yaml` の `theme` で上書きする場合も、その BOOK だけの意図的な変更であることを `notes` に書く）
