# 画像生成（Layer 1: BASE VISUAL）のルール

画像生成は「質感・密度・完成度」を担う Layer 1 だけに使います（system/rules/page-layers.md）。
画像生成ツールはこのリポジトリに組み込んでいません。外部のツールで生成し、画像と**生成記録**をリポジトリに入れます。

## 1. 生成してよいもの

- 背景、グラデーション、光、テクスチャ、複雑な装飾、抽象的なキービジュアル
- 写真と背景をなじませるための周辺表現（ぼかし・光・色かぶり）
- 写真表現、誌面全体の視覚的な密度

参考ページ画像を画像生成モデルへ**直接入力してよい**（§3）。構図・背景・質感・視覚密度を高い精度で再現する、または参考にするために、必要に応じて参考ページ画像そのものを視覚リファレンスとして使う。

## 2. 生成してはいけないもの

- **文字・数字・ロゴ・記号・QR コード**を含む画像（看板・画面・書籍の背表紙・黒板など文字が写り込みやすい題材も避ける）
- 実在の学校・校舎・学生・教員・卒業生に見える画像を「本校の写真」として使うこと（実際の写真は company-data/photos に登録されたものだけ）
- 参考画像を入力した生成結果に、参考資料の文字・数字・ロゴ・QR が写り込んだまま使うこと（消すか作り直す。正確な文字は Layer 3）
- 実在の人物・企業・商標に似せる指示（参考資料のレイアウト・構図・質感の再現は §3 のとおり可）

人物を含む生成ビジュアルを使う必要がある場合は、実在の在校生等と誤認されない表現か、掲載前に人間の確認を得る【要確認: 生成人物の使用可否の方針】。

## 3. プロンプトの書き方

- 構図は「どこを空けるか」から書く。見出し・本文・カードが載る領域は、明度差が小さく情報量の少ない面にする（文字の可読性を Layer 1 で邪魔しない）
- 色はブランドカラー（company-data/brand/colors/colors.yaml）の 16 進値を言葉と併記して指定する
- ネガティブプロンプトに必ず含める: `text, letters, typography, words, numbers, logo, watermark, signature, QR code, caption`
- 参考画像を入力する場合も、プロンプトには空ける領域・色・質感を言葉で書き添える（参考画像の文字・数字・ロゴ部分を生成結果に残さない指示を含める）

### 参考ページ画像の入力

目的は「参考画像を文章だけで説明して別物を生成すること」ではなく、「参考画像そのものを AI に見せて構図・背景・質感・視覚密度を高精度に再現または参考にし、その上へコードで正確な文字を載せること」。

- 使ってよい入力方式: image prompt、image reference、composition reference、style / visual reference、img2img 系の参照、その他モデルが対応する視覚参照方式
- 入力するのは `references/<source>/<kind>/page_NNN.png` などの参考ページ画像（通常は BOOK の `references.yaml` の `layout_reference` / `visual_reference` に挙げたもの）
- 生成に任せるのは Layer 1 だけ。枠・カード・罫線・色面・半透明パネル・内容で大きさが変わる構造は Layer 2（HTML/CSS/SVG）、見出し・本文・数字・学科名・人名・URL・ページ番号・QR は Layer 3（コード）で作る（system/rules/page-layers.md）
- 参考画像に写っている文字・数字・ロゴ・QR と、カード・枠・罫線・半透明パネル・単色の色面など Layer 2 で作る構造は、生成結果に焼き込まない（入力画像でその部分を塗りつぶす、マスクする、プロンプトで除くなど、ツールに合った方法で）
- 自社版（Phase 8）では、参考資料の固有情報（学校名・実績・人物・ロゴ・写真・固有コピーなど。system/rules/references.md §3）を誌面に流用しない。生成結果に他校を特定できる要素が残っていないかを確認する
- どの参考画像を、どの方式で入力したかを `.prompt.yaml` の `reference_inputs` に必ず記録する（§4）

## 4. 生成記録（.prompt.yaml）

画像 1 つにつき、同じベース名の `.prompt.yaml` を隣に置きます（会話履歴に残すだけでは不可）。
テンプレート: `system/templates/background.prompt.yaml`。スキーマ: `system/design-engine/src/schemas/background.ts`。

