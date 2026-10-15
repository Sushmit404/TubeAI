const test = require('node:test');
const assert = require('node:assert/strict');
const { handleAsk, callServer, SERVER_URL } = require('../background.js');

const TOKEN = { tubeToken: 'tok-123' };
const storage = (data) => async () => data;
const json = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

test('ask: sends token header and returns the echo', async () => {
  let call;
  const fetchFn = async (url, init) => { call = { url, init }; return json(200, { answer: 'Echo: hi', sources: [] }); };
  const res = await handleAsk({ question: 'hi' }, { fetchFn, storageGet: storage(TOKEN) });
  assert.deepEqual(res, { ok: true, answer: 'Echo: hi', sources: [] });
  assert.equal(call.url, `${SERVER_URL}/ask`);
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers['X-Tube-Token'], 'tok-123');
  assert.deepEqual(JSON.parse(call.init.body), { question: 'hi' });
});

test('missing token: no request, clear message', async () => {
  let called = false;
  const fetchFn = async () => { called = true; };
  for (const data of [{}, { tubeToken: '  ' }, undefined]) {
    const res = await handleAsk({ question: 'hi' }, { fetchFn, storageGet: storage(data) });
    assert.equal(res.code, 'missing_token');
  }
  assert.equal(called, false);
});

test('token is re-read from storage on every request', async () => {
  let reads = 0;
  const storageGet = async () => { reads++; return TOKEN; };
  const fetchFn = async () => json(200, { answer: 'x' });
  await handleAsk({ question: 'a' }, { fetchFn, storageGet });
  await handleAsk({ question: 'b' }, { fetchFn, storageGet });
  assert.equal(reads, 2);
});

test('401 -> bad_token', async () => {
  const res = await handleAsk({ question: 'hi' }, {
    fetchFn: async () => json(401, { detail: 'Missing or wrong X-Tube-Token.' }),
    storageGet: storage(TOKEN),
  });
  assert.equal(res.code, 'bad_token');
});

test('server not running -> server_down with the start command', async () => {
  const res = await handleAsk({ question: 'hi' }, {
    fetchFn: async () => { throw new TypeError('Failed to fetch'); },
    storageGet: storage(TOKEN),
  });
  assert.equal(res.code, 'server_down');
  assert.match(res.error, /python -m tubeai/);
});

test('server hangs -> timeout, never waits forever', async () => {
  const fetchFn = (url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  const res = await callServer('POST', '/ask', {}, { fetchFn, storageGet: storage(TOKEN), timeoutMs: 30 });
  assert.equal(res.code, 'timeout');
});

test('other HTTP errors carry the server detail', async () => {
  const res = await handleAsk({ question: 'hi' }, {
    fetchFn: async () => json(422, { detail: [{ msg: 'too long' }] }),
    storageGet: storage(TOKEN),
  });
  assert.equal(res.code, 'http_error');
  assert.match(res.error, /422.*too long/);
});
