# 日常編集（Phase 9）

初期制作が終わった BOOK を、デザインを作り直さずに更新する。デザインは「再生成するもの」ではなく「資産」。

## 入力

- 対象: `books/<bookId>`（ページ指定があれば `<pageId>`）
- 依頼内容: 例「就職率を最新年度に更新」「学科の紹介文を差し替え」「page_012 の写真を差し替え」「見出しを 2pt 小さく」
- 根拠資料: 事実の変更なら出典（資料名・確認者）

## 前提ルール

- system/rules/company-data.md §5（変更の手順）
- system/rules/00-principles.md §7（初期制作と日常編集を分ける）

## 作業の種類と変更場所

| 依頼 | 変更する場所 |
| --- | --- |
| 文章・数字・連絡先・学科・教員などの事実 | `company-data/facts/*.yaml`（BOOK 側は変更しない） |
| 複数 BOOK 共通のコピー | `company-data/copy/*.yaml` |
| ページ固有の見出し・文章 | `books/<id>/pages/<pageId>/page.html` |
| 写真の差し替え | `company-data/photos/` に写真を追加 → `photos.yaml` → `page.html` の写真 ID |
| 背景の差し替え | system/prompts/generate-background.md → `page.yaml` の `background.image` |
| 見出し位置・文字サイズ・行間・色 | `page.css`（そのページ）／ `book.yaml` の `theme`（BOOK 全体） |
| ページ追加 | `npm run new:page -- --book <id> --after <pageId> --type <type> --title "<タイトル>"` |
| ページ削除 | `book.yaml` の `pages` から外し、`pages/<pageId>/` を削除（`references.yaml` の該当キーも） |
| 再出力 | `npm run render -- --book <id>` |

## 手順

1. 依頼を上の表に当てはめ、変更場所を決める。レイアウトの作り直しが必要な依頼なら、作業を止めて人間に確認する（初期制作の手順に戻る）
2. 事実の変更は根拠資料を確認してから company-data を変更する。根拠がなければ変更しない
3. 変更する
4. 確認

   ```bash
   npm run validate
   npm run render -- --book <bookId> --format png
   ```

   - company-data を変えた場合は、その値を使う**すべての BOOK** を再出力する（`grep -rn "facts.<キー>" books/` で探す）
   - 変更したページの PNG を画像として開き、あふれ・改行・左右の入れ替わり（ページ追加・削除時）を確認する
5. `review.md` に 1〜3 行で記録する（日付・変更内容・確認結果）
6. 必要なら PDF も再出力する（`npm run render -- --book <bookId> --format pdf`）

## 書き出すファイル

- 変更したデータ・ページ・CSS
- 再出力した `books/<bookId>/output/`
- `books/<bookId>/reviews/<pageId>/review.md`（追記）

## チェックリスト

- [ ] 事実の変更は company-data だけで行った（BOOK に値を書いていない）
- [ ] 事実の変更に出典がある（コミットメッセージに記載）
- [ ] 影響するすべての BOOK・ページを再出力して目視した
- [ ] デザインを作り直していない（必要なら人間に確認した）
- [ ] `npm run check` が通る
- [ ] `status: approved` のページを変更した理由をコミットメッセージに書いた
- [ ] コミット・push 済み

## 完了報告

変更内容、影響した BOOK・ページ、再出力したファイル、残った TODO を報告する。
