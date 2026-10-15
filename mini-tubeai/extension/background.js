// background.js — MV3 service worker.
// The ONLY extension code that talks to the local server. The token is read
// from chrome.storage.local on every request: the worker can be killed at any
// moment, so nothing is cached in worker variables.

const SERVER_URL = 'http://127.0.0.1:8000';
const SERVER_TIMEOUT_MS = 32000; // > server's 30s OpenAI timeout, < content's 35s
const START_COMMAND = 'cd mini-tubeai/server && .venv/bin/python -m tubeai';

const ERROR_TEXT = {
  missing_token: 'No server token saved. Click the mini TubeAI toolbar icon and paste the token the server printed.',
  bad_token: 'The server rejected the token (401). Paste the token the server printed into the extension popup.',
  server_down: `Start the local server:  ${START_COMMAND}`,
  timeout: `The local server did not answer within ${SERVER_TIMEOUT_MS / 1000}s.`,
  http_error: 'The local server returned an error.',
  bad_response: 'The local server sent an unexpected response.',
};

function fail(code, detail) {
  const base = ERROR_TEXT[code] || 'Unknown error.';
  return { ok: false, code, error: detail ? `${base} ${detail}` : base };
}

// POST/GET to the server. Returns {ok:true, data} or {ok:false, code, error}.
// deps are injectable for tests.
async function callServer(method, path, body, deps = {}) {
  const fetchFn = deps.fetchFn || fetch;
  const storageGet = deps.storageGet || ((keys) => chrome.storage.local.get(keys));
  const timeoutMs = deps.timeoutMs || SERVER_TIMEOUT_MS;

  const { tubeToken } = (await storageGet(['tubeToken'])) || {};
  const token = typeof tubeToken === 'string' ? tubeToken.trim() : '';
  if (!token) return fail('missing_token');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res;
    try {
      res = await fetchFn(SERVER_URL + path, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Tube-Token': token },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      // fetch rejects with TypeError when nothing listens on 127.0.0.1:8000.
      return controller.signal.aborted ? fail('timeout') : fail('server_down');
    }
    if (res.status === 401) return fail('bad_token');
    let data;
    try {
      data = await res.json();
    } catch {
      return controller.signal.aborted ? fail('timeout') : fail('bad_response', `HTTP ${res.status}.`);
    }
    if (!res.ok) {
      const detail = data && (typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail));
      return fail('http_error', `HTTP ${res.status}. ${detail || ''}`.trim());
    }
    return { ok: true, data };
  } finally {
    clearTimeout(timer);
  }
}

// Stage 1: the server just echoes the question.
async function handleAsk(msg, deps) {
  const res = await callServer('POST', '/ask', { question: String(msg.question || '') }, deps);
  if (!res.ok) return res;
  const { answer, sources } = res.data || {};
  if (typeof answer !== 'string') return fail('bad_response');
  return { ok: true, answer, sources: Array.isArray(sources) ? sources : [] };
}

function route(msg) {
  switch (msg.type) {
    case 'ask':
      return handleAsk(msg);
    default:
      return Promise.resolve({ ok: false, code: 'bad_request', error: `unknown message type: ${msg.type}` });
  }
}

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || !msg || typeof msg.type !== 'string') return false;
    route(msg).then(sendResponse, (err) =>
      sendResponse({ ok: false, code: 'internal', error: String((err && err.message) || err) }));
    return true; // keep the port open for the async reply
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { callServer, handleAsk, SERVER_URL, START_COMMAND };
}
