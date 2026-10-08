# 背景・ビジュアルの生成（Layer 1）

ページの背景、または再利用するビジュアルを生成し、生成記録とともに保存する。

## 入力

- 対象: `books/<bookId>` の `<pageId>`、または `shared/generated-assets/`（再利用素材）
- 参考にするページ（任意）: `references/.../page_NNN.png`（構図・質感を言葉で読み取るため）
- 文字・カードが載る領域（例: 「上 40% に見出し、下半分に 3 枚のカード」）
- 使える生成ツール（人間が指定。ツールの利用規約・商用利用の可否を確認済みであること）

## 前提ルール

- system/rules/image-generation.md（文字禁止・記録・解像度）
- system/rules/page-layers.md（Layer 1 に入れてよいもの）
- system/rules/references.md §4（参考画像を生成の入力にしない）

## 手順

1. 対象ページの `page.html`・`page.yaml`・参考資料の `analysis/page_NNN.yaml` を読み、Layer 1 が担う表現（光・質感・グラデーション等）と、空けておく領域を決める
2. 必要な画素数を計算する: `round((仕上がり mm + 2 × 塗り足し mm) / 25.4 × png_dpi)`（A4・3mm・350dpi = 2976 × 4175 px）
3. プロンプトを書く
   - 構図（空ける領域）→ 主題 → 光・質感 → 色（ブランドカラーの 16 進値を言葉と併記）の順
   - ネガティブ: `text, letters, typography, words, numbers, logo, watermark, signature, QR code, caption`
   - 参考資料の特徴は言葉で書く。参考画像を入力に使わない
4. 生成する。候補が複数あれば、文字が載る領域の静かさ・ブランドカラーとの調和で選ぶ
5. 採用画像を拡大して、文字状の模様・ロゴ状の形がないか確認する。あれば作り直すか該当部分を使わない
6. 必要なら拡大・トリミング・色調整を行う（手順を記録する）
7. 保存する
   - ページ背景: `books/<bookId>/backgrounds/<pageId>.png` と `<pageId>.prompt.yaml`
   - 再利用素材: `shared/generated-assets/<内容>-<特徴>-<連番>.png` と `.prompt.yaml`
   - `.prompt.yaml` は `system/templates/background.prompt.yaml` をコピーして埋める（`tool` `model` `prompt` `negative_prompt` `seed` `size` `created` `author` `source_refs` `notes`）
8. ページ背景の場合、`page.yaml` に設定する

   ```yaml
   background:
     image: books/<bookId>/backgrounds/<pageId>.png
     fit: cover
     position: center
   ```

9. `npm run render -- --book <bookId> --page <pageId> --format png --dpi 150 --out <一時ディレクトリ>` で文字を載せた状態を確認する

## 書き出すファイル

- 画像（PNG / JPG）と同じベース名の `.prompt.yaml`
- 更新した `page.yaml`（ページ背景の場合）

## チェックリスト

- [ ] 画像に文字・数字・ロゴ・QR がない（拡大して確認）
- [ ] 実在の学校・学生・教員に見える画像を「本校の写真」として使っていない
- [ ] 参考資料の写真・人物・ロゴを再現していない（参考画像を入力にしていない）
- [ ] 文字が載る領域で Layer 3 が読みやすい
- [ ] 画素数が足りている、または拡大の記録が `notes` にある
- [ ] `.prompt.yaml` がある（`source_refs` に参考ページ、`notes` に加工手順）
- [ ] `npm run validate` で背景の記録漏れの警告がない
- [ ] 不採用案をコミットしていない
- [ ] コミット: 画像と `.prompt.yaml` と `page.yaml` を同じコミットに、push 済み

## 完了報告

保存したファイル、画素数、採用理由、残っている懸念（文字が載る領域の明るさ等）を報告する。
