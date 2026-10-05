import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { aiEndpoint, structuredCall, extractWorkflowReviewWithAI } from '../lib/ai/provider';
import { structuredResponseText } from '../lib/ai/api-response';
import { prepareClaudeSchema, validateStructuredConstraints } from '../lib/ai/structured-schema';
import { AIProviderError } from '../lib/ai/errors';
import { extractGroundedLocal } from '../lib/local-review';

const schema = { type: 'object', additionalProperties: false, properties: {
  title: { type: 'string', maxLength: 8 }, pages: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'string' } },
}, required: ['title', 'pages'] };
const answer = { title: '注文を保留', pages: ['p1', 'p2'] };

async function configured(protocol: 'openai' | 'anthropic', baseURL: string, run: () => Promise<void>, authMode = 'bearer') {
  const config = { AI_RUNTIME: 'api', AI_PROTOCOL: protocol, AI_BASE_URL: baseURL, AI_API_KEY: 'test-only', AI_MODEL: 'claude-sonnet-4-5', AI_AUTH_MODE: authMode, AI_ANTHROPIC_VERSION: '2023-06-01', AI_TIMEOUT_MS: '5000', AI_API_KEY_FILE: '' };
  const saved = Object.fromEntries(Object.keys(config).map(key => [key, process.env[key]]));
  Object.assign(process.env, config);
  try { await run(); } finally {
    for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}

function assertClaudeWireSchema(schema: any) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return;
  for (const key of ['maxLength', 'minLength', 'maxItems', 'minimum', 'maximum', 'multipleOf']) assert.equal(schema[key], undefined, `Unsupported Claude schema field: ${key}`);
  if (typeof schema.minItems === 'number') assert.ok(schema.minItems <= 1);
  if (schema.type === 'object' || (Array.isArray(schema.type) && schema.type.includes('object'))) assert.equal(schema.additionalProperties, false);
  for (const key of ['properties', '$defs', 'definitions']) for (const child of Object.values(schema[key] ?? {})) assertClaudeWireSchema(child);
  if (schema.items) assertClaudeWireSchema(schema.items);
  for (const key of ['anyOf', 'allOf', 'oneOf']) for (const child of schema[key] ?? []) assertClaudeWireSchema(child);
}

