# Cortex RESTの送信形式と戻り値

2026年10月6日に[SnowflakeのCortex REST仕様](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-rest-api)と[ClaudeのMessages仕様](https://platform.claude.com/docs/en/api/messages/create)を照合した。APIの形式はモデル名だけでは決まらない。ClaudeをChat Completionsで呼ぶ場合も、戻り値はOpenAI形式になる。

| 設定 | 呼び出し先 | 構造化出力の指定 | 整理結果を取り出す場所 |
| --- | --- | --- | --- |
| `AI_PROTOCOL=openai` | `/api/v2/cortex/v1/chat/completions` | `response_format.json_schema` | `choices[0].message.content`のJSON文字列 |
| `AI_PROTOCOL=anthropic` | `/api/v2/cortex/v1/messages` | `output_config.format` | `content`配列の`type=text`のJSON文字列 |

どちらもCortexの認証はBearer。Messagesには`anthropic-version: 2023-06-01`と`max_tokens`が必要で、モデルはClaudeに限られる。`system`はMessagesの最上位に置く。画像はOpenAI形式の`image_url`と、Messagesの`image.source`を使い分ける。アプリは画像に変換したページを送る。

`AI_BASE_URL`には`https://アカウント.snowflakecomputing.com/api/v2/cortex/v1`を指定できる。Anthropic SDKの例にある末尾`/cortex`も扱うが、アプリはSDKを使わず`/v1/messages`へ直接送る。Cortex独自の`/inference:complete`は別仕様のため、このアダプターでは受け付けない。MessagesとChat Completionsの接続先を取り違えた場合も、送信前にエラーにする。

## Messagesへ送るJSON

次は説明用の最小例。アプリは業務の整理用スキーマと原文、必要に応じてページ画像を同じ形式で送る。

```json
{
  "model": "claude-sonnet-4-5",
  "max_tokens": 1024,
  "system": "入力に書かれた事実だけを整理する。",
  "messages": [{ "role": "user", "content": "注文を保留した。" }],
  "output_config": {
    "format": {
      "type": "json_schema",
      "schema": {
        "type": "object",
        "properties": { "status": { "type": "string" } },
        "required": ["status"],
        "additionalProperties": false
      }
    }
  }
}
```

`format`に置くのは`type`と`schema`。OpenAI形式の`json_schema`、`name`、`strict`をそのままここへ移さない。`system`というroleを`messages`配列へ入れない。[Anthropic公式SDKの型](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/resources/messages/messages.ts)でも、`JSONOutputFormat`の項目は`type`と`schema`になっている。

Anthropicへ直接送る場合は`https://api.anthropic.com/v1/messages`と`x-api-key`を使う。アプリでは`AI_BASE_URL=https://api.anthropic.com/v1`、`AI_PROTOCOL=anthropic`、`AI_AUTH_MODE=x-api-key`とする。Cortexへ送る場合は同じ本文形式でもBearer認証を使う。

[Claudeの移行案内](https://platform.claude.com/docs/en/build-with-claude/structured-outputs#migrating-from-the-beta)では、旧REST項目の`output_format`は`output_config.format`へ移行済み。Python SDKの`messages.parse(output_format=Pydanticの型)`は別で、SDKが送信形式へ変換する補助引数。SDKの`parsed_output`も生のHTTP応答とは区別する。アプリは現行のREST形式を使い、旧betaヘッダーを送らない。Cortexは受け付けるbetaヘッダーにも制限があり、Anthropic直結の旧サンプルをそのまま流用しない。

`/inference:complete`では、[Snowflakeの別仕様](https://docs.snowflake.com/en/sql-reference/functions/ai_complete-structured-outputs#rest-api-example)にある`response_format: {"type":"json","schema":...}`を使う。掲載されているRESTの応答例もSSEになっており、Messagesの`content`配列とは異なる。またSQLの`AI_COMPLETE(show_details => TRUE)`の`structured_output[].raw_message`もMessagesの戻り値ではない。これらをMessagesのパーサーへ渡さない。

## 戻り値を読む

API全体の戻り値には`id`、`model`、`usage`などがある。これらは業務の整理結果ではない。アプリは本文を取り出してからJSONとして読み、業務の検証へ渡す。応答の最上位に追加された管理情報は受け付ける。業務の出力スキーマをAPI全体の戻り値へ適用してはならない。

たとえばMessagesの応答は次の形になる。整理結果は`content[0].text`内のJSON文字列で、外側の`usage`などを含めて業務スキーマへ渡してはならない。

```json
{
  "id": "msg_example",
  "type": "message",
  "role": "assistant",
  "model": "claude-sonnet-4-5",
  "content": [{ "type": "text", "text": "{\"status\":\"保留\"}" }],
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "stop_details": null,
  "usage": { "input_tokens": 10, "output_tokens": 10 }
}
```

実際の応答では思考ブロックが本文より前に置かれることもあるため、配列の先頭だけに依存しない。アプリは`thinking`と`redacted_thinking`を読み飛ばし、`text`ブロックを順番に連結する。本文ブロックの`citations`やAPI外側の新しい管理情報も業務データとして取り込まない。

Messagesの非ストリーミング応答では`stop_reason`が確定している必要がある。アプリは`end_turn`と`stop_sequence`を受け付け、欠落・`null`・`max_tokens`・`pause_turn`・`model_context_window_exceeded`・ツール呼び出しを候補にしない。`stop_reason=refusal`に加え、`end_turn`でも`stop_details.type=refusal`なら拒否として扱う。本文がJSONとして読めても、この終了判定を先に行う。

CortexのChat Completions互換APIでは、Claudeの`choices[].finish_reason`は公式の互換表で未対応になっている。欠落した応答は本文を読めるが、`message.tool_calls`は終了理由と独立して検査する。本文と未処理の操作が混ざった応答を候補にしない。`finish_reason`がある場合の`length`なども受け付けない。このAPIではClaudeの終了理由を必ず取得できるとは扱わない。

CortexがHTTP 200で`code=390112`を返す期限切れは、認証エラーとして扱う。

## Claudeの出力スキーマ

[Claudeの構造化出力](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)は、`maxLength`、`maxItems`、2以上の`minItems`などを受け付けない。アプリはこれらを説明へ移して送信し、戻った結果には元の制約を適用する。条件を超えた結果は切り詰めず、エラーにする。この検証では説明へ移した制約を確認する。JSON Schema全体の検証は含まず、業務・根拠・IDの検証は従来の処理で行う。

業務のスキーマには18個のunion型があり、Claudeの明示上限16個を超えていた。上限を超えるスキーマでは、不明な文字列を送受信時だけ空文字で表し、戻り値で`null`へ戻す。会社に保存する型は変えず、不明な人・情報・再開先を補完しない。nullableのオブジェクトはそのまま残す。オブジェクトは階層ごとに`additionalProperties: false`が必要で、任意項目にも合計24個の制限がある。送信する業務スキーマでこの条件をテストする。内部のコンパイル上限もあるため、明示上限を満たしても、実接続での受け付けが保証されたとは扱わない。

## 「extra…」というエラーについて

`extra_forbidden`や`Extra inputs are not permitted`は、許されていない項目を検証した際に出ることがある。送信項目、出力スキーマ、アプリが検証する戻り値のどこでも起こり得る。今回のエラー全文と接続先がないため、発生箇所は特定していない。

現行コードはAPI外側の応答を業務スキーマへ渡していない。HTTPテストでも、`id`・`usage`・追加の管理情報を含む応答から本文だけを取り出して検証できた。そのため、今回報告されたエラーを「戻り値全体を検証したことが原因」とは断定しない。HTTP 400を返す提供元のエラーと、HTTP 200の本文をアプリが検証して失敗した場合は、異なるエラーとして扱う。

アプリのHTTP 400では「送信項目または構造化出力の指定が仕様に合っていない」と表示する。提供元のエラー本文は原文や認証情報を含み得るため、そのまま表示・記録しない。原文と前の候補は保持し、簡易抽出や別のモデルへ切り替えない。

## 検証した範囲

公式仕様に沿って作ったHTTPテストで、OpenAI・Messages両形式の送信項目、画像、CortexのBearer認証、Anthropic直結のx-api-key、本文の取り出し、余分な管理情報、思考ブロック、複数の本文ブロックを確認した。終了理由を省略したCortex Claudeの応答、`end_turn`に付随する拒否、途中終了、未処理のツール呼び出し、形式の取り違え、HTTP 200のエラー、Claudeの未対応スキーマ項目も検証した。追加した拒否ケースは修正前に失敗し、修正後に通った。これらは接続仕様のテストであり、実Claudeの抽出精度のテストではない。

提供されたSnowflakeトライアルではSQLのCortex呼び出しが利用制限で拒否された。2026年10月6日にはRESTのMessagesも、公開用の短い検証文で通常出力と構造化出力を各1回試した。どちらもHTTP 403・`code=003001`で拒否され、モデルの応答には到達していない。403はアカウントの有効化やロールの権限でも発生するため、RESTの拒否をトライアル制限だけで説明してはいない。権限は変更していない。

今回報告された「extra…」のエラーそのものは再現していない。実Claudeの応答とPDFの読み取り品質は未検証。ローカルのgpt-6-lunaで行っている入力検証とは分けて扱う。
