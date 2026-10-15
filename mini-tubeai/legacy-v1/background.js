// background.js — MV3 service worker.
// The ONLY place that talks to OpenAI, and the only place that touches
// chrome.storage (content scripts go through messages, so they keep working
// even when storage.local is locked to trusted contexts).

// Optional, gitignored config.js can set self.MINI_TUBEAI_API_KEY (see
// config.example.js). A key saved in the popup takes precedence.
if (typeof importScripts === 'function') {
  try { importScripts('config.js'); } catch { /* no config.js: use the popup key */ }
}

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4'; // override: chrome.storage.local.set({ model: '...' })
const OPENAI_TIMEOUT_MS = 30000;
const MAX_TRANSCRIPT_CHARS = 12000;
const MAX_HISTORY_MESSAGES = 6; // last 3 question/answer turns
const MAX_MESSAGE_CHARS = 2000;
const MAX_CLICK_LOG = 1000;
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

const SYSTEM_PROMPT =
  'You are mini TubeAI, a study assistant for the YouTube video the user is watching. ' +
  'You get a transcript excerpt from around the current playback time; timestamps are [m:ss]. ' +
  'Answer using that excerpt. If the answer is not in the excerpt, say so plainly ' +
  '(for example "The excerpt around 4:10 doesn\'t cover that."). Do not make up what the video says. ' +
  'After saying so, you may add a short general answer, clearly labelled as not from the video. ' +
  'Be concise and plain-spoken.';

const ERROR_TEXT = {
  no_transcript: 'No transcript text to send, so the question was not sent.',
  missing_key: 'No OpenAI API key saved. Open the extension popup and add one.',
  unauthorized: 'OpenAI rejected the API key (401). Check the key in the extension popup.',
  rate_limited: 'OpenAI rate limit or quota reached (429). Wait a moment and retry.',
  timeout: `OpenAI did not answer within ${OPENAI_TIMEOUT_MS / 1000}s.`,
  network: 'Could not reach OpenAI (network error).',
  http_error: 'OpenAI returned an error.',
  bad_response: 'OpenAI returned an empty or unexpected response.',
};

function fail(code, detail) {
  const base = ERROR_TEXT[code] || 'Unknown error.';
  return { ok: false, code, error: detail ? `${base} ${detail}` : base };
}

function clip(text, max) {
  const s = String(text == null ? '' : text);
  return s.length > max ? s.slice(0, max) + ' …[truncated]' : s;
}

function fmtTime(sec) {
  sec = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// { question, windowText, currentTime, history } -> OpenAI messages array
function buildMessages({ question, windowText, currentTime, history } = {}) {
  const turns = (Array.isArray(history) ? history : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => ({ role: m.role, content: clip(m.content, MAX_MESSAGE_CHARS) }));
  const excerpt = clip(windowText, MAX_TRANSCRIPT_CHARS);
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    ...turns,
    {
      role: 'user',
      content: `I'm at ${fmtTime(currentTime)} in the video.\n\n` +
        `Transcript excerpt:\n${excerpt}\n\nQuestion: ${clip(question, MAX_MESSAGE_CHARS)}`,
    },
  ];
}

// deps are injectable for tests. The key is read from storage on EVERY call:
// the service worker can be killed at any time, so nothing is cached in globals.
async function handleAsk(msg, deps = {}) {
  const fetchFn = deps.fetchFn || fetch;
  const storageGet = deps.storageGet || ((keys) => chrome.storage.local.get(keys));
  const timeoutMs = deps.timeoutMs || OPENAI_TIMEOUT_MS;

  // Never send GPT an empty transcript (content.js checks too).
  if (!msg || typeof msg.windowText !== 'string' || !msg.windowText.trim()) return fail('no_transcript');

  const stored = (await storageGet(['openaiApiKey', 'model'])) || {};
  const configKey = 'configKey' in deps ? deps.configKey : globalThis.MINI_TUBEAI_API_KEY;
  const apiKey = [stored.openaiApiKey, configKey]
    .map((k) => (typeof k === 'string' ? k.trim() : ''))
    .find(Boolean) || '';
  if (!apiKey) return fail('missing_key');
  const model = (typeof stored.model === 'string' && stored.model.trim()) || DEFAULT_MODEL;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res;
    try {
      res = await fetchFn(OPENAI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: buildMessages(msg), temperature: 0.3, max_tokens: 600 }),
        signal: controller.signal,
      });
    } catch (err) {
      return controller.signal.aborted ? fail('timeout') : fail('network', err && err.message);
    }

    if (res.status === 401) return fail('unauthorized');
    if (res.status === 429) return fail('rate_limited', await apiErrorMessage(res));
    if (!res.ok) return fail('http_error', `HTTP ${res.status}. ${await apiErrorMessage(res)}`.trim());

    let data;
    try {
      data = await res.json();
    } catch (err) {
      return controller.signal.aborted ? fail('timeout') : fail('bad_response');
    }
    const text = data && data.choices && data.choices[0] && data.choices[0].message &&
      data.choices[0].message.content;
    if (!text) return fail('bad_response');
    return { ok: true, text: String(text).trim(), model };
  } finally {
    clearTimeout(timer);
  }
}

async function apiErrorMessage(res) {
  try {
    const body = await res.json();
    return (body && body.error && body.error.message) || '';
  } catch {
    return '';
  }
}

// ---- tracking storage -------------------------------------------------------

