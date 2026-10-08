# shared/generated-assets — 再利用する AI 生成ビジュアル

複数の BOOK・ページで使い回す AI 生成の画像素材（Layer 1: BASE VISUAL）を置きます。
特定のページ専用の背景は `books/<bookId>/backgrounds/` に置いてください。

## 置いてよいもの

- テクスチャ（紙・布・ノイズ）、グラデーション、光・ボケ、抽象的な装飾、パターン
- 複数 BOOK で共通に使うキービジュアル素材

## 置いてはいけないもの

- 文字・数字・ロゴ・QR コードを含む画像（文字は Layer 3 で HTML として配置する）
- 学校の写真（`company-data/photos/` に置く。AI 生成画像を実在の学校・学生・教員の写真として使わない）
- 参考資料（`references/`）の画像を切り出しただけの画像（参考ページ画像を画像生成へ入力して作った Layer 1 素材は可。文字・数字・ロゴ・QR と、他校を特定できる写真・人物・装飾が残っていないことを確認し、`reference_inputs` に記録する。system/rules/image-generation.md §3）

## 生成記録（必須）

画像 1 つにつき、同じベース名の `.prompt.yaml` を隣に置きます。

```text
shared/generated-assets/
├─ texture-paper-01.png
├─ texture-paper-01.prompt.yaml
├─ gradient-blue-light-01.png
└─ gradient-blue-light-01.prompt.yaml
```

`.prompt.yaml` の形式は `system/templates/background.prompt.yaml`（books/*/backgrounds/ と同じ）です。主なキー:
`tool` `model` `prompt` `negative_prompt` `seed` `size` `created` `author` `reference_inputs` `params` `source_refs` `notes`。
画像を加工（拡大・色調整・合成）した場合は、その手順を `notes` に書きます。

`npm run validate` が記録の欠落を警告するのは `books/*/backgrounds/` だけです。このディレクトリはレビューで確認します（system/rules/image-generation.md）。

## 命名

`<内容>-<特徴>-<連番2桁>.<拡張子>`（英小文字・数字・ハイフン）。例: `texture-paper-01.png`、`light-flare-warm-02.png`。
一度 BOOK から参照したファイルは改名・上書きしません。作り直す場合は連番を上げて新しいファイルにします。

## 使い方

```yaml
# page.yaml（ページ全面の背景）
background:
  image: shared/generated-assets/texture-paper-01.png
  fit: cover
```

```hbs
{{!-- page.html（部分的な素材） --}}
{{> photo-frame src="shared/generated-assets/light-flare-warm-02.png" ratio="16 / 9"}}
<img class="abs" style="top: 0; right: 0; width: 80mm" src="{{asset "shared/generated-assets/light-flare-warm-02.png"}}" alt="">
```

PNG / JPG / WebP などのバイナリは Git LFS で管理されます（.gitattributes）。