```yaml
tool: "（生成ツール名）"
model: "（モデル名・バージョン）"
prompt: |
  柔らかい朝の光が左上から差し込む、淡い青のグラデーション背景。下 1/3 は明るく情報量の少ない面。…
negative_prompt: "text, letters, typography, words, numbers, logo, watermark, signature, QR code, caption"
seed: 123456              # 不明なら null
size: 2976x4175           # 最終的に配置した画像のピクセルサイズ
created: 2026-10-07T14:30:00+09:00   # 生成日時（YYYY-MM-DD でも可）
author: codex             # 生成した人・エージェント
reference_inputs:         # 生成モデルへ直接入力した参考画像（入力しなかった場合は []）
  - path: references/HAL/brochure/page_016.png
    usage: composition    # image_prompt | image_reference | composition | style | img2img | other
    strength: 0.6         # 参照の強さ（ツールの値。不明なら省略）
    note: 文字・カード部分は塗りつぶしてから入力
params:                   # その他の取得できる生成条件（ツールごとの名前のまま）
  steps: 30
  guidance: 7
source_refs:              # 入力はせず、見て参考にしたページ（参考資料はリポジトリルート相対パス）
  - references/A-school/brochure/page_031.png
notes: |
  2 倍に拡大（ツール名）、上部の文字状のノイズを修正。採用は 3 案中 2 案目。
```

- `reference_inputs` の `usage` は入力方式（`image_prompt` 画像プロンプト / `image_reference` 画像参照 / `composition` 構図参照 / `style` スタイル・ビジュアル参照 / `img2img` img2img 系 / `other` その他。`other` のときは `note` に方式を書く）
- 加工（拡大、トリミング、色調整、合成、部分修正）を行ったら手順を `notes` に書く
- 不採用案はコミットしない（容量削減）。採用理由を `notes` に 1 行残す
- `npm run validate` は `books/*/backgrounds/` の画像に `.prompt.yaml` がないと警告する。`shared/generated-assets/` はレビューで確認する

## 5. ファイルの置き場所と名前

| 用途 | 置き場所 | 名前 |
| --- | --- | --- |
| 特定ページの全面背景 | `books/<bookId>/backgrounds/` | `<pageId>.png`（例: `page_001.png`）。同じページに複数あれば `<pageId>-<用途>.png` |
| 複数の BOOK・ページで再利用する素材 | `shared/generated-assets/` | `<内容>-<特徴>-<連番2桁>.png` |

- 形式: PNG（グラデーション・装飾）または JPG（写真調で容量が大きいもの）。色空間は sRGB
- 一度ページから参照した画像は上書きしない。作り直したら新しい名前で置き、参照を切り替えてから古い画像を削除する
- バイナリは Git LFS で管理される（.gitattributes）

## 6. 解像度

- 全面背景は「仕上がり + 塗り足し」のサイズを `png_dpi`（既定 350dpi）で覆える画素数を目安にする
  - A4 縦・塗り足し 3mm: 216 × 303mm → **2976 × 4175 px**（350dpi）
  - 計算式: `round((仕上がり mm + 2 × 塗り足し mm) / 25.4 × dpi)`
- ツールの上限で足りない場合は拡大してよい（`notes` に拡大方法と倍率を書く）。150dpi 相当を下回る素材は全面に使わない
- 縦横比は仕上がり + 塗り足しに合わせる。合わない場合は `page.yaml` の `background.fit` / `position` で調整する

## 7. チェックリスト

- [ ] 画像を拡大して、文字・数字・ロゴ状の模様がないことを確認した
- [ ] 文字が載る領域が落ち着いた面になっている（Layer 3 を置いて可読性を確認した）
- [ ] 参考画像を入力した場合、生成結果に参考資料の文字・数字・ロゴ・QR、Layer 2 で作る構造、他校を特定できる要素が残っていない
- [ ] `.prompt.yaml` を同じベース名で置き、`reference_inputs`（入力した参考画像と方式）・`source_refs`・`notes` を書いた
- [ ] 画素数が出力解像度に足りている（または拡大の記録がある）
