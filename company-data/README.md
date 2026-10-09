# company-data — 自社情報の唯一の正本

AIビジネス専門学校の情報（学校名・住所・学科・教員・実績・ブランド・写真・共通コピー）は、**このディレクトリにだけ**置きます。
すべての BOOK（パンフレット・募集要項・チラシ等）はここを参照して描画され、BOOK 側に値を書き写しません（docs/concept.md §4）。
値を変更したら、その値を使っているすべての BOOK が再出力で自動的に更新されます。

ルールの詳細: system/rules/company-data.md

## 現在の状態

学校の基本情報（`facts/school.yaml`）・学科（`facts/courses.yaml`）・入学事務局（`facts/contacts.yaml`）・募集要項の内容（`facts/admissions.yaml`。2027 年度 4 月入学・日本人向け）は、学校の資料（募集要項 V4・願書類。2026-10-08 記入）にもとづいて記入済みです。
それ以外（教員・実績・共通コピー・写真・ロゴ、学科の紹介文など）と、資料に書かれていなかった項目は `"TODO: ..."` のプレースホルダです。
ブランドカラーは描画確認用の仮の値（`status: provisional`）です。
**推測や Web 検索で埋めないでください。** 学校から受け取った資料にもとづいて記入します。

## 構成

```text
company-data/
├─ facts/                     事実情報（facts/<名前>.yaml → テンプレートで facts.<名前>）
│  ├─ school.yaml             学校名・設置者・住所・連絡先・アクセス
│  ├─ courses.yaml            学科（courses: [...]）
│  ├─ teachers.yaml           教員（teachers: [...]）
│  ├─ results.yaml            実績（metrics / employers / certifications）
│  └─ contacts.yaml           窓口別の問い合わせ先・SNS
├─ brand/
│  ├─ colors/colors.yaml      ブランドカラー（→ CSS 変数 --color-*）
│  ├─ fonts/fonts.yaml        書体（→ CSS 変数 --font-*）
│  └─ logo/logo.yaml          ロゴの一覧（ロゴファイルも同じディレクトリに置く）
├─ photos/photos.yaml         写真の一覧（写真ファイルも photos/ 以下に置く）
└─ copy/main.yaml             共通コピー（copy/<名前>.yaml → copy.<名前>）
```

## 記入のしかた

1. 学校から受け取った資料（パンフレット原稿、公式サイト、学校担当者の確認済みメモなど）を手元に用意する
2. 該当する YAML の `"TODO: ..."` を実際の値に置き換える
   - 該当しない任意項目は行ごと削除する（空文字にしない）
   - 数値項目（`years` `capacity` `value` `count` `established`）は数値で書く（`2` であって `"2年"` ではない。単位は `unit` やページ側で付ける）
   - 実績の数値には `as_of`（基準日・年度）と `source`（出典）を必ず書く
   - `id` は英小文字・数字・ハイフン（例の形式: `course-a`）。BOOK から参照し始めたら変更しない
3. 記入例を兼ねたプレースホルダ（`course-todo` など）は、実データを入れたら削除する
4. `npm run validate` で形式を確認する（`TODO` は警告。`--strict` ではエラー）
5. 影響する BOOK を再出力して確認する（`npm run render -- --book <id>`）
6. コミットメッセージに出典（どの資料の何ページか、誰の確認か）を書く

### 各ファイルのキー

