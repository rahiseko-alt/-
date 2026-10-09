# ネオン・サイバーパンク学校案内

2026-10-09のユーザー指示に沿った、A4縦・24ページの制作案。表紙は添付2枚目を主役として縦長化。添付1・4は文字除去して青い人物アートへ再構成し、添付3・5・6・7は文字なしの支給背景を画素変更せず採用。

- 1ページずつのPNG: output/png/page_NNN.png
- 全24ページのPDF: output/pdf/prospectus-neon-2027.pdf
- 画像生成の全プロンプトと出典: backgrounds/*.prompt.yaml
- ページ別の背景・構図: design-profile.yaml
- 制作経過・確認待ち: reviews/production.md

学校名、学科、学費、連絡先はcompany-dataの正本を参照。学習の紹介は制作案で、未確定の授業科目・支援制度・実績を事実として掲載しない。学費は日本人向け募集要項が出典。正式公開・入稿前に文面の確認が必要。

生成背景の原寸は約124ppi相当。350dpi出力は文字と構造を精細にし、元画像の実画素を増やすものではない。

再出力: npm run render -- --book prospectus-neon-2027
