# Snowflake App Runtimeへの配置

BusinessFlowLensの画面とAPIをApp Runtimeで起動し、業務構造と履歴をSnowflakeのテーブルへ、元ファイルとページ画像を内部ステージへ保存する。標準テーブル版とHybrid Tables版には別のサービス名・保存オブジェクトを使う。

## 今回確認できた範囲

2026年10月6日、提供されたテストアカウントで標準テーブル版の保存・読込・競合検出・履歴・原本・ページ画像を実際に確認した。303業務の独立した架空会社を保存し、画面から会社の活動、受注の手順、判断、次の業務、システムを開いた。既存のSQLiteの10プロジェクトは、構造・原文・履歴数が検証前と一致した。

App Runtime向けの配布物もローカルで起動した。CSS・JavaScript・公開資料を読み込み、PNGとPDFの原本を保存し、PDFをページ画像へ変換して再取得する検証を用意した。配布物で不足していたcanvasのICUデータも含めた。日本語フォントが埋め込まれていないPDFの文字欠けも修正し、Notoの2書体をライセンスとともに配布物へ含めた。OSフォントの読込みを無効にした環境で、日本語の字形を確認した。

古いPDFのページ画像は、資料の画面や業務から元資料を開いたときに作り直す。以前のAIの読取りは履歴に残し、保存済みの業務や人の修正は変えない。実画面での更新前後に、原本のSHA・保存済みグラフ・プロジェクトの更新日時が一致することを確認した。今回の追加確認では、SQLiteの既存19プロジェクトも業務数・更新日時が変わっていない。

