# 背景・ビジュアルの生成（Layer 1）

ページの背景、または再利用するビジュアルを生成し、生成記録とともに保存する。

## 入力

- 対象: `books/<bookId>` の `<pageId>`、または `shared/generated-assets/`（再利用素材）
- 参考にするページ（任意）: `references/.../page_NNN.png`（画像生成モデルへ直接入力してよい。構図・背景・質感・視覚密度の再現または参考に使う）
- 文字・カードが載る領域（例: 「上 40% に見出し、下半分に 3 枚のカード」）
- 使える生成ツール（人間が指定。ツールの利用規約・商用利用の可否を確認済みであること）
- 生成指示 `books/<bookId>/backgrounds/layer1-orders.yaml` がある場合はそれに従う（下の「生成指示から生成する」）

## 前提ルール

- system/rules/image-generation.md（文字禁止・記録・解像度）
- system/rules/page-layers.md（Layer 1 に入れてよいもの）
- system/rules/references.md §4（参考ページ画像の使い方。画像生成への直接入力は可）

## 手順

1. 対象ページの `page.html`・`page.yaml`・参考資料の `analysis/page_NNN.yaml` を読み、Layer 1 が担う表現（光・質感・グラデーション等）と、空けておく領域を決める
2. 必要な画素数を計算する: `round((仕上がり mm + 2 × 塗り足し mm) / 25.4 × png_dpi)`（A4・3mm・350dpi = 2976 × 4175 px）
3. プロンプトを書く
   - 構図（空ける領域）→ 主題 → 光・質感 → 色（ブランドカラーの 16 進値を言葉と併記）の順
   - ネガティブ: `text, letters, typography, words, numbers, logo, watermark, signature, QR code, caption`
   - 参考ページ画像を使う場合は、ツールが対応する方式（image prompt / image reference / composition reference / style・visual reference / img2img 系など）で直接入力し、空ける領域・色・質感もプロンプトに言葉で書き添える
   - 参考画像に写っている文字・数字・ロゴ・QR と、カード・枠・罫線・半透明パネル・単色の色面など Layer 2 で作る構造は生成結果に残さない（入力前に塗りつぶす・マスクする、プロンプトで除くなど）
4. 生成する。候補が複数あれば、文字が載る領域の静かさ・ブランドカラーとの調和で選ぶ
5. 採用画像を拡大して、文字状の模様・ロゴ状の形がないか確認する。あれば作り直すか該当部分を使わない
6. 必要なら拡大・トリミング・色調整を行う（手順を記録する）
7. 保存する
   - ページ背景: `books/<bookId>/backgrounds/<pageId>.png` と `<pageId>.prompt.yaml`
   - 再利用素材: `shared/generated-assets/<内容>-<特徴>-<連番>.png` と `.prompt.yaml`
   - `.prompt.yaml` は `system/templates/background.prompt.yaml` をコピーして埋める（`tool` `model` `prompt` `negative_prompt` `seed` `size` `created` `author` `reference_inputs` `params` `source_refs` `notes`）。入力した参考画像は `reference_inputs` に方式（`usage`）と一緒に書く
8. ページ背景の場合、`page.yaml` に設定する

   ```yaml
   background:
     image: books/<bookId>/backgrounds/<pageId>.png
     fit: cover
     position: center
   ```

9. `npm run render -- --book <bookId> --page <pageId> --format png --dpi 150 --out <一時ディレクトリ>` で文字を載せた状態を確認する

## 生成指示から生成する（layer1-orders.yaml）

Phase 5 の完コピ BOOK（`books/replica/*`）などで、ページ側が素材ごとの生成指示を書いてある場合の手順。

1. 対象を確認する: `npm run validate` の「Layer 1 が未生成」の警告、または `npm run gen:inputs -- --all`
2. `npm run gen:inputs -- --book <bookId>` で、各素材の参考の切り出し（`.cache/gen-inputs/<bookId>/<素材 id>.png`）と必要な画素数を得る
3. 素材ごとに生成する
   - 入力: 切り出し画像を `reference_usage` の方式で入力する。`mask` に書かれた部分（参考の文字・ロゴ・QR・枠線など）は入力前に塗りつぶす
   - プロンプト: `prompt` と `negative_prompt` をそのまま使う（ツールに合わせた言い換えは可。意味を変えたら `.prompt.yaml` の `notes` に書く）
   - 大きさ: `size_mm` の縦横比。画素数は一覧の「必要」以上（印刷に回す素材は 350dpi の値）
   - `kind: cutout` は単色背景で生成し、透過 PNG に切り抜く（手順を `notes` に書く）
   - `people: true` の素材は、実在の人物（参考に写っている人物を含む）に似せず、実在の在校生等と誤認されない表現にする。Phase 5 の完コピ用の生成指示は全件使用可（2026-10-08 決定。system/rules/image-generation.md §2）
4. 保存する: `books/<bookId>/backgrounds/<素材 id>.png`（写真調は `.jpg` 可）と `<素材 id>.prompt.yaml`。`reference_inputs` に `reference_image` のパスと方式・切り出し範囲（`crop_mm`）・塗りつぶした部分を書く
5. `placement` のとおりページから参照する（例: `{{> photo-frame src="books/<bookId>/backgrounds/page_001-hero.png" ratio="193 / 117"}}`）。`page.html` の構造・文字は変えない
6. 全件そろったら `layer1-orders.yaml` の `status` を `generated` にする
7. `npm run render` → `npm run compare` で比較ラウンドを 1 回追加し、`review.md` に記録する（Layer 1 を入れた後の差分）

## 書き出すファイル

- 画像（PNG / JPG）と同じベース名の `.prompt.yaml`
- 更新した `page.yaml`（ページ背景の場合）

## チェックリスト

- [ ] 画像に文字・数字・ロゴ・QR がない（拡大して確認）
- [ ] 実在の学校・学生・教員に見える画像を「本校の写真」として使っていない
- [ ] 参考画像を入力した場合、生成結果に参考資料の文字・数字・ロゴ・QR、Layer 2 で作る構造、他校を特定できる要素が残っていない
- [ ] 文字が載る領域で Layer 3 が読みやすい
- [ ] 画素数が足りている、または拡大の記録が `notes` にある
- [ ] `.prompt.yaml` がある（`reference_inputs` に入力した参考画像と方式、`source_refs` に見て参考にしたページ、`notes` に加工手順）
- [ ] `npm run validate` で背景の記録漏れの警告がない
- [ ] 不採用案をコミットしていない
- [ ] コミット: 画像と `.prompt.yaml` と `page.yaml` を同じコミットに、push 済み

## 完了報告

保存したファイル、画素数、採用理由、残っている懸念（文字が載る領域の明るさ等）を報告する。
