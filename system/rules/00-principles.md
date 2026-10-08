# 00 最重要原則

docs/concept.md §14 の 10 原則を、このリポジトリでの具体的な行動に落としたものです。すべてのルール・プロンプトはこの原則に従います。

## 10 原則と具体的な行動

### 1. GitHub を唯一の正本にする

- 作業結果は必ずコミットして push する。ローカルや会話にだけ残った成果は「存在しない」ものとして扱う
- 作業開始時は GitHub の最新状態から始める（system/rules/git-workflow.md）
- 生成画像・解析結果・レビュー記録・出力物もリポジトリに入れる（バイナリは Git LFS）

### 2. 自社データは 1 か所だけに持つ

- 学校名・住所・電話番号・学科・教員・実績・ブランドカラー・写真・共通コピーは `company-data/` にだけ書く
- BOOK の `page.html` には `{{facts.school.name}}` のような参照だけを書き、値を書き写さない
- `npm run validate` は BOOK に直書きされた事実を警告する。警告は放置しない（system/rules/company-data.md）

### 3. 参考資料と自社情報を混同しない

- 他校・他社の資料は `references/` にだけ置き、BOOK や company-data に固有情報を持ち込まない
- 参考資料ごとに `source.yaml` の `forbidden_terms` に固有の語を登録する。`npm run validate` が books / company-data / shared での出現をエラーにする
- 流用してよいのはレイアウト・情報設計・デザイン構造だけ（system/rules/references.md）

### 4. 画像生成に文字の正確性を求めない

- 生成画像には文字・数字・ロゴ・QR を入れない。見出し・本文・数字・URL・ページ番号はすべて Layer 3（HTML）で配置する
- 生成画像に文字が紛れ込んだら作り直すか、その部分を使わない（system/rules/image-generation.md）

### 5. コードだけで全デザインを描こうとしない

- 光・質感・複雑な装飾・写真と背景の融合は Layer 1（画像）に任せる
- CSS で無理に再現して時間を使うより、背景画像を生成・差し替える

### 6. 背景画像・構造・テキストを分離する

- Layer 1（BASE VISUAL）/ Layer 2（STRUCTURE）/ Layer 3（CONTENT）を混ぜない
- 文字量で大きさが変わる面・枠・カードは Layer 2（HTML/CSS/SVG）で作り、背景画像に焼き込まない（system/rules/page-layers.md）

### 7. 初期制作と日常編集を分ける

- 初期制作（Phase 3〜8）: 参考資料の分析 → 再現 → 自社版への変換。デザインを作る段階
- 日常編集（Phase 9）: 文章・数字・写真・背景の差し替えと微調整。デザインを作り直さない
- 日常編集でレイアウトの大きな変更が必要になったら、作業を止めて初期制作の手順に戻る判断を人間に求める

### 8. AI の会話履歴ではなくファイルに状態を残す

- 解析結果 → `references/<source>/<kind>/analysis/*.yaml`
- 生成の記録 → 画像の隣の `<name>.prompt.yaml`
- レビュー結果 → `books/<bookId>/reviews/<pageId>/review.md` と比較出力
- ページの状態 → `page.yaml` の `status` / `notes`、BOOK の状態 → `config/book.yaml` の `notes`
- 次のセッションが会話履歴なしで作業を再開できることを、作業終了の条件にする

### 9. 確定データは技術的に保護する

- Phase 6（baseline 確定）の後に保護機構を導入する。**現在は未導入**（system/rules/protection.md）
- 導入前でも、`page.yaml` が `status: approved` のページを変更するときは、理由をコミットメッセージに書く

### 10. 一度作ったデザインを再利用可能な資産にする

- 2 つ以上の BOOK で使う部品は `shared/components/`（Handlebars パーシャル）へ、CSS は `shared/layouts/` へ
- 再利用する生成ビジュアルは `shared/generated-assets/` へ（生成記録つき）
- 同じものを BOOK ごとにコピーしない

## 追加の原則（本リポジトリ固有）

- **事実を作らない**: company-data にない情報を推測・Web 検索・参考資料から補わない。不明なものは `"TODO: ..."` のまま残し、人間に確認する
- **docs/concept.md は編集しない**: 構想の原本。変更が必要と考えたら人間に提案する
- **完コピ検証（Phase 5）は最低 2 回**の視覚比較と修正を行う（system/rules/review.md）
- **見て確認する**: 参考資料・出力物は OCR やテキスト抽出だけで判断せず、画像として開いて目視する

## 優先順位（ルールが衝突したとき）

1. 事実の正確性（company-data の値だけを使う、事実を作らない）
2. 参考資料との分離（固有情報を持ち込まない、forbidden_terms）
3. GitHub を正本とする運用（状態をファイルに残す、push する）
4. 3 層構造の分離
5. デザインの再現度・見た目の品質
6. 作業速度

見た目のために 1〜4 を破ってはいけません。判断に迷ったら、作業を止めて `review.md` や `notes` に論点を書き、人間に確認します。