// deltas: { [segment]: { pauses?, replays?, watchTime? } } added onto stats.
function mergeStats(stats, deltas) {
  const out = Object.assign({}, stats);
  for (const seg of Object.keys(deltas || {})) {
    if (!/^\d+$/.test(seg)) continue;
    const d = deltas[seg] || {};
    const cur = Object.assign({ pauses: 0, replays: 0, watchTime: 0 }, out[seg]);
    for (const field of ['pauses', 'replays', 'watchTime']) {
      const v = Number(d[field]);
      if (Number.isFinite(v) && v > 0) cur[field] = cur[field] + v;
    }
    cur.watchTime = Math.round(cur.watchTime * 10) / 10;
    out[seg] = cur;
  }
  return out;
}

// Serialize read-modify-write so concurrent tabs don't clobber each other.
let storageQueue = Promise.resolve();
function serialized(fn) {
  const run = storageQueue.then(fn, fn);
  storageQueue = run.catch(() => {});
  return run;
}

function addStats(videoId, deltas) {
  return serialized(async () => {
    const key = `stats:${videoId}`;
    const got = await chrome.storage.local.get(key);
    const stats = mergeStats(got[key] || {}, deltas);
    await chrome.storage.local.set({ [key]: stats });
    return { ok: true, stats };
  });
}

async function getStats(videoId) {
  const key = `stats:${videoId}`;
  const got = await chrome.storage.local.get(key);
  return { ok: true, stats: got[key] || {} };
}

function logClick({ videoId, segment, score, ts }) {
  return serialized(async () => {
    const got = await chrome.storage.local.get('suggestionClicks');
    const clicks = Array.isArray(got.suggestionClicks) ? got.suggestionClicks : [];
    clicks.push({ videoId, segment: Number(segment), score: Number(score) || 0, ts: Number(ts) || Date.now() });
    await chrome.storage.local.set({ suggestionClicks: clicks.slice(-MAX_CLICK_LOG) });
    return { ok: true };
  });
}

// ---- storage lock -----------------------------------------------------------

// Try to hide storage.local (and the API key in it) from content scripts.
// Chrome's docs say local supports this; MDN says only storage.session does.
// Either way we log the outcome; README lists the failure case as a weakness.
async function lockStorage(area) {
  if (!area || typeof area.setAccessLevel !== 'function') {
    console.warn('[mini TubeAI] storage.local.setAccessLevel is not supported here; ' +
      'content scripts could read the API key. See README "Known weaknesses".');
    return { ok: false, reason: 'unsupported' };
  }
  try {
    await area.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    console.info('[mini TubeAI] storage.local locked to trusted contexts.');
    return { ok: true };
  } catch (err) {
    console.warn('[mini TubeAI] storage.local.setAccessLevel failed: ' + (err && err.message) +
      '. Content scripts could read the API key. See README "Known weaknesses".');
    return { ok: false, reason: err && err.message };
  }
}

// ---- message routing --------------------------------------------------------

function route(msg) {
  switch (msg.type) {
    case 'ask':
      return handleAsk(msg);
    case 'addStats':
      if (!VIDEO_ID_RE.test(msg.videoId)) return Promise.resolve({ ok: false, error: 'bad videoId' });
      return addStats(msg.videoId, msg.deltas);
    case 'keyStatus':
      return chrome.storage.local.get('openaiApiKey').then(({ openaiApiKey }) => ({
        ok: true,
        source: (openaiApiKey && openaiApiKey.trim()) ? 'popup'
          : (typeof self.MINI_TUBEAI_API_KEY === 'string' && self.MINI_TUBEAI_API_KEY.trim()) ? 'config'
          : 'none',
      }));
    case 'getStats':
      if (!VIDEO_ID_RE.test(msg.videoId)) return Promise.resolve({ ok: false, error: 'bad videoId' });
      return getStats(msg.videoId);
    case 'logClick':
      if (!VIDEO_ID_RE.test(msg.videoId)) return Promise.resolve({ ok: false, error: 'bad videoId' });
      return logClick(msg);
    default:
      return Promise.resolve({ ok: false, error: `unknown message type: ${msg.type}` });
  }
}

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  // Unpacked (developer) installs have no update_url in their manifest.
  const DEV = !('update_url' in chrome.runtime.getManifest());
  // requestIds already sabotaged by devFail. In-memory on purpose: if the
  // worker really dies, the retry fails too, which exercises the error UI.
  const devFailed = new Set();

  lockStorage(chrome.storage.local); // runs on every worker start

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || !msg || typeof msg.type !== 'string') return false;

    // DEV ONLY: simulate the worker dying mid-request, once per requestId.
    //   'drop' -> no response; the sender sees "message port closed".
    //   'hang' -> never respond; the sender hits its 35s timeout.
    if (DEV && msg.devFail && msg.requestId && !devFailed.has(msg.requestId)) {
      devFailed.add(msg.requestId);
      console.warn(`[mini TubeAI] devFail=${msg.devFail} for ${msg.requestId}`);
      if (msg.devFail === 'hang') return true;
      return false;
    }

    route(msg).then(sendResponse, (err) =>
      sendResponse({ ok: false, code: 'internal', error: String((err && err.message) || err) }));
    return true; // keep the port open for the async response
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { handleAsk, buildMessages, mergeStats, lockStorage, DEFAULT_MODEL, MAX_TRANSCRIPT_CHARS };
}