| ファイル | キー |
| --- | --- |
| `facts/school.yaml` | `name`（必須）, `name_en`, `short_name`, `corporation`, `established`, `address{postal_code, prefecture, city, line1, line2}`, `tel`, `fax`, `email`, `url`, `access[]` |
| `facts/courses.yaml` | `courses[]`: `id`, `name`, `years`, `description`（以上必須）, `name_en`, `capacity`, `tags[]`, `curriculum[]`, `qualifications[]`, `careers[]`, `photo`（写真 ID） |
| `facts/teachers.yaml` | `teachers[]`: `id`, `name`（必須）, `name_kana`, `title`, `course_ids[]`, `profile`, `photo` |
| `facts/results.yaml` | `metrics[]`: `id`, `label`, `value`（必須）, `unit`, `as_of`, `source`, `note` ／ `employers[]`: `name`, `note` ／ `certifications[]`: `name`, `count`, `as_of` |
| `facts/contacts.yaml` | `contacts[]`: `id`, `label`（必須）, `tel`, `email`, `url`, `hours`, `note` ／ `sns[]`: `service`, `url` |
| `facts/admissions.yaml`（学費の合計だけ検査し、ほかは自由形式） | `as_of`, `source`, `audience`, `departments[]`（`course_id`・課程・コース・昼夜・学級数）, `policies{admission, curriculum, diploma}`, `eligibility{lead, conditions[]}`, `exam_notes[]`, `exam_types[]`（`id`・`name`・`formal_name`・日程・選考方法）, `documents[]`, `document_notes[]`, `withdrawal_refund`, `exam_fee`, `payment_account`, `payment_notes[]`, `tuition{entrance_fee, years[], grand_total, deadlines[], notes[]}`, `important_notes[]`, `ao_entry_notes[]` |
| `brand/colors/colors.yaml` | `colors{primary, secondary, accent, text, muted, background, surface}`（すべて必須、16 進）, `status`（`provisional` / `final`） |
| `brand/fonts/fonts.yaml` | `families{heading, body, serif, number}`（CSS の font-family） |
| `brand/logo/logo.yaml` | `logos[]`: `id`, `file`（必須）, `variant`, `note` |
| `photos/photos.yaml` | `photos[]`: `id`, `file`（必須）, `caption`, `credit`, `rights`, `tags[]` |
| `copy/*.yaml` | 自由なキーと値 |

`facts/admissions.yaml` の学費（`tuition`）は、金額がすべて数値のときに合計を検査します（`npm run validate` のエラー）。検査するのは、各期の `total` = `tuition` + `expenses`、年次の `total` = 各期の `total` の和（1 年次は入学金 `entrance_fee` を含める）、`grand_total` = 年次の `total` の和です。募集要項の金額を一部だけ直して、合計を直し忘れるのを防ぎます。

`file` などのパスはすべてリポジトリルート相対（`/` 区切り、先頭スラッシュなし）で書きます。例: `company-data/photos/campus-exterior.jpg`。
スキーマの定義: `system/design-engine/src/schemas/company.ts`。

## BOOK からの参照

`page.html`（Handlebars）からは次のように参照します。存在しないキーを参照すると、BOOK・ページ・キー名つきのエラーで描画が止まります。

```hbs
<p>{{facts.school.name}}</p>
<p>〒{{facts.school.address.postal_code}} {{facts.school.address.prefecture}}{{facts.school.address.city}}{{facts.school.address.line1}}</p>

{{#each facts.courses.courses}}
  <h3>{{name}}</h3>
  <p>修業年限 {{years}}年</p>
  {{#if photo}}<img src="{{photo photo}}" alt="">{{/if}}
{{/each}}

{{#each facts.results.metrics}}{{> stat-card this}}{{/each}}

<img src="{{photo "campus-exterior"}}" alt="">
<p>{{nl2br copy.main.lead}}</p>
```

色と書体は CSS 変数で参照します（`color: var(--color-primary)`、`font-family: var(--font-heading)`）。

## 追加の事実ファイル

`facts/` に新しい YAML（例: `facts/events.yaml`）を置くと、テンプレートで `facts.events` として使えます（形式は自由）。
`copy/` も同様です（`copy/admissions.yaml` → `copy.admissions`）。
既存 5 ファイルのキー名は変えないでください（スキーマで検証されます）。

## してはいけないこと

- 参考資料（`references/`）の学校名・数字・人物・企業名・コピー・写真・ロゴを入れる
- 推測・概算・Web 上の未確認情報で TODO を埋める
- AI 生成画像を `photos.yaml` に登録する、ロゴを自作・生成・トレースする
- BOOK 側に同じ値を書き写す（変更が反映されなくなる）
