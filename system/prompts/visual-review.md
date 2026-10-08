# 視覚レビュー

レンダリング結果を画像として見て評価し、所見をファイルに残す。完コピ検証・自社版変換・日常編集・出力前のどの段階でも使う。

## 入力

- 対象: `books/<bookId>` の `<pageId>`（複数可）、または BOOK 全体
- 段階: `replicate`（完コピ検証）/ `convert`（自社版）/ `daily`（日常編集）/ `release`（出力前）
- 比較対象（任意）: 参考ページ画像、変更前の PNG

## 前提ルール

- system/rules/review.md、system/rules/typography-ja.md、system/rules/output.md

## 手順

1. 最新の状態でレンダリングする

   ```bash
   npm run render -- --book <bookId> --page <pageId> --format png
   # 段組・マージンの確認用（一時ディレクトリへ）
   npm run render -- --book <bookId> --page <pageId> --format png --dpi 150 --guides --out <一時ディレクトリ>
   ```

2. 参考画像がある場合は比較する

   ```bash
   npm run compare -- --book <bookId> --page <pageId>
   ```

3. PNG を画像として開く（全体 → 部分拡大）。次の観点で所見を書く
   - **事実**: 数字・名称・連絡先が company-data と一致しているか、TODO が見えていないか
   - **構造**: グリッド・マージン・揃え、見開きの左右、ノンブルの位置
   - **組版**: 文字サイズの階層、行送り、禁則、不自然な改行、文字のあふれ、最小サイズ
   - **画像**: 背景に文字が紛れていないか、写真のトリミング、解像度不足（ぼけ・ジャギー）
   - **色**: ブランドカラーの使い方、文字と背景のコントラスト
   - **印刷**: 塗り足しまで伸びているか、安全領域の内側か
   - （`replicate`）参考との差: system/rules/review.md §2 の観点
4. 所見を重要度で分ける: `必須`（事実の誤り・あふれ・禁止事項）/ `推奨`（品質）/ `任意`
5. `books/<bookId>/reviews/<pageId>/review.md` に追記する（ラウンド番号・日付・担当・比較ディレクトリ・所見・判定）
6. `release` の場合は system/rules/review.md §6 のチェックリストをすべて確認する

## 書き出すファイル

- `books/<bookId>/reviews/<pageId>/review.md`（追記）
- `books/<bookId>/reviews/<pageId>/compare-*/report.yaml`（比較した場合。比較画像は参考ページの画素を含むためコミットしない）
- 判定に応じて `page.yaml` の `status`

## チェックリスト

- [ ] 画像として目視した（HTML やテキストだけで判断していない）
- [ ] 所見を重要度つきで `review.md` に書いた
- [ ] `必須` の所見が残っているページを `approved` にしていない
- [ ] コミット・push 済み

## 完了報告

ページごとの判定と `必須` の所見の一覧を報告する。
