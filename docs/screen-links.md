# 画面をURLから開く

画面右上の「画面のリンク」を押すと、現在の画面と選択した対象を開くURLをコピーできる。ブラウザーのアドレスバーにも同じ表示位置が反映される。

## 主な画面

URLの`projectId`にプロジェクト、`view`に画面を指定する。省略時は`default`プロジェクトの入力画面を開く。既存の`?projectId=...`だけのURLも使える。

| 開く画面 | 指定例 |
| --- | --- |
| 話を入力 | `/?projectId=chemical-demo&view=input` |
| 会社の全体像 | `/?projectId=chemical-demo&view=company` |
| システム・道具の鳥瞰 | `/?projectId=chemical-demo&view=systems` |
| 業務の流れ | `/?projectId=chemical-demo&view=workflow&workflowId=chemical-0-0-0` |
| 情報の流れ | `/?projectId=chemical-demo&view=dataflow` |
| システム・情報の詳細 | `/?projectId=chemical-demo&view=assets&assetId=system%3Asnowflake` |
| 業務を比較 | `/?projectId=chemical-demo&view=overview` |
| レポートプレビュー | `/?projectId=chemical-demo&view=report` |

`view=systems`は`view=company&focus=systems`、`view=report`は`view=company&tab=report`に整理される。`view=interviews`も入力画面として扱う。

## 対象と表示位置

| パラメータ | 用途 |
| --- | --- |
| `workflowId` | 業務を指定。会社探索、入力、業務フロー、情報フローで使う |
| `stepId` | 個別の手順を指定。業務内のProcessノードIDを使う |
| `processId` | 会社探索で手順の詳細を開く。`stepId`はその中で選んで読む手順として別に保持する |
| `assetId` | SystemまたはDataのノードIDを指定 |
| `activityId` / `capabilityId` | 会社の活動・業務能力を直接開く |
| `scope` | `current`、`future`、`alternative` |
| `department` / `q` | 部署・検索条件。`query`も検索条件として読める |
| `level` | 業務フローの`business`または`overview` |
| `depth` / `lens` / `dataId` | `summary`・`step`・`detail`の粒度、`work`・`data`の注目対象、辿る情報 |
| `tab` | 入力の`flow`・`information`・`systems`・`history`・`documents`、システム／情報の`work`・`impact`・`flows`・`processes`・`dependencies` |
| `mode` | 入力方法の`dialogue`または`summary` |
| `flowId` | 情報の受渡しを指定。「画面のリンク」が生成する短い識別子を使える |
| `relationKind` | システム鳥瞰の`transfer`または`dependency` |
| `selectedActivityId` / `selectedSystemId` / `selectedCategoryId` / `selectedCapabilityId` | 鳥瞰図で選択したまとまり・ノードを復元する |
| `relationId` / `relationPage` / `page` | 鳥瞰の線や一覧の表示位置を復元する |
| `workKind` | システム／情報の関連業務を`direct`・`indirect`・`critical`から選ぶ |
| `workPage` / `flowPage`など | システム／情報の各一覧のページ。先頭を0とする |

会社探索で業務と情報を直接開く例。

```text
/?projectId=chemical-demo&view=company&workflowId=chemical-0-0-0&stepId=process%3Achemical-0-0-0%3As2&depth=detail
```

Snowflakeの情報受渡し、稼働依存、資料入力を直接開く例。

```text
/?projectId=chemical-demo&view=assets&assetId=system%3Asnowflake&tab=flows
/?projectId=chemical-demo&view=systems&relationKind=dependency
/?projectId=chemical-demo&view=input&tab=documents
```

業務IDが指定されている場合は、その業務が属する現在／将来案の範囲を優先する。指定した手順がその業務に含まれない場合は理由を表示して業務全体を開く。存在しない対象を、別のシステムや手順として開くことはない。

URLには閲覧するIDと表示条件を保存する。元の説明を含む既存の情報受渡しIDは、URLでは短い識別子へ変換する。元の記録は変更せず、同じプロジェクト内で一つの対象に特定できる場合に開く。

## 入力途中の状態と履歴

明示したURLの対象を、前回選択した業務で上書きしない。入力途中のメモと候補は、画面を移動しても保持する。保存前の候補を指定した業務フロー・情報フローは、入力したタブの候補から表示できる。同じタブの再読み込みでも復元する。他のタブ・端末で同じ内容を見るには、構造を保存してからリンクを使う。

画面・対象・タブ・表示範囲の変更は、ブラウザーの戻る・進むで辿れる。最初の自動選択、検索の文字入力、ページ移動は現在の履歴を更新する。別プロジェクトへの履歴移動では、そのプロジェクトの保存データとタブ内の入力を読み直す。

実装では[Next.jsがサポートするブラウザーのHistory API](https://nextjs.org/docs/app/getting-started/linking-and-navigating#native-history-api)を使う。既存のホスト側のパスと、画面指定以外のクエリパラメータは保持する。

## 検証

独立したSQLiteに300業務と3件の将来案を作り、ブラウザーで会社、活動、業務能力、システム鳥瞰、依存図、業務の手順詳細、情報受渡し、横断比較、レポート、入力の履歴・資料入口を直接開いた。手順と粒度を選んだ状態から別画面へ進み、戻る・進むで復元できることを確認した。

独立した空のプロジェクトでは、まとめて入力したメモを保持したまま会社画面へ移り、戻る・再読み込みで同じ文章と入力方法が残った。候補は簡易整理で作り、保存前のフローの再表示を確認した。この検証は画面移動と入力保持を対象にし、AIの抽出精度は対象にしていない。
