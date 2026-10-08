# 完コピ検証（Phase 5）

参考ページのレイアウトを高精度に再現し、参考デザインを正しく構造化できているかを確認する。
目的はコピーではなく構造の理解。**最低 2 ラウンド**の視覚比較と修正を行う。

## 入力

- 対象: `books/<bookId>` の `<pageId>`（未作成なら作成する）
- レイアウトの参考: `references/<source>/<kind>/page_NNN.png`
- 解析結果: `references/<source>/<kind>/analysis/page_NNN.yaml`（なければ先に system/prompts/analyze-reference.md）

## 前提ルール

- system/rules/page-layers.md、system/rules/review.md §2、system/rules/references.md §4（完コピ検証での注意）
- system/rules/typography-ja.md

## 手順

1. 準備
   - BOOK がなければ `npm run new:book -- <bookId> --kind <kind> --title "<タイトル>" --size <判型>`
   - ページがなければ `npm run new:page -- --book <bookId> --type <type> --title "<タイトル>"`
   - `books/<bookId>/references.yaml` にページ単位の参照を書く

     ```yaml
     page_016:
       layout_reference: [references/HAL/brochure/page_016.png]
     ```

   - 参考ページが写真・スキャン（倒れた見開き・台形ゆがみ）なら、`references/<source>/<kind>/prep/page_NNN[-l|-r].yaml` に回転・ページの四隅（比率）・縦横比を書き、`npm run ref:prep -- --spec <指定ファイル>` で作った `.cache/ref-prep/...png` を開いて、ページだけが正立して切り出されているか確認する。`layout_reference` には画像ではなくこの指定ファイルを書く（`compare` が自動で補正する）

   - `book.yaml` の `format`（判型・マージン・段数・ガター）を解析結果に合わせる。BOOK 全体に影響する変更は他ページへの影響を確認する
2. 参考画像を画像として開き、解析結果と見比べて Layer 1 / 2 / 3 に分解する（何を背景で、何をコードで作るか）
3. Layer 1: 背景が必要なら system/prompts/generate-background.md に従って生成する（参考ページ画像を生成モデルへ直接入力してよい）
4. Layer 2: グリッド（`shared/layouts/grid.css`）、枠・カード・罫線・色面を `page.html` / `page.css` で作る。色はブランドカラーの変数
   - `page.css` のクラス名は `shared/layouts/components.css` の名前（`.panel` `.folio` など）と重ねない。重なると共通の装飾・位置がかかって崩れる（ページ固有の接頭辞を付ける。`npm run validate` が警告する）
5. Layer 3: テキストを配置する
   - **参考資料の文字をページに書き写さない。** ダミーテキスト（同じ文字数・行数）か company-data の値を使う
   - サイズ・行送り・字間・位置を参考に合わせる
   - 写真枠は `{{> photo-frame ratio="..."}}`（プレースホルダ）。参考資料の写真をページに貼らない
6. ラウンド 1
   ```bash
   npm run render -- --book <bookId> --page <pageId> --format png
   npm run compare -- --book <bookId> --page <pageId>
   ```
   `side-by-side.png` → `overlay.png` → `diff.png` を画像として開き、system/rules/review.md の観点で差を書き出す
7. `books/<bookId>/reviews/<pageId>/review.md`（`system/templates/review.md` から作成）にラウンド 1 を記録する
8. 修正 → ラウンド 2（手順 6〜7 を繰り返す）。終了条件を満たすまで続ける
9. `page.yaml` の `status` を `review` にし、`notes` に再現の要点（使ったグリッド、Layer の分担）を書く

## 書き出すファイル

- `books/<bookId>/pages/<pageId>/page.yaml` / `page.html` / `page.css`
- `books/<bookId>/references.yaml`（ページ単位の参照）
- `books/<bookId>/backgrounds/<pageId>.png` + `.prompt.yaml`（使った場合）
- `books/<bookId>/reviews/<pageId>/review.md`（2 ラウンド以上）と `compare-*/report.yaml`（比較画像はコミットしない）
- `books/<bookId>/output/png/<pageId>.png`

## チェックリスト

- [ ] 2 ラウンド以上の比較と修正を行い、`review.md` に記録した
- [ ] 残差が「意図的な差」だけで、理由を書いた
- [ ] 参考資料の文字をページに書き写していない・写真・ロゴをそのまま貼っていない（`npm run validate` で forbidden_terms エラー 0）
- [ ] 背景画像に文字がなく、`.prompt.yaml` がある
- [ ] 文章量で変わる要素が Layer 2 で作られている（背景に焼き込んでいない）
- [ ] `npm run check` が通る
- [ ] コミット・push 済み

## 完了報告

最終ラウンドの mismatch_ratio の推移、残差とその理由、他のページにも使える部品（shared に移す候補）を報告する。
