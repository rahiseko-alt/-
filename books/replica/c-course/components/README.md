# components — このBOOKだけで使うパーシャル

`<name>.hbs` を置くと、ページから `{{> book/<name>}}` で呼び出せます。
複数の BOOK で使う部品は `shared/components/` に置きます（shared/components/README.md）。

- 事実（学校名・数字・連絡先など）は直接書かず `{{facts...}}` を参照する、または引数で受け取る
- スタイルは BOOK の共通 CSS（book.yaml の `styles`）か、使うページの page.css に書く

## このBOOKの部品（Phase 5 の完コピ検証で作成。shared/components へ移す候補）

| 部品 | 引数 | 内容 |
| --- | --- | --- |
| `dept-header` | `name`（必須）、`photo`（任意） | 天・小口・ノドまで裁ち落とす写真 + 左下の白い切り欠き（タブ）+ 学科名（明朝） |
| `bar-heading` | `title`（必須） | 学科色の縦棒付きのセクション見出し |
| `wrap-text` | `title`・`body`（必須）、`photo`（任意） | 縦棒見出し + 先頭 N 行は全幅・その後を写真（右 float）が回り込む本文。本文の高さは固定しない |
| `band-list` | `title`（必須）+ 部分ブロックで `<li>` | 学科色の帯見出し + 丸い行頭記号の箇条（列優先の CSS Grid。行数は `--bl-rows`） |

スタイルは pages/page_001/page.css（学科色は `--rep-dept` の 1 つ）。
