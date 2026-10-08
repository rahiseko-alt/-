# system/rules — 制作ルール

Codex・Claude Code・人間のすべてが従う制作ルールです。エージェント向けの入口は リポジトリ直下の `AGENTS.md` です。
ルール同士が矛盾する場合は `00-principles.md` の優先順位に従い、矛盾そのものを修正してください。

| ファイル | 内容 | 主に読む場面 |
| --- | --- | --- |
| [00-principles.md](00-principles.md) | 最重要原則（docs/concept.md §14）と優先順位 | 常に |
| [company-data.md](company-data.md) | 自社データの正本・記入・参照のルール | 事実・数値・写真を扱うとき |
| [references.md](references.md) | 参考資料の格納・解析・流用禁止・forbidden_terms | Phase 3〜5、Phase 8 |
| [page-layers.md](page-layers.md) | 3 層構造（BASE VISUAL / STRUCTURE / CONTENT）と DOM | ページを作る・直すとき |
| [image-generation.md](image-generation.md) | 画像生成・生成記録（.prompt.yaml）・文字禁止 | 背景・ビジュアル生成 |
| [typography-ja.md](typography-ja.md) | 和文組版（書体・palt・禁則・行送り・最小サイズ） | 文字を組むとき |
| [review.md](review.md) | レビュー（Phase 5 の比較ループ、日常編集、出力前） | 比較・レビュー |
| [naming.md](naming.md) | ID・ファイル名・ディレクトリ名 | ファイルを作るとき |
| [git-workflow.md](git-workflow.md) | セッションの流れ・コミット・Git LFS | 作業の開始・終了 |
| [protection.md](protection.md) | 保護機構（Phase 7 の計画。**現在は未導入**） | Phase 6 以降 |
| [output.md](output.md) | 解像度・塗り足し・PNG/PDF 出力・入稿の注意 | 出力するとき |

ルールを変更するときは、関連する `AGENTS.md`・`README.md`・`docs/architecture.md`・`system/prompts/` も同じコミットで更新します。
`docs/concept.md` は構想の原本なので編集しません。
