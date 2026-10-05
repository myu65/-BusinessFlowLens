# Cortex RESTの送信形式と戻り値

2026年10月6日に[SnowflakeのCortex REST仕様](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-rest-api)と[ClaudeのMessages仕様](https://platform.claude.com/docs/en/api/messages/create)を照合した。APIの形式はモデル名だけでは決まらない。ClaudeをChat Completionsで呼ぶ場合も、戻り値はOpenAI形式になる。

| 設定 | 呼び出し先 | 構造化出力の指定 | 整理結果を取り出す場所 |
| --- | --- | --- | --- |
| `AI_PROTOCOL=openai` | `/api/v2/cortex/v1/chat/completions` | `response_format.json_schema` | `choices[0].message.content`のJSON文字列 |
| `AI_PROTOCOL=anthropic` | `/api/v2/cortex/v1/messages` | `output_config.format` | `content`配列の`type=text`のJSON文字列 |

どちらもCortexの認証はBearer。Messagesには`anthropic-version: 2023-06-01`と`max_tokens`が必要で、モデルはClaudeに限られる。`system`はMessagesの最上位に置く。画像はOpenAI形式の`image_url`と、Messagesの`image.source`を使い分ける。アプリは画像に変換したページを送る。

`AI_BASE_URL`には`https://アカウント.snowflakecomputing.com/api/v2/cortex/v1`を指定できる。Anthropic SDKの例にある末尾`/cortex`も扱うが、アプリはSDKを使わず`/v1/messages`へ直接送る。Cortex独自の`/inference:complete`は別仕様のため、このアダプターでは受け付けない。MessagesとChat Completionsの接続先を取り違えた場合も、送信前にエラーにする。

## 戻り値を読む

API全体の戻り値には`id`、`model`、`usage`などがある。これらは業務の整理結果ではない。アプリは本文を取り出してからJSONとして読み、業務の検証へ渡す。応答の最上位に追加された管理情報は受け付ける。業務の出力スキーマをAPI全体の戻り値へ適用してはならない。

Messagesでは思考ブロックを読み飛ばし、本文ブロックを順番に連結する。`stop_reason=max_tokens`や未完了のツール呼び出しは、本文がJSONとして読めても保存候補にしない。Chat Completionsの`finish_reason=length`も同様。CortexがHTTP 200で`code=390112`を返す期限切れは、認証エラーとして扱う。

## Claudeの出力スキーマ

[Claudeの構造化出力](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)は、`maxLength`、`maxItems`、2以上の`minItems`などを受け付けない。アプリはこれらを説明へ移して送信し、戻った結果には元の制約を適用する。条件を超えた結果は切り詰めず、エラーにする。この検証では説明へ移した制約を確認する。JSON Schema全体の検証は含まず、業務・根拠・IDの検証は従来の処理で行う。

業務のスキーマには18個のunion型があり、Claudeの明示上限16個を超えていた。上限を超えるスキーマでは、不明な文字列を送受信時だけ空文字で表し、戻り値で`null`へ戻す。会社に保存する型は変えず、不明な人・情報・再開先を補完しない。nullableのオブジェクトはそのまま残す。内部のコンパイル上限もあるため、明示上限を満たしても、実接続での受け付けが保証されたとは扱わない。

## 「extra…」というエラーについて

`extra_forbidden`や`Extra inputs are not permitted`は、許されていない項目を検証した際に出ることがある。送信項目、出力スキーマ、アプリが検証する戻り値のどこでも起こり得る。今回のエラー全文と接続先がないため、発生箇所は特定していない。

アプリのHTTP 400では「送信項目または構造化出力の指定が仕様に合っていない」と表示する。提供元のエラー本文は原文や認証情報を含み得るため、そのまま表示・記録しない。原文と前の候補は保持し、簡易抽出や別のモデルへ切り替えない。

## 検証した範囲

公式仕様の応答例を模したHTTPテストで、OpenAI・Messages両形式の送信項目、画像、Bearer認証、本文の取り出し、余分な管理情報、思考ブロック、複数の本文ブロックを確認した。途中終了、形式の取り違え、HTTP 200のエラー、Claudeの未対応スキーマ項目も検証した。これらは接続仕様のテストであり、実Claudeの抽出精度のテストではない。

提供されたSnowflakeトライアルではSQLのCortex呼び出しが利用制限で拒否された。2026年10月6日にはRESTのMessagesも、公開用の短い検証文で通常出力と構造化出力を各1回試した。どちらもHTTP 403・`code=003001`で拒否され、モデルの応答には到達していない。403はアカウントの有効化やロールの権限でも発生するため、RESTの拒否をトライアル制限だけで説明してはいない。権限は変更していない。

今回報告された「extra…」のエラーそのものは再現していない。実Claudeの応答とPDFの読み取り品質は未検証。ローカルのgpt-6-lunaで行っている入力検証とは分けて扱う。
