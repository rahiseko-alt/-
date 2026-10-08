# レビューのルール

レビューは「画像として見て」行い、結果をファイルに残します。会話の中だけで終わらせません。

## 1. 共通

- レンダリング結果（PNG）と参考ページ画像は、必ず画像として開いて目視する。数値（mismatch_ratio）や HTML の読み取りだけで合否を決めない
- 記録先: `books/<bookId>/reviews/<pageId>/review.md`（テンプレート: `system/templates/review.md`）。1 ページ 1 ファイルで、ラウンドごとに追記する
- 比較の出力: `books/<bookId>/reviews/<pageId>/compare-<YYYYMMDD-HHmmss>/`（`npm run compare` が作る）。
  `report.yaml` はコミットする。比較画像（`side-by-side.png`・`overlay.png`・`diff.png`）は参考ページの画素を含むため `.gitignore` 済みでコミットしない（所見は `review.md` に文章で残す）
- レビューの結果に応じて `page.yaml` の `status` を更新する（`draft` → `review` → `approved`）

## 2. Phase 5: 完コピ検証のループ

目的はコピーそのものではなく、参考デザインを正しく構造化できているかの確認です（docs/concept.md §9 Phase 5）。
**最低 2 ラウンド**、視覚比較と修正を行います。

```text
参考画像確認 → 背景画像生成 → HTML/CSS/SVG 実装 → テキスト配置
→ PNG レンダリング → 元画像との比較 → 修正 →（2 ラウンド目以降も同じ）
```

### 1 ラウンドの手順

1. レンダリング

   ```bash
   npm run render -- --book <bookId> --page <pageId> --format png
   ```

2. 比較（参考画像は `references.yaml` の `page_NNN.layout_reference` の先頭が既定）

   ```bash
   npm run compare -- --book <bookId> --page <pageId>
   # 別の参考画像やしきい値を使う場合
   npm run compare -- --book <bookId> --page <pageId> --reference references/HAL/brochure/page_016.png --threshold 0.1
   ```

   出力: `diff.png`（差分）、`side-by-side.png`（左右並び）、`overlay.png`（50% 重ね）、`report.yaml`（mismatch_pixels / mismatch_ratio など）。
   レンダリング画像は塗り足しを切り落とし、参考画像は同じ大きさに引き伸ばして比較する。縦横比が違う参考画像はゆがむので、ゆがみを差分と誤認しない
   写真・スキャンの参考ページは `npm run ref:prep` の指定ファイル（`references/<source>/<kind>/prep/*.yaml`）で正立・単ページ・台形補正してから比較する（`--reference` / `layout_reference` に指定ファイルを書く）。写真のゆがみ・照明むらは残るので、`mismatch_ratio` よりも位置・大きさの目視比較を重視する

3. 目視（`side-by-side.png` → `overlay.png` → `diff.png` の順に開く）。次の観点ごとに差を書き出す
   - グリッド・マージン・ガター（要素の左右端・上下端がそろっているか）
   - 見出し階層（サイズ比・ウェイト・位置）
   - 本文の量・行送り・行長
   - 写真の比率・位置・クロップ
   - 罫線・カード・色面（太さ・角丸・余白）
   - 色の役割と面積比
   - 背景表現（明暗の配置・質感）
   - 視線誘導（最初に目に入る要素、読む順序）
4. `review.md` に記録する（下の形式）
5. 修正する。差の原因が Layer 1（背景）か Layer 2/3（コード）かを切り分けて直す
6. 次のラウンドへ

### 終了条件

- 2 ラウンド以上実施し、各ラウンドの記録がある
- 残っている差が「意図的な差」（ダミーテキスト・自社写真の不在・背景の生成差）だけであり、その理由が書かれている
- グリッドとマージンが参考資料の解析結果（`analysis/page_NNN.yaml`）と一致している
- mismatch_ratio は推移の参考値。値だけで合否を決めない（背景や文字が違えば下がりきらない）

## 3. review.md の形式

```markdown
# レビュー: <bookId> / <pageId>

- 参考: references/HAL/brochure/page_016.png（layout）
- 解析: references/HAL/brochure/analysis/page_016.yaml

## ラウンド 1（2026-10-07, codex）

- 比較: books/brochure/reviews/page_016/compare-20261007-143012/
- mismatch_ratio: 0.214
- 所見:
  - グリッド: 本文の左端が参考より 2mm 右。マージン inside が 20mm になっていた
  - 見出し: サイズ比は一致。ウェイトが 1 段階重い
  - 写真: 右上の写真の比率が 3:2 → 参考は 4:3
- 修正: margins_mm.inside 20 → 18、h2 を 700 → 500、写真枠 ratio "4 / 3"
- 判定: 継続

## ラウンド 2（…）

…
- 判定: 完了（残差: 背景の光の位置は生成差。文字はダミー）

## 次にやること

- （次のセッションが読む前提で、未完了の作業を書く）
```

## 4. Phase 8: 自社版への変換後のレビュー

- `npm run validate` がエラー 0（forbidden_terms の出現なし、直書きの事実なし）
- 参考資料の固有情報（学校名・実績・数字・人物・企業名・ロゴ・学科名・インタビュー・写真・固有コピー）が残っていない（目視でも確認）
- 自社データで文字量が変わった箇所があふれていない
- 変換前のラウンドの記録を残したまま、`## 自社版への変換` の節を追記する

## 5. Phase 9: 日常編集のレビュー

- 変更したページを `npm run render -- --book <id> --page <pageId> --format png` で出力し、変更前と見比べる
- company-data を変えた場合は、その値を使う全 BOOK の該当ページを確認する
- 記録は `review.md` に 1〜3 行（日付・変更内容・確認結果）でよい

## 6. 出力前（入稿・公開前）のレビュー

- [ ] `npm run validate -- --strict` が通る（TODO が残っていない）
- [ ] `npm run render -- --book <id> --release` が通る（TODO なし・ガイドなし）
- [ ] 全ページを PNG で目視（ページ順・左右・ノンブル）
- [ ] PDF のページ数・ページサイズ（仕上がり + 塗り足し）を `pdfinfo` で確認
- [ ] PDF に書体が埋め込まれていることを `pdffonts` で確認
- [ ] 数値・連絡先・URL・QR の読み取りを人間が最終確認
- [ ] 入稿形式（CMYK / PDF/X、トンボ）を印刷会社と確認【要確認】（system/rules/output.md）
- [ ] 全ページの `status` を `approved` にした
