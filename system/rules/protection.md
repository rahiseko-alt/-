# 保護機構（Phase 7 の計画）

> **現在は未導入です。** docs/concept.md §9 では、保護機構は Phase 6（BASELINE 確定）の後に導入すると定めています。
> 現時点（Phase 1 完了）では、以下の仕組みはいずれも有効になっていません。このファイルは計画の記録です。

## 1. 目的

確定した基準データ（ルール・参考資料・baseline）を、AI の誤操作で変更されないようにする。
修正が必要な場合だけ、専用のメンテナンス権限で変更する。

## 2. 保護対象（予定）

docs/concept.md §9 Phase 7 の例:

| パス | 権限 |
| --- | --- |
| `system/rules/` | READ ONLY |
| `references/` | READ ONLY |
| `baseline/` | READ ONLY |
| `company-data/` | WRITE |
| `books/` | WRITE |
| `shared/` | WRITE |

- `baseline/` の場所と中身（確定版の BOOK のソース・出力・比較基準画像など）は Phase 6 で決める【要確認】
- `references/` を READ ONLY にした後の参考資料の追加は、メンテナンス権限で行う

## 3. 多層防御（予定）

| 層 | 仕組み | 想定する実装 |
| --- | --- | --- |
| 1. Filesystem Permission | 保護対象のファイルを書き込み不可にする | `setup.sh` で保護対象に読み取り専用属性を付ける／コンテナのマウント設定 |
| 2. PreToolUse Hook | エージェントのファイル編集・コマンド実行の前に、保護対象への書き込みを拒否する | Claude Code: `.claude/settings.json` の `PreToolUse` フック。Codex: 同等の承認・サンドボックス設定 |
| 3. Git 差分チェック / CI | 保護対象の変更を含むプルリクエストを CI で失敗させる | `.github/workflows/ci.yml` にパス監視のジョブを追加。メンテナンス用のラベル・承認がある場合だけ通す |

## 4. 現在の状態

| 仕組み | 状態 |
| --- | --- |
| Filesystem Permission | 未導入 |
| PreToolUse Hook | 未導入（`.claude/settings.json` には `SessionStart` フックで `setup.sh` を実行する設定だけがある） |
| CI のパス監視 | 未導入（CI は doctor・check・スモークレンダリングのみ） |

導入前の運用（人間とエージェントの約束）:

- `docs/concept.md` は編集しない
- `system/rules/` の変更は、ルール自体の改善が目的のときだけ行い、コミットメッセージに理由を書く
- `references/` の既存の画像・PDF は上書きしない（解析結果 `analysis/` と `source.yaml` の追記は可）
- `status: approved` のページを変更するときは理由をコミットメッセージに書く

## 5. 導入の手順（Phase 6 完了後）

1. baseline の範囲と置き場所を決め、このファイルと `AGENTS.md` を更新する
2. 3 層を 1 つずつ導入し、それぞれ「保護対象を変更しようとすると止まる」ことを確認する
3. メンテナンス権限の使い方（誰が・どの手順で解除するか）をこのファイルに書く
4. `AGENTS.md` の「現在のフェーズ」と、このファイル冒頭の「未導入」の表記を更新する
