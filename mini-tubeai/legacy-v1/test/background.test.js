const test = require('node:test');
const assert = require('node:assert/strict');
const { handleAsk, buildMessages, mergeStats, lockStorage, DEFAULT_MODEL, MAX_TRANSCRIPT_CHARS } =
  require('../background.js');

const KEY = { openaiApiKey: 'sk-test' };
const storage = (data) => async () => data;
const jsonResponse = (status, body) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
});
const msg = {
  question: 'What is a monad?',
  windowText: '[0:01] hello',
  currentTime: 65,
  history: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }],
};

test('success returns {ok:true,text} and sends key, model and messages', async () => {
  let call;
  const fetchFn = async (url, init) => {
    call = { url, init };
    return jsonResponse(200, { choices: [{ message: { content: ' An answer. ' } }] });
  };
  const res = await handleAsk(msg, { fetchFn, storageGet: storage(KEY) });
  assert.deepEqual(res, { ok: true, text: 'An answer.', model: DEFAULT_MODEL });
  assert.equal(call.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(call.init.headers.Authorization, 'Bearer sk-test');
  const body = JSON.parse(call.init.body);
  assert.equal(body.model, 'gpt-4');
  assert.equal(body.messages[0].role, 'system');
  assert.equal(body.messages.length, 4); // system + 2 history + question
  assert.match(body.messages[3].content, /I'm at 1:05[\s\S]*\[0:01\] hello[\s\S]*What is a monad\?/);
  assert.match(body.messages[0].content, /say so plainly/);
});

test('model can be overridden from storage', async () => {
  let model;
  const fetchFn = async (url, init) => {
    model = JSON.parse(init.body).model;
    return jsonResponse(200, { choices: [{ message: { content: 'x' } }] });
  };
  await handleAsk(msg, { fetchFn, storageGet: storage({ ...KEY, model: 'gpt-4o-mini' }) });
  assert.equal(model, 'gpt-4o-mini');
});

test('401 -> unauthorized', async () => {
  const res = await handleAsk(msg, {
    fetchFn: async () => jsonResponse(401, { error: { message: 'bad key' } }),
    storageGet: storage(KEY),
  });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'unauthorized');
  assert.match(res.error, /401/);
});

test('429 -> rate_limited, with OpenAI detail', async () => {
  const res = await handleAsk(msg, {
    fetchFn: async () => jsonResponse(429, { error: { message: 'You exceeded your current quota' } }),
    storageGet: storage(KEY),
  });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'rate_limited');
  assert.match(res.error, /quota/);
});

test('network failure -> network', async () => {
  const res = await handleAsk(msg, {
    fetchFn: async () => { throw new TypeError('Failed to fetch'); },
    storageGet: storage(KEY),
  });
  assert.equal(res.code, 'network');
  assert.equal(res.ok, false);
});

test('timeout aborts the fetch -> timeout', async () => {
  let signal;
  const fetchFn = (url, init) => new Promise((resolve, reject) => {
    signal = init.signal;
    init.signal.addEventListener('abort', () => {
      const e = new Error('aborted');
      e.name = 'AbortError';
      reject(e);
    });
  });
  const started = Date.now();
  const res = await handleAsk(msg, { fetchFn, storageGet: storage(KEY), timeoutMs: 50 });
  assert.equal(res.code, 'timeout');
  assert.equal(res.ok, false);
  assert.ok(signal.aborted);
  assert.ok(Date.now() - started < 2000);
});

test('missing or blank key -> missing_key, no fetch', async () => {
  let called = false;
  const fetchFn = async () => { called = true; };
  for (const data of [{}, { openaiApiKey: '   ' }, undefined]) {
    const res = await handleAsk(msg, { fetchFn, storageGet: storage(data) });
    assert.equal(res.code, 'missing_key');
    assert.equal(res.ok, false);
  }
  assert.equal(called, false);
});

test('key is re-read from storage on every request', async () => {
  let reads = 0;
  const storageGet = async () => { reads++; return KEY; };
  const fetchFn = async () => jsonResponse(200, { choices: [{ message: { content: 'x' } }] });
  await handleAsk(msg, { fetchFn, storageGet });
  await handleAsk(msg, { fetchFn, storageGet });
  assert.equal(reads, 2);
});

test('buildMessages caps transcript and history', () => {
  const history = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));
  history.push({ role: 'system', content: 'injected' });
  const out = buildMessages({ question: 'q', windowText: 'x'.repeat(MAX_TRANSCRIPT_CHARS + 500), history });
  assert.equal(out.length, 1 + 6 + 1);
  assert.ok(!out.some((m) => m.content === 'injected'));
  assert.deepEqual(out.slice(1, 7).map((m) => m.content), ['m4', 'm5', 'm6', 'm7', 'm8', 'm9']);
  assert.ok(out[7].content.length < MAX_TRANSCRIPT_CHARS + 200);
});

test('mergeStats adds deltas and ignores junk', () => {
  const merged = mergeStats(
    { 1: { pauses: 1, replays: 0, watchTime: 5 } },
    { 1: { pauses: 2, watchTime: 2.25 }, 2: { replays: 1 }, x: { pauses: 9 }, 3: { pauses: -4 } },
  );
  assert.deepEqual(merged[1], { pauses: 3, replays: 0, watchTime: 7.3 });
  assert.deepEqual(merged[2], { pauses: 0, replays: 1, watchTime: 0 });
  assert.equal(merged.x, undefined);
  assert.deepEqual(merged[3], { pauses: 0, replays: 0, watchTime: 0 });
});

test('lockStorage reports unsupported / rejected / ok', async () => {
  const quiet = { warn: console.warn, info: console.info };
  console.warn = console.info = () => {};
  try {
    assert.deepEqual(await lockStorage({}), { ok: false, reason: 'unsupported' });
    const rejected = await lockStorage({ setAccessLevel: async () => { throw new Error('nope'); } });
    assert.equal(rejected.ok, false);
    let arg;
    assert.deepEqual(await lockStorage({ setAccessLevel: async (a) => { arg = a; } }), { ok: true });
    assert.deepEqual(arg, { accessLevel: 'TRUSTED_CONTEXTS' });
  } finally {
    Object.assign(console, quiet);
  }
});

test('config.js key is used when no popup key is saved; popup key wins', async () => {
  const seen = [];
  const fetchFn = async (url, init) => {
    seen.push(init.headers.Authorization);
    return jsonResponse(200, { choices: [{ message: { content: 'x' } }] });
  };
  await handleAsk(msg, { fetchFn, storageGet: storage({}), configKey: 'sk-config' });
  await handleAsk(msg, { fetchFn, storageGet: storage(KEY), configKey: 'sk-config' });
  assert.deepEqual(seen, ['Bearer sk-config', 'Bearer sk-test']);
  const res = await handleAsk(msg, { fetchFn, storageGet: storage({}), configKey: '  ' });
  assert.equal(res.code, 'missing_key');
});

test('empty or missing windowText -> no_transcript, nothing sent', async () => {
  let called = false;
  const fetchFn = async () => { called = true; };
  for (const windowText of ['', '   \n', undefined]) {
    const res = await handleAsk({ ...msg, windowText }, { fetchFn, storageGet: storage(KEY) });
    assert.equal(res.code, 'no_transcript');
  }
  assert.equal(called, false);
});
