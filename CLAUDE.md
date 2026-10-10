@AGENTS.md

# Claude Code 向けの補足

共通の指示はすべて上の `AGENTS.md`（とそこから参照される `system/rules/`）にあります。このファイルには Claude Code 固有の事情だけを書きます。
Codex と異なるルールをここに追加しないでください。両方に当てはまる内容は `AGENTS.md` か `system/rules/` に書きます。

## 役割分担（docs/concept.md §10）

担当と担当外の作業の確認手順は `AGENTS.md` §10 を正本とします。担当外の指示には、着手前に **【担当領域を超えた作業になりますがどうしますか？】** と確認し、人間の回答を待ちます。

| Claude Code が主に担当 | Codex が主に担当 |
| --- | --- |
| 初期リポジトリ構築、Dev Container、ディレクトリ設計 | 参考画像分析 |
| ルール整備、データ構造 | 背景画像・キービジュアル生成、画像生成プロンプト管理 |
| 共通エンジン・CLI・検証機能、データ管理 | 紙面の HTML/CSS/SVG 実装・配置・視覚レビュー |

担当によって成果物の置き場所や形式を変えません（解析は `analysis/*.yaml`、生成記録は `.prompt.yaml`、レビューは `review.md`）。

## Claude Code 固有の注意

- **環境準備**: Claude Code on the web では `.claude/settings.json` の SessionStart フックが `system/scripts/setup.sh --quiet` を自動実行します（リモートセッションのみ。失敗してもセッションは止まりません）。ローカルの CLI では自動実行されないので、必要なら `npm run setup` を実行します
- **画像の目視**: 参考ページ画像・出力 PNG・比較出力（`side-by-side.png` など）は Read ツールで画像として開いて確認します。HTML やテキスト抽出の結果だけで見た目を判断しません。大きな PNG は `--dpi 150 --out /tmp/<確認用ディレクトリ>` で一時ディレクトリに出力した確認用画像を見ると扱いやすくなります（低解像度の確認用出力は `books/<id>/output/` に置かない。system/rules/output.md §4）
- **保護機構**: `.claude/settings.json` に PreToolUse フックや権限制限はまだありません（Phase 7 で導入予定。system/rules/protection.md）。フックがないことは、保護対象を自由に変更してよいという意味ではありません
- **会話に頼らない**: 長い作業の途中経過や判断の理由は、会話ではなく `notes` / `review.md` / コミットメッセージに残します
