# 自社版への変換（Phase 8）

完コピ検証で作ったページを、AIビジネス専門学校の情報で構成したページに変換する。
使う自社情報は `company-data/` だけ。参考資料から流用するのはレイアウト・情報設計・デザイン構造だけ。

## 入力

- 対象: `books/<bookId>` の `<pageId>`（完コピ検証が終わっているページ）
- そのページで伝える内容（例: 「学科紹介: 学科ごとの概要・学べること・目指す職種」）
- 使う company-data（例: `facts.courses`、`facts.results.metrics`、写真 ID）

## 前提ルール

- system/rules/references.md §3（流用しないもの 10 項目）
- system/rules/company-data.md（参照のしかた・TODO・事実を作らない）
- system/rules/page-layers.md、system/rules/typography-ja.md

## 手順

1. `review.md` と `page.html` を読み、再現したレイアウトの構造（グリッド・カード・見出し階層）を把握する
2. ページで使う情報を company-data から選ぶ。**足りない情報は作らない**
   - 必要な項目が company-data にない → `"TODO: ..."` として company-data に追加し、完了報告で人間に依頼する
   - 参考資料にあった情報（実績の数字・企業名・人物・インタビュー）で埋めない
3. ダミーテキストを参照に置き換える
   - 事実: `{{facts...}}`（学校名・学科名・数字・連絡先・氏名・企業名）
   - 共通コピー: `{{copy...}}`
   - 繰り返し要素は `{{#each}}` で、件数の増減に耐える Layer 2 にする
   - 任意項目は `{{#if}}` で囲む
4. 見出し・リード文などページ固有の文章を自社の内容から書く。参考資料のコピーを言い換えない
5. 写真枠を自社写真（`{{photo "id"}}`）にする。写真がなければプレースホルダのまま残し、必要な写真を報告する
6. 色・書体がブランド（`var(--color-*)` `var(--font-*)`）だけになっていることを確認する
7. 確認

   ```bash
   npm run validate
   npm run render -- --book <bookId> --page <pageId> --format png
   ```

   PNG を画像として開き、文字のあふれ・改行・余白を確認する
8. `review.md` に `## 自社版への変換` を追記する（変換日、使ったデータ、残った TODO、確認結果）
9. `page.yaml` の `notes` を更新する（TODO が残っていれば `status` は `draft` か `review` のまま）

## 書き出すファイル

- `books/<bookId>/pages/<pageId>/page.html` / `page.css` / `page.yaml`
- `company-data/**`（TODO 項目を追加した場合のみ。値は推測で入れない）
- `books/<bookId>/reviews/<pageId>/review.md`
- `books/<bookId>/output/png/<pageId>.png`

## チェックリスト

- [ ] 参考資料の学校名・実績・数字・人物・企業名・ロゴ・学科名・インタビュー・写真・固有コピーが残っていない（目視でも確認）
- [ ] `npm run validate` がエラー 0（forbidden_terms なし）、直書きの事実の警告なし
- [ ] すべての事実が company-data の参照になっている
- [ ] 推測で作った情報がない（不足は TODO として報告）
- [ ] 文字があふれていない、禁則・改行が自然
- [ ] コミット・push 済み

## 完了報告

変換したページ、残っている TODO（company-data のどのキーに何が必要か）、必要な写真、レイアウト上の懸念を報告する。