test('Cortex JSON contracts use separate request and response shapes, with only documented fields', async () => {
  for (const protocol of ['openai', 'anthropic'] as const) {
    const server = createServer(async (request, response) => {
      try {
        const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const body = JSON.parse(Buffer.concat(chunks).toString());
        assert.equal(request.url, `/api/v2/cortex/v1/${protocol === 'anthropic' ? 'messages' : 'chat/completions'}`);
        assert.equal(request.headers.authorization, 'Bearer test-only');
        if (protocol === 'anthropic') {
          assert.equal(request.headers['anthropic-version'], '2023-06-01');
          assert.deepEqual(Object.keys(body).sort(), ['model', 'max_tokens', 'system', 'messages', 'output_config'].sort());
          assert.deepEqual(Object.keys(body.output_config), ['format']);
          assert.deepEqual(Object.keys(body.output_config.format).sort(), ['schema', 'type']);
          assert.equal(body.output_config.format.type, 'json_schema');
          assert.equal(body.max_tokens, 8192); assert.equal(body.messages[0].role, 'user');
          assertClaudeWireSchema(body.output_config.format.schema);
          assert.deepEqual(Object.keys(body.messages[0].content[1]).sort(), ['source', 'type']);
          assert.deepEqual(Object.keys(body.messages[0].content[1].source).sort(), ['data', 'media_type', 'type']);
          assert.equal(body.messages[0].content[1].source.data, 'AQID');
        } else {
          assert.deepEqual(Object.keys(body).sort(), ['model', 'messages', 'response_format'].sort());
          assert.equal(body.messages[0].role, 'system');
          assertClaudeWireSchema(body.response_format.json_schema.schema);
          assert.equal(body.messages[1].content[1].image_url.url, 'data:image/jpeg;base64,AQID');
        }
        const text = JSON.stringify(answer), split = 11;
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify(protocol === 'anthropic' ? {
          id: 'msg_test', type: 'message', role: 'assistant', model: body.model,
          content: [{ type: 'thinking', thinking: 'Not application data', signature: 'test' }, { type: 'redacted_thinking', data: 'opaque' }, { type: 'text', text: text.slice(0, split), citations: [] }, { type: 'text', text: text.slice(split) }],
          stop_reason: 'end_turn', stop_sequence: null, stop_details: null, usage: { input_tokens: 15, output_tokens: 20, output_tokens_details: { thinking_tokens: 0 } }, request_id: 'snowflake-metadata',
        } : {
          id: 'chatcmpl_test', object: 'chat.completion', model: body.model,
          // Snowflake documents finish_reason and refusal as unsupported for Claude.
          choices: [{ index: 0, message: { role: 'assistant', content: text } }],
          usage: { prompt_tokens: 15, completion_tokens: 20, total_tokens: 35 }, system_fingerprint: 'test', request_id: 'snowflake-metadata',
        }));
      } catch (error) { response.writeHead(400); response.end(JSON.stringify({ error: String(error) })); }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      await configured(protocol, `http://127.0.0.1:${(server.address() as {port: number}).port}/api/v2/cortex`, async () => {
        const original = structuredClone(schema);
        assert.deepEqual(await structuredCall({ schemaName: 'example', schema, system: 'Extract only evidence', user: '保留する', images: [{ bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/jpeg' }] }), answer);
        assert.deepEqual(schema, original, 'The canonical application schema must not change.');
      });
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  }
});

test('incomplete, mismatched, tool and Snowflake error envelopes cannot masquerade as an extracted result', () => {
  const text = JSON.stringify(answer);
  const cases: Array<['openai' | 'anthropic', unknown, string]> = [
    ['anthropic', { content: [{ type: 'text', text }], stop_reason: 'max_tokens' }, 'invalid_response'],
    ['anthropic', { content: [{ type: 'text', text }], stop_reason: 'refusal' }, 'invalid_response'],
    ['anthropic', { content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_details: { type: 'refusal', category: 'other', explanation: 'PAT and private source' } }, 'invalid_response'],
    ['anthropic', { content: [{ type: 'text', text }], stop_reason: 'pause_turn' }, 'invalid_response'],
    ['anthropic', { content: [{ type: 'text', text }], stop_reason: 'model_context_window_exceeded' }, 'invalid_response'],
    ['anthropic', { content: [{ type: 'text', text }], stop_reason: null }, 'invalid_response'],
    ['anthropic', { content: [{ type: 'text', text }] }, 'invalid_response'],
    ['anthropic', { content: [{ type: 'tool_use', input: answer }], stop_reason: 'tool_use' }, 'invalid_response'],
    ['anthropic', { content: [{ type: 'text', text }, { type: 'tool_use', input: answer }], stop_reason: 'end_turn' }, 'invalid_response'],
    ['anthropic', { content: [{ type: 'thinking', thinking: text }], stop_reason: 'end_turn' }, 'invalid_response'],
    ['anthropic', { choices: [{ message: { content: text } }] }, 'invalid_response'],
    ['openai', { content: [{ type: 'text', text }] }, 'invalid_response'],
    ['openai', { choices: [{ message: { content: text }, finish_reason: 'length' }] }, 'invalid_response'],
    ['openai', { choices: [{ message: { content: text }, finish_reason: 'tool_calls' }] }, 'invalid_response'],
    ['openai', { choices: [{ message: { content: text, tool_calls: [{ type: 'function', function: { name: 'unrequested', arguments: '{}' } }] } }] }, 'invalid_response'],
    ['openai', { choices: [{ message: { content: text, tool_calls: 'malformed' }, finish_reason: 'stop' }] }, 'invalid_response'],
    ['openai', { choices: [{ message: { content: text, function_call: { name: 'unrequested', arguments: '{}' } }, finish_reason: 'stop' }] }, 'invalid_response'],
    ['openai', { choices: [{ message: { content: text, refusal: 'private source' }, finish_reason: 'stop' }] }, 'invalid_response'],
    ['anthropic', { success: false, code: '390112', message: 'PAT and private source' }, 'authentication'],
    ['openai', { type: 'error', error: { type: 'invalid_request_error', message: 'extra_forbidden PAT and private source' } }, 'provider'],
  ];
  for (const [protocol, payload, code] of cases) assert.throws(() => structuredResponseText(payload, protocol), (error: unknown) => {
    assert.ok(error instanceof AIProviderError); assert.equal(error.code, code);
    assert.doesNotMatch(error.message, /PAT|private source|extra_forbidden/); return true;
  });
});

test('native Anthropic requests use x-api-key and keep SDK-only output_format out of raw JSON', async () => {
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString());
      assert.equal(request.url, '/v1/messages');
      assert.equal(request.headers['x-api-key'], 'test-only');
      assert.equal(request.headers.authorization, undefined);
      assert.equal(request.headers['anthropic-version'], '2023-06-01');
      assert.equal(request.headers['anthropic-beta'], undefined);
      assert.equal(body.system, '根拠だけを整理する');
      assert.deepEqual(body.messages, [{ role: 'user', content: '注文を保留する' }]);
      assert.deepEqual(Object.keys(body).sort(), ['model', 'max_tokens', 'system', 'messages', 'output_config'].sort());
      assert.deepEqual(Object.keys(body.output_config.format).sort(), ['schema', 'type']);
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ id: 'msg_native', type: 'message', role: 'assistant', model: body.model,
        content: [{ type: 'text', text: JSON.stringify(answer) }], stop_reason: 'end_turn', stop_sequence: null,
        stop_details: null, usage: { input_tokens: 10, output_tokens: 20 } }));
    } catch (error) { response.writeHead(400); response.end(JSON.stringify({ error: String(error) })); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await configured('anthropic', `http://127.0.0.1:${(server.address() as {port: number}).port}/v1`, async () => {
      assert.deepEqual(await structuredCall({ schemaName: 'example', schema, system: '根拠だけを整理する', user: '注文を保留する' }), answer);
    }, 'x-api-key');
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('a raw Messages HTTP response is unwrapped before validation, and a provider HTTP 400 stays distinct', async () => {
  let reject = false;
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (reject) {
      response.writeHead(400);
      response.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Extra inputs are not permitted: PAT and private source' } }));
    } else {
      response.end(JSON.stringify({ type: 'message', id: 'msg_extra', model: 'claude-sonnet-4-5', role: 'assistant',
        content: [{ type: 'text', text: JSON.stringify({ ...answer, title: 'あ'.repeat(9) }) }],
        stop_reason: 'end_turn', stop_details: null, usage: { input_tokens: 100, output_tokens: 200 }, diagnostics: { new_field: 'envelope metadata' } }));
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await configured('anthropic', `http://127.0.0.1:${(server.address() as {port: number}).port}/api/v2/cortex/v1`, async () => {
      const call = () => structuredCall({ schemaName: 'example', schema, system: '整理する', user: '注文を保留する' });
      await assert.rejects(call, (error: unknown) => {
        assert.ok(error instanceof AIProviderError); assert.equal(error.code, 'invalid_response');
        assert.match(error.message, /文字数・件数/); return true;
      });
      reject = true;
      await assert.rejects(call, (error: unknown) => {
        assert.ok(error instanceof AIProviderError); assert.equal(error.code, 'provider');
        assert.match(error.message, /HTTP 400/); assert.doesNotMatch(error.message, /PAT|private source|Extra inputs/); return true;
      });
    });
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('Claude schema transformation retains bounds and unknowns without truncating or completing facts', () => {
  const properties = Object.fromEntries(Array.from({length: 18}, (_, n) => [`unknown${n}`, {type: ['string', 'null']}]));
  const original = {...schema, properties: {...schema.properties, ...properties}, required: [...schema.required, ...Object.keys(properties)]};
  const before = structuredClone(original), prepared = prepareClaudeSchema(original);
  assert.equal(prepared.emptyStringNulls, true);
  assert.equal((prepared.schema as any).properties.unknown0.type, 'string');
  assert.equal((prepared.schema as any).properties.pages.minItems, undefined);
  assert.match((prepared.schema as any).properties.pages.description, /maxItems: 2/);
  assert.deepEqual(validateStructuredConstraints({...answer, unknown0: ''}, original, prepared.emptyStringNulls), {...answer, unknown0: null});
  for (const invalid of [{...answer, title: 'あ'.repeat(9)}, {...answer, pages: ['p1']}, {...answer, pages: ['p1', 'p2', 'p3']}]) assert.throws(() => validateStructuredConstraints(invalid, original, true), AIProviderError);
  assert.deepEqual(original, before);
});

test('the actual workflow output schema fits Claude explicit union and keyword limits', async () => {
  const source = '営業担当がSAPに受注を登録する。';
  const draft = extractGroundedLocal(source);
  let checked = false;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString()), wire = body.output_config.format.schema;
      assertClaudeWireSchema(wire);
      let unions = 0, optional = 0;
      const count = (part: any) => { if (!part || typeof part !== 'object') return; if (Array.isArray(part.type) || Array.isArray(part.anyOf)) unions++;
        for (const [name, child] of Object.entries(part.properties ?? {})) { if (!(part.required ?? []).includes(name)) optional++; count(child); }
        count(part.items); for (const key of ['anyOf', 'allOf', '$defs', 'definitions']) for (const child of Object.values(part[key] ?? {})) count(child); };
      count(wire); assert.ok(unions <= 16, `Claude union count: ${unions}`); assert.ok(optional <= 24, `Claude optional parameter count: ${optional}`); checked = true;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({type: 'message', content: [{type: 'text', text: JSON.stringify(draft)}], stop_reason: 'end_turn', usage: {input_tokens: 1, output_tokens: 1}}));
    } catch (error) { response.writeHead(400); response.end(JSON.stringify({error: String(error)})); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await configured('anthropic', `http://127.0.0.1:${(server.address() as {port: number}).port}/api/v2/cortex/v1`, async () => {
    const result = await extractWorkflowReviewWithAI({interview: source, workflow: {id: 'test', name: '受注'}, graph: {workflows: [], nodes: [], edges: [], dataFlows: []}});
    assert.equal(result.review.steps[0].actor, '営業担当'); assert.equal(checked, true);
  }); } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('endpoint paths distinguish raw fetch, SDK base URLs and incompatible Cortex inference API', () => {
  const base = 'https://test.snowflakecomputing.com/api/v2/cortex';
  assert.equal(aiEndpoint(base, 'anthropic'), `${base}/v1/messages`);
  assert.equal(aiEndpoint(`${base}/v1/`, 'anthropic'), `${base}/v1/messages`);
  assert.equal(aiEndpoint(`${base}/v1/messages`, 'anthropic'), `${base}/v1/messages`);
  assert.equal(aiEndpoint(base, 'openai'), `${base}/v1/chat/completions`);
  for (const [url, protocol] of [[`${base}/v1/chat/completions`, 'anthropic'], [`${base}/v1/messages`, 'openai'], [`${base}/inference:complete`, 'anthropic']] as const) assert.throws(() => aiEndpoint(url, protocol), AIProviderError);
});