クラウド上のApp Runtimeには未配置。[App Runtimeの公式利用条件](https://docs.snowflake.com/en/developer-guide/snowflake-app-runtime/limitations)ではトライアルが対象外であり、Hybrid Tablesも実アカウントで391404、Cortexも399258で利用不可だった。Hybrid Tablesを使った保存やクラウドのサービス用OAuthでの接続は、利用できるアカウントで検証が必要。

303業務は保存先・探索用のテストデータである。0件から画面でgpt-6-lunaを使い、少しずつ入力して育てる検証とは別に扱う。

## 配置する手順

1. 利用できるアカウントで[Appsの管理者セットアップ](https://docs.snowflake.com/en/developer-guide/snowflake-app-runtime/account-admin-setup)を実行し、配置用のロールを選ぶ。
2. `app.yml`のdatabase、schema、query_warehouseと環境変数のSNOWFLAKE_WAREHOUSEを配置先に合わせる。標準版は`standard`、Hybrid版は`hybrid`を使う。
3. 下のコマンドで初期化SQLを出力し、配置用ロールの権限を含めて確認・実行する。アプリの起動時にはDDLを実行しない。
4. Snowflake CLIで配置する。CLIの認証はサーバーのPAT設定とは別に、利用する接続を設定しておく。

```powershell
npm ci

# 認証情報なしでSQLを出力できる。BFL_APPは実際の配置用ロールに置き換える。
node node_modules/tsx/dist/cli.mjs scripts/snowflake-setup.ts --target standard --print-sql --grant-role BFL_APP > standard-setup.sql
node node_modules/tsx/dist/cli.mjs scripts/snowflake-setup.ts --target hybrid --print-sql --grant-role BFL_APP > hybrid-setup.sql

# standardとhybridは別のApplication Serviceになる。
snow app deploy --target standard
snow app deploy --target hybrid
```

初期化するロールと配置するロールが同じなら、出力SQLのGRANT部分は不要。別のロールなら、対象の4テーブル、各ビュー、元資料のステージ、ウェアハウスへの権限を付与する。配置・ビルドに必要な権限は管理者セットアップで設定する。アプリはサービスの所有者権限で共有データを扱う。利用者別の行アクセス制御は実装していない。

ローカルのサーバー用設定ファイルで直接初期化する場合は、次の形で実行する。認証情報はGitに含めない。

```powershell
node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/snowflake-setup.ts --target standard
```

`--create-namespace`はデータベース・スキーマが存在しない場合にだけ使う。セットアップは既存の表・原本を削除しない。ビューは同じ名前で更新するため、そのビューの所有権が必要。

## AIを設定する

初期の`app.yml`はモデルを指定していない。未設定なら画面に「AI未接続・簡易整理」と表示する。利用できないモデルを別のモデルへ自動で切り替えることはしない。

Cortexで画像と構造化応答に対応したモデルを利用できる場合は、そのモデル名を指定する。このコマンドはstandard・hybrid両方の設定を更新する。接続が成功したことや読み取り精度は、まだ確認していない。

```powershell
node scripts/configure-runtime-ai.mjs --model 接続先で利用できるモデル名
```

ClaudeをMessages形式で呼ぶ場合は`--protocol anthropic`も指定する。Cortexではこの形式でもBearer認証を使う。送信と戻り値の違い、スキーマの制約は[Cortex RESTの接続仕様](cortex-api-contract.md)に記載した。

```powershell
node scripts/configure-runtime-ai.mjs --protocol anthropic --model 利用できるClaudeモデル名
```

外部AIを使う場合は、[Generic stringのSecretとExternal Access Integration](https://docs.snowflake.com/en/developer-guide/snowflake-app-runtime/app-yml)を用意し、その既存オブジェクトを指定する。APIキーの値をコマンドやapp.ymlへ書かない。

```powershell
node scripts/configure-runtime-ai.mjs --external --endpoint https://AI接続先/v1 --model 接続先で利用できるモデル名 --secret BFL_TEST.APP.BFL_AI_KEY --integration BFL_AI_EAI
```

外部AIのキーは`/secrets/BFL_AI/secret_string`から呼び出しごとに読み直す。Snowflakeのサービス用トークンは同じアカウントのCortex/Gatewayへの接続にだけ使用し、外部AIへ送らない。

gpt-6-lunaはローカルのCodexログインで実接続している。`AI_RUNTIME=codex`はApp Runtimeでは起動できない。クラウドでも同じモデルを使うには、そのモデルを提供するAPI接続が別途必要。今回、App Runtimeからgpt-6-lunaを呼べたとは扱わない。

## 配置後の検証

```powershell
$env:BFL_RUNTIME_URL = 'https://配置したアプリ.snowflakecomputing.app'

# 保存・履歴・原本・画像・取消・再開・レポートを、独立した会社で確認する。
npm run test:app-runtime

# AIが実際に応答し、保留・未確認が残り、ページ画像も読んだかを追加確認する。
npm run test:app-runtime -- --ai
```

Snowflakeのログインが必要な配置先では、検証用のセッションCookieを`BFL_RUNTIME_COOKIE`にサーバー側で設定できる。Cookieはログや結果ファイルへ出力しない。対話・フローの使いやすさや文書の読み取り精度は、これらのHTTP検証に加えて実際の画面で確認する。

`/api/health`は保存先への読込が通ればreadyを返す。AIの設定有無は別の項目で返し、設定済みというだけでAIの実応答・品質が確認できたとは扱わない。認証情報や接続先URLは返さない。

Hybrid版の保存契約を直接検証する場合は、次のコマンドを使う。利用不可なら標準版へ切り替えず、テストを失敗させる。

```powershell
$env:SNOWFLAKE_TABLE_KIND = 'hybrid'
node --env-file=.env.local node_modules/tsx/dist/cli.mjs --test tests/live-snowflake.ts
```

トライアルで制約を記録する場合だけ、`BFL_ALLOW_UNAVAILABLE_HYBRID=1`を指定できる。391404なら明示的にskipとし、Hybrid版を検証済みにはしない。

CIは`build:app-runtime`で配布物を作り、`test:app-runtime -- --package-only`で起動・静的ファイル・PDF画像変換を確認する。この検証は独立したSQLiteを使い、SnowflakeやAIには接続しない。Snowflakeの実接続検証を代わりに済ませたことにはならない。

## 保存するものと仮想グラフ

| 種類 | 標準版 | Hybrid版 | 保存内容 |
| --- | --- | --- | --- |
| テーブル | BFL_ST_PROJECTS | BFL_HT_PROJECTS | 業務構造、原文、Current/Future、訂正・根拠・未確認 |
| テーブル | BFL_ST_SOURCE_DOCUMENTS | BFL_HT_SOURCE_DOCUMENTS | 原本・ページのID、解釈、取消状態、ステージの位置とハッシュ |
| テーブル | BFL_ST_REVISIONS | BFL_HT_REVISIONS | 業務ごとの履歴、原文、追加回答、人による確認 |
| テーブル | BFL_ST_WRITE_LOCK | BFL_HT_WRITE_LOCK | 更新の直列化と履歴番号の割当 |
| ステージ | BFL_ST_SOURCES | BFL_HT_SOURCES | 原本のバイト列とページ画像 |

IDと根拠は保存先を変えても保持する。原本のステージ位置は会社ID・資料ID・内容のハッシュで分け、既存の原本を上書きしない。取得時にサイズとSHA-256を確認する。資料の読み取りを取り消しても原本は残す。取り消しや再開の後に遅れて届いたAI結果は、世代が違えば反映しない。

WORKFLOWS、ACTIVITIES、CAPABILITIES、CAPABILITY_WORKFLOWS、NODES、EDGES、DATA_FLOWS、HANDOFFS、MATERIAL_HANDOFFS、SYSTEM_CATEGORIES、SYSTEM_PROFILES、SYSTEM_DEPENDENCIES、SYSTEM_USAGE、SOURCE_UNITSをSQLビューとして公開する。名前には上記のBFL_ST_またはBFL_HT_が付く。JSONにも判断・条件・根拠などを残すので、後からAPI/MCPを追加して同じIDをたどれる。MCPサーバー自体は今回追加していない。

SYSTEM_USAGEは手順とSystemの`uses`・`executes`という直接の関係を表す。依存する基盤やシステム間の情報転送は別のビューで扱う。利用業務数を出すときは、PROJECT_ID、SCENARIOを指定してWORKFLOW_IDの重複を除く。現在と将来案を合算したり、基盤への依存を直接利用の件数へ混ぜたりしない。

## 残る制約

標準テーブルは主キーを強制しないため、書込み前に共通の行を更新してロックする。複数セッションの初回保存・同時編集・履歴番号を実測したが、書込み全体を直列化する方式であり、大人数が同時に編集する性能は未検証。更新時刻を指定する保存では競合を拒否する。更新時刻を指定しない既存APIは最後の保存を採用する。業務保存と履歴登録は現行APIでは別々のトランザクションになる。

Word・PowerPointの画像変換にはサーバー側のLibreOfficeが必要。App Runtimeの実行環境での配置・実行は未確認。利用できなければ原本を保存し、画像変換できないことを表示する。PDFに変換してから読み込む方法も使える。PDF・PNG・JPEG・WebPはOffice変換を使わない。

元資料の取消後に、既に転送した未参照のページ画像がステージへ残る場合がある。今回、自動削除は実装していない。原本・履歴を保つ方針と、運用時の保存期間は別途決める。
