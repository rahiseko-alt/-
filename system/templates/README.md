# system/templates — 雛形

スクリプトが新しいファイルを作るときに使う雛形です。人間・エージェントが手で複製してもかまいません。
`__BOOK_ID__` のようなプレースホルダは、スクリプトが単純な文字列置換で埋めます（YAML では値をエスケープし、HTML では実体参照にします）。

| 雛形 | 使うスクリプト | 作られる場所 |
| --- | --- | --- |
| `book/` | `npm run new:book` | `books/<bookId>/`（`config/book.yaml`・`references.yaml`・`backgrounds/`・`components/`・`reviews/`） |
| `page/` | `npm run new:book` / `npm run new:page` | `books/<bookId>/pages/<pageId>/`（`page.yaml`・`page.html`・`page.css`） |
| `reference/source.yaml` | `npm run ref:ingest` | `references/<source>/<kind>/source.yaml`（なければ作る） |
| `reference/analysis.yaml` | `npm run ref:ingest` | `references/<source>/<kind>/analysis/book.yaml`（なければ作る）。ページ単位の `analysis/page_NNN.yaml` は手で複製する |
| `review.md` | `npm run compare` | `books/<bookId>/reviews/<pageId>/review.md`（なければ作る） |
| `background.prompt.yaml` | （手で複製） | 背景画像の隣に `<画像のベース名>.prompt.yaml` |

## プレースホルダ

| 名前 | 値 | 使う雛形 |
| --- | --- | --- |
| `__BOOK_ID__` | BOOK ID（例: `brochure`、`flyers/open-campus`） | book/、page/、review.md |
| `__TITLE__` | BOOK のタイトル（`--title`、既定は BOOK ID） | book/ |
| `__KIND__` | BOOK の種別（`--kind`）／参考資料の種別（`--kind`） | book/、reference/ |
| `__SIZE__` `__ORIENTATION__` | 判型と向き（`--size` `--orientation`） | book/ |
| `__PAGE_ID__` | ページ ID（例: `page_003`） | page/、review.md |
| `__PAGE_TYPE__` `__PAGE_TITLE__` | ページの種別とタイトル | page/ |
| `__DATE__` | 作成日（YYYY-MM-DD） | すべて |
| `__SOURCE__` `__ORIGINAL__` `__PAGES__` | 参考資料の発行元・元 PDF のパス（または null）・ページ数 | reference/source.yaml |
| `__REFERENCE__` `__COMPARE_DIR__` `__MISMATCH_RATIO__` | 比較に使った参考画像・出力ディレクトリ・差分率 | review.md |

## 雛形を変更するとき

- `npm run new:book` で作った BOOK が、そのまま `npm run validate` を通り `npm run render` できる状態を保つ（`system/scripts/test/new-book.test.ts` で確認）
- ページの雛形は `{{facts.school.name}}` と `{{page.number}}` など、どの company-data にもあるキーだけを参照する（厳格モードのため）
- 仮テキストには `TODO` を含める（`npm run render -- --release` が置き換え忘れを止める）
- 背景画像の雛形には「生成画像に文字を入れない」ルールを必ず残す
