# system/prompts — 作業用プロンプト

Codex・Claude Code のどちらでも使える、作業単位の指示書です。人間がエージェントに作業を頼むとき、またはエージェントが作業を始めるときに読みます。

## 使い方

1. 作業に合うファイルを選ぶ
2. 「入力」の項目を埋めてエージェントに渡す（例: 「system/prompts/analyze-reference.md に従って、source=HAL kind=brochure のページ 1〜8 を解析して」）
3. エージェントは「手順」に従い、「書き出すファイル」を必ずリポジトリに残し、「チェックリスト」を満たしてから commit / push する

| ファイル | 作業 | フェーズ |
| --- | --- | --- |
| [analyze-reference.md](analyze-reference.md) | 参考資料の取り込み確認と解析 | Phase 3〜4 |
| [generate-background.md](generate-background.md) | 背景・キービジュアルの生成と記録 | Phase 5〜9 |
| [replicate-page.md](replicate-page.md) | 参考ページの完コピ検証（2 ラウンド以上） | Phase 5 |
| [convert-to-company.md](convert-to-company.md) | 再現ページを自社版へ変換 | Phase 8 |
| [visual-review.md](visual-review.md) | 出力の視覚レビュー | 全フェーズ |
| [daily-edit.md](daily-edit.md) | 文章・数字・写真の差し替えなどの日常編集 | Phase 9 |

すべての作業で `AGENTS.md` と `system/rules/00-principles.md` が前提です。
プロンプトを改善したら、同じコミットで関連するルールも更新してください。
