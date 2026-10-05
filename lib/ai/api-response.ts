import { AIProviderError } from './errors';

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const invalid = (message = 'AIの応答を構造として読み取れませんでした。') => new AIProviderError('invalid_response', `${message}メモと前の候補は残っています。再試行してください。`);

/** Read the API envelope, not an extraction schema. Usage, IDs and other envelope metadata are allowed. */
export function structuredResponseText(payload: unknown, protocol: 'openai' | 'anthropic'): string {
  if (!record(payload)) throw invalid();
  // Cortex can return an error in an HTTP 200 body. Do not mistake it for model output.
  if (String(payload.code) === '390112') {
    throw new AIProviderError('authentication', 'AIの接続トークンが期限切れです。管理者に接続設定の確認を依頼してください。メモと前の候補は残っています。');
  }
  if (payload.success === false || payload.type === 'error' || payload.error) {
    throw new AIProviderError('provider', 'AIが整理結果を返せませんでした。接続先とモデルの設定を確認してください。メモと前の候補は残っています。');
  }
  if (protocol === 'openai') {
    if (!Array.isArray(payload.choices)) throw invalid('接続設定の応答形式とAIの戻り値が一致していません。');
    const choice = payload.choices[0];
    if (!record(choice) || !record(choice.message)) throw invalid();
    if (choice.finish_reason === 'length') throw invalid('AIの応答が出力上限で途中終了しました。入力の範囲を小さくして再試行してください。');
    if (choice.finish_reason !== undefined && choice.finish_reason !== 'stop') throw invalid('AIの応答が整理結果として完了していません。');
    if (choice.message.refusal) throw invalid('AIが整理結果を返しませんでした。');
    if (typeof choice.message.content !== 'string' || !choice.message.content.trim()) throw invalid('AIの応答に整理結果がありませんでした。');
    return choice.message.content;
  }
  if (!Array.isArray(payload.content)) throw invalid('接続設定の応答形式とAIの戻り値が一致していません。');
  if (payload.stop_reason === 'max_tokens') throw invalid('AIの応答が出力上限で途中終了しました。入力の範囲を小さくして再試行してください。');
  if (payload.stop_reason !== undefined && !['end_turn', 'stop_sequence'].includes(String(payload.stop_reason))) throw invalid('AIの応答が整理結果として完了していません。');
  const texts: string[] = [];
  for (const part of payload.content) {
    if (!record(part)) throw invalid();
    if (part.type === 'thinking' || part.type === 'redacted_thinking') continue;
    if (part.type !== 'text' || typeof part.text !== 'string') throw invalid('AIの応答に本文以外の未処理の操作が含まれています。');
    texts.push(part.text);
  }
  const text = texts.join('');
  if (!text.trim()) throw invalid('AIの応答に整理結果がありませんでした。');
  return text;
}
