# backgrounds — Layer 1（BASE VISUAL）の画像

ページ全面の背景画像を置きます（ルール: system/rules/image-generation.md）。

- 名前: `<pageId>.png`（例: `page_001.png`）。同じページに複数あれば `<pageId>-<用途>.png`
- 画像 1 つにつき、同じベース名の生成記録 `<pageId>.prompt.yaml` を必ず置く（雛形: system/templates/background.prompt.yaml）
- **生成画像に文字・数字・ロゴ・QR コードを入れない**。文字は page.html（Layer 3）で配置する
- ページから使うには page.yaml の `background.image` にリポジトリルート相対パスで書く
- 参考資料（references/）の画像は置かない・使わない
