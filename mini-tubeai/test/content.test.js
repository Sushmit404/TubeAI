const test = require('node:test');
const assert = require('node:assert/strict');
const {
  sendWithRetry, extractJsonObject, parseJson3, pickTrack, centeredWindow, windowAround, fmtTime,
} = require('../content.js');

const portClosed = () => new Error('The message port closed before a response was received.');

test('retry: port closed once, then succeeds on retry', async () => {
  const calls = [];
  let retried = 0;
  const send = async (m, attempt) => {
    calls.push(attempt);
    if (attempt === 0) throw portClosed();
    return { ok: true, text: 'hi' };
  };
  const res = await sendWithRetry({ type: 'ask' }, { send, onRetry: () => retried++ });
  assert.deepEqual(res, { ok: true, text: 'hi' });
  assert.deepEqual(calls, [0, 1]);
  assert.equal(retried, 1);
});

test('retry: worker hangs (timeout) once, then succeeds on retry', async () => {
  let n = 0;
  const send = () => (n++ === 0 ? new Promise(() => {}) : Promise.resolve({ ok: true, text: 'late' }));
  const res = await sendWithRetry({ type: 'ask' }, { send, timeoutMs: 30 });
  assert.equal(res.text, 'late');
  assert.equal(n, 2);
});

test('retry: fails after exactly one retry', async () => {
  let n = 0;
  const send = () => { n++; return new Promise(() => {}); };
  await assert.rejects(sendWithRetry({ type: 'ask' }, { send, timeoutMs: 20 }), (err) => err.code === 'timeout');
  assert.equal(n, 2);

  let m = 0;
  await assert.rejects(
    sendWithRetry({ type: 'ask' }, { send: async () => { m++; throw portClosed(); } }),
    /message port closed/,
  );
  assert.equal(m, 2);
});

test('retry: non-retryable errors and retries:0 do not retry', async () => {
  let n = 0;
  await assert.rejects(
    sendWithRetry({}, { send: async () => { n++; throw new Error('Extension context invalidated.'); } }),
    /context invalidated/,
  );
  assert.equal(n, 1);

  let m = 0;
  await assert.rejects(
    sendWithRetry({}, { retries: 0, send: async () => { m++; throw portClosed(); } }),
    /port closed/,
  );
  assert.equal(m, 1);
});

test('an {ok:false} reply from the background is returned, not retried', async () => {
  let n = 0;
  const res = await sendWithRetry({}, { send: async () => { n++; return { ok: false, code: 'rate_limited' }; } });
  assert.equal(res.code, 'rate_limited');
  assert.equal(n, 1);
});

test('extractJsonObject finds the player response in page HTML', () => {
  const html = '<script>var ytInitialPlayerResponse = null;</script>' +
    '<script>var ytInitialPlayerResponse = {"videoDetails":{"videoId":"abcdefghijk"},' +
    '"s":"brace } and \\" quote {"};var meta = {};</script>';
  const pr = extractJsonObject(html, 'ytInitialPlayerResponse');
  assert.equal(pr.videoDetails.videoId, 'abcdefghijk');
  assert.equal(pr.s, 'brace } and " quote {');
  assert.equal(extractJsonObject('nothing here', 'ytInitialPlayerResponse'), null);
});

test('parseJson3 and pickTrack', () => {
  const entries = parseJson3({
    events: [
      { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: 'Hello' }, { utf8: '  world' }] },
      { tStartMs: 2000 }, // no segs
      { tStartMs: 2500, segs: [{ utf8: '\n' }] }, // blank
      { tStartMs: 61000, dDurationMs: 1000, segs: [{ utf8: 'later' }] },
    ],
  });
  assert.deepEqual(entries, [
    { start: 0, dur: 2, text: 'Hello world' },
    { start: 61, dur: 1, text: 'later' },
  ]);
  const tracks = [
    { languageCode: 'de' },
    { languageCode: 'en', kind: 'asr' },
    { languageCode: 'en-GB' },
  ];
  assert.equal(pickTrack(tracks).languageCode, 'en-GB');
  assert.equal(pickTrack(tracks.slice(0, 2)).languageCode, 'en');
  assert.equal(pickTrack([]), null);
});

test('transcript windows', () => {
  const entries = Array.from({ length: 100 }, (_, i) => ({ start: i * 10, text: `line${i}` }));
  const w = windowAround(entries, 300, 60).split('\n');
  assert.equal(w.length, 13); // 240..360
  assert.equal(w[0], '[4:00] line24');
  const c = centeredWindow(entries, 500, 60);
  assert.ok(c.length <= 60);
  assert.ok(c.includes('line50'));
  assert.equal(fmtTime(3725), '1:02:05');
});
