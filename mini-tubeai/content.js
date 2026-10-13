// content.js — overlay, transcript, <video> tracking.
// Runs in Chrome's isolated world on https://www.youtube.com/watch*.
// rank.js is loaded before this file and provides getTopTopics().
// Never calls OpenAI or chrome.storage directly: everything goes through
// sendWithRetry() -> background.js.

const SEGMENT_SECONDS = 30;
const PAUSE_DEBOUNCE_MS = 800;
const PAUSE_WINDOW_SECONDS = 60;
const QUESTION_WINDOW_SECONDS = 60; // +/- around video.currentTime
const WINDOW_MAX_CHARS = 6000;      // ~2 min of speech is ~2-3k chars; this is headroom
const MAX_TURNS = 3;                // question/answer pairs kept per video and sent
const MESSAGE_TIMEOUT_MS = 35000;
const STATS_FLUSH_MS = 10000;
const AUTO_EXPLAIN_ON_PAUSE = true;
const PLAYER_MARKER = 'ytInitialPlayerResponse';

const DEV = (() => {
  try { return !('update_url' in chrome.runtime.getManifest()); } catch { return false; }
})();

// ---- messaging --------------------------------------------------------------

function chromeSend(message) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        const le = chrome.runtime.lastError;
        if (le) reject(new Error(le.message || String(le)));
        else if (response === undefined) {
          reject(new Error('The message port closed before a response was received.'));
        } else resolve(response);
      });
    } catch (err) {
      reject(err); // e.g. "Extension context invalidated" after a reload
    }
  });
}

function isRetryable(err) {
  if (!err) return false;
  if (err.code === 'timeout') return true;
  return /message port closed|Receiving end does not exist/i.test(String(err.message || err));
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`No reply from the background worker after ${ms / 1000}s.`);
      err.code = 'timeout';
      reject(err);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// The ONE wrapper around chrome.runtime.sendMessage. On a timeout or a closed
// port it retries once (retries=1), then throws. Note: retrying an 'ask' can
// make a second OpenAI call if the first one actually went out (see README).
async function sendWithRetry(message, opts = {}) {
  const send = opts.send || chromeSend;
  const timeoutMs = opts.timeoutMs || MESSAGE_TIMEOUT_MS;
  const retries = opts.retries === undefined ? 1 : opts.retries;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await withTimeout(Promise.resolve().then(() => send(message, attempt)), timeoutMs);
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !isRetryable(err)) break;
      if (opts.onRetry) opts.onRetry(err, attempt + 1);
    }
  }
  throw lastErr;
}

// ---- transcript -------------------------------------------------------------

// Find `<marker> = {...}` in a blob of JS/HTML and JSON.parse the object,
// matching braces while respecting string literals.
function extractJsonObject(text, marker) {
  let from = 0;
  while (true) {
    const i = text.indexOf(marker, from);
    if (i < 0) return null;
    from = i + marker.length;
    const m = /^["'\]]*\s*=\s*/.exec(text.slice(from, from + 10));
    if (!m || text[from + m[0].length] !== '{') continue;
    const start = from + m[0].length;
    let depth = 0, inStr = false, esc = false;
    for (let j = start; j < text.length; j++) {
      const c = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        try { return JSON.parse(text.slice(start, j + 1)); } catch { break; }
      }
    }
  }
}

// Isolated-world content scripts can't read window.ytInitialPlayerResponse.
// 1) On a fresh page load the response is inline in a <script> tag; use it if
//    it is for the right video.
// 2) After SPA navigation those tags are stale, so fetch the watch page HTML
//    (same origin, no extra permission) and parse it out of that.
async function getPlayerResponse(videoId) {
  for (const s of document.querySelectorAll('script')) {
    const t = s.textContent;
    if (!t || !t.includes(PLAYER_MARKER)) continue;
    const pr = extractJsonObject(t, PLAYER_MARKER);
    if (pr && pr.videoDetails && pr.videoDetails.videoId === videoId) return pr;
  }
  const res = await fetch(`/watch?v=${encodeURIComponent(videoId)}`, { credentials: 'include' });
  if (!res.ok) throw new Error(`watch page HTTP ${res.status}`);
  const pr = extractJsonObject(await res.text(), PLAYER_MARKER);
  if (!pr || !pr.videoDetails || pr.videoDetails.videoId !== videoId) {
    throw new Error('could not find the player response in the watch page');
  }
  return pr;
}

// Prefer manual English, then auto-generated English, then any manual, then any.
function pickTrack(tracks) {
  const en = (t) => /^en/i.test(t.languageCode || '');
  const asr = (t) => t.kind === 'asr';
  return tracks.find((t) => en(t) && !asr(t)) || tracks.find(en) ||
    tracks.find((t) => !asr(t)) || tracks[0] || null;
}

// json3 -> [{ startSec, endSec, text }]
function parseJson3(data) {
  const events = (data && data.events) || [];
  return events
    .filter((e) => Array.isArray(e.segs))
    .map((e) => {
      const startSec = (e.tStartMs || 0) / 1000;
      return {
        startSec,
        endSec: startSec + (e.dDurationMs || 0) / 1000,
        text: e.segs.map((s) => s.utf8 || '').join('').replace(/\s+/g, ' ').trim(),
      };
    })
    .filter((e) => e.text);
}

async function loadTranscript(videoId) {
  let pr;
  try {
    pr = await getPlayerResponse(videoId);
  } catch (err) {
    return { status: 'error', message: `Couldn't read this video's caption list (${err.message}).` };
  }
  const tracks = (((pr.captions || {}).playerCaptionsTracklistRenderer || {}).captionTracks) || [];
  const track = pickTrack(tracks);
  if (!track) return { status: 'none', message: 'This video has no captions, so mini TubeAI can\'t read it.' };
  try {
    const url = new URL(track.baseUrl, location.origin);
    url.searchParams.set('fmt', 'json3');
    const res = await fetch(url.toString(), { credentials: 'include' });
    const body = res.ok ? await res.text() : '';
    const entries = body ? parseJson3(JSON.parse(body)) : [];
    if (!entries.length) {
      return { status: 'error', message: 'Captions exist, but YouTube returned an empty transcript. Reload the page and try again.' };
    }
    return { status: 'ok', entries, language: track.languageCode };
  } catch (err) {
    return { status: 'error', message: `Couldn't download the transcript (${err.message}).` };
  }
}

// ---- transcript windows -----------------------------------------------------

function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

const segmentOf = (t) => Math.max(0, Math.floor(t / SEGMENT_SECONDS));
const line = (e) => `[${fmtTime(e.startSec)}] ${e.text}`;

function windowAround(entries, center, halfSeconds) {
  return entries.filter((e) => e.startSec >= center - halfSeconds && e.startSec <= center + halfSeconds)
    .map(line).join('\n');
}

// Transcript window for a question: every line overlapping
// [currentTime - halfSec, currentTime + halfSec], as "[m:ss] text" lines.
// Near the start or end of the video the window is simply clipped (not
// shifted). If it is longer than maxChars, lines farthest from currentTime
// are dropped first. Returns '' when nothing overlaps.
function buildWindow(entries, currentTime, opts = {}) {
  const halfSec = opts.halfSec === undefined ? QUESTION_WINDOW_SECONDS : opts.halfSec;
  const maxChars = opts.maxChars === undefined ? WINDOW_MAX_CHARS : opts.maxChars;
  const t = Number(currentTime) || 0;
  const picked = (entries || []).filter((e) =>
    Math.max(e.endSec, e.startSec) >= t - halfSec && e.startSec <= t + halfSec);
  const lines = picked.map(line);
  let size = lines.reduce((n, l) => n + l.length + 1, 0) - 1;
  const dist = (e) => Math.abs((e.startSec + Math.max(e.endSec, e.startSec)) / 2 - t);
  while (size > maxChars && lines.length > 1) {
    const dropFirst = dist(picked[0]) > dist(picked[picked.length - 1]);
    const removed = dropFirst ? (picked.shift(), lines.shift()) : (picked.pop(), lines.pop());
    size -= removed.length + 1;
  }
  if (lines.length === 1 && lines[0].length > maxChars) lines[0] = lines[0].slice(0, maxChars);
  return lines.join('\n');
}

function segmentText(entries, seg) {
  return entries.filter((e) => segmentOf(e.startSec) === seg).map((e) => e.text).join(' ');
}

// ---- main (browser only) ----------------------------------------------------

function main() {
  const state = {
    videoId: null,
    gen: 0,              // bumps on every video change; stale async results are dropped
    transcript: null,    // { status, entries?, message? }
    history: [],
    busy: false,
    stats: {},
    pending: {},         // unsaved stat deltas
    watched: new Set(),  // segments watched this session (for replay detection)
    lastTime: 0,
    lastReplay: null,
    pauseTimer: null,
  };
  const attachedVideos = new WeakSet();
  const ui = buildOverlay();

  function currentVideoId() {
    if (location.pathname !== '/watch') return null;
    return new URLSearchParams(location.search).get('v');
  }
  const getVideo = () => document.querySelector('video.html5-main-video') || document.querySelector('video');
  const adShowing = () => !!document.querySelector('.html5-video-player.ad-showing');

  // ---- stats ----
  function addDelta(seg, field, amount) {
    const d = state.pending[seg] || (state.pending[seg] = { pauses: 0, replays: 0, watchTime: 0 });
    d[field] += amount;
  }

  function flushStats() {
    const videoId = state.videoId, deltas = state.pending, gen = state.gen;
    if (!videoId || !Object.keys(deltas).length) return;
    state.pending = {};
    // No retry: a duplicate would double-count. Losing one batch is acceptable.
    sendWithRetry({ type: 'addStats', videoId, deltas }, { retries: 0 })
      .then((r) => {
        if (gen === state.gen && r && r.ok) { state.stats = r.stats; renderSuggestions(); }
      })
      .catch((err) => console.warn('[mini TubeAI] stats flush failed:', err.message));
  }

  // ---- video events ----
  function attachVideo() {
    const video = getVideo();
    if (!video || attachedVideos.has(video)) return;
    attachedVideos.add(video);
    state.lastTime = video.currentTime;

    video.addEventListener('timeupdate', () => {
      const t = video.currentTime;
      if (state.videoId && !video.paused && !video.seeking && !adShowing()) {
        const d = t - state.lastTime;
        if (d > 0 && d <= 1.5) { // larger jumps are seeks, not watching
          const seg = segmentOf(state.lastTime);
          addDelta(seg, 'watchTime', d);
          state.watched.add(seg);
        }
      }
      state.lastTime = t;
    });

    video.addEventListener('seeking', () => {
      clearTimeout(state.pauseTimer);
      const t = video.currentTime;
      if (state.videoId && !adShowing() && t < state.lastTime - 1) {
        const seg = segmentOf(t);
        const now = Date.now();
        const dup = state.lastReplay && state.lastReplay.seg === seg && now - state.lastReplay.at < 2000;
        if (state.watched.has(seg) && !dup) {
          addDelta(seg, 'replays', 1);
          state.lastReplay = { seg, at: now };
        }
      }
      state.lastTime = t;
    });

    video.addEventListener('play', () => {
      clearTimeout(state.pauseTimer);
      state.lastTime = video.currentTime;
    });

    video.addEventListener('pause', () => {
      clearTimeout(state.pauseTimer);
      if (video.ended || adShowing()) return;
      state.pauseTimer = setTimeout(() => onSettledPause(video), PAUSE_DEBOUNCE_MS);
    });
  }

  function onSettledPause(video) {
    if (!video.paused || video.seeking || !state.videoId) return;
    const t = video.currentTime;
    addDelta(segmentOf(t), 'pauses', 1);
    flushStats();
    const tr = state.transcript;
    if (!AUTO_EXPLAIN_ON_PAUSE || state.busy || !tr || tr.status !== 'ok') return;
    const excerpt = windowAround(tr.entries, t, PAUSE_WINDOW_SECONDS);
    if (!excerpt) return;
    ask(
      `I paused at ${fmtTime(t)}. In 2-4 sentences, explain what is being discussed around this point. ` +
      'Then give a 2-question quiz on it, with the answers listed after both questions.',
      excerpt,
      { label: `Explaining ${fmtTime(t)}…`, historyText: `Explain the part around ${fmtTime(t)} and quiz me.` },
    );
  }

  // ---- asking ----
  const ERRORS_BY_CODE = {
    missing_key: 'No OpenAI API key saved. Click the mini TubeAI toolbar icon to add one.',
  };

  function describeSendError(err) {
    const m = String((err && err.message) || err);
    if (/context invalidated/i.test(m)) return 'mini TubeAI was reloaded or updated. Refresh this page.';
    return `The extension's background worker didn't answer (tried twice). ${m}`;
  }

  async function ask(question, excerpt, opts = {}) {
    if (state.busy) return;
    if (!excerpt || !excerpt.trim()) return; // never send GPT an empty transcript
    const gen = state.gen;
    const video = getVideo();
    const msg = {
      type: 'ask',
      requestId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      question,
      windowText: excerpt,
      currentTime: video ? video.currentTime : 0,
      history: state.history.slice(-MAX_TURNS * 2),
    };
    if (opts.devFail) msg.devFail = opts.devFail;
    const retry = () => ask(question, excerpt, Object.assign({}, opts, { devFail: undefined }));

    state.busy = true;
    ui.setBusy(true, opts.label || 'Thinking…');
    ui.clearError();
    try {
      const res = await sendWithRetry(msg, {
        onRetry: () => ui.setBusy(true, 'Background worker didn\'t answer. Retrying once…'),
      });
      if (gen !== state.gen) return;
      if (res && res.ok) {
        ui.showAnswer(res.text);
        state.history.push(
          { role: 'user', content: opts.historyText || question },
          { role: 'assistant', content: res.text },
        );
        state.history = state.history.slice(-MAX_TURNS * 2);
      } else {
        ui.showError((res && (ERRORS_BY_CODE[res.code] || res.error)) || 'Unknown error.', retry);
      }
    } catch (err) {
      if (gen === state.gen) ui.showError(describeSendError(err), retry);
    } finally {
      if (gen === state.gen) {
        state.busy = false;
        ui.setBusy(false);
      }
    }
  }

  function onSubmit(raw) {
    let text = raw.trim();
    if (!text || state.busy) return;
    let devFail;
    // DEV ONLY: "/fail drop <question>" or "/fail hang <question>"
    const m = DEV && /^\/fail\s+(drop|hang)\s*(.*)$/i.exec(text);
    if (m) { devFail = m[1].toLowerCase(); text = m[2] || 'Summarize this part of the video.'; }
    const tr = state.transcript;
    if (!tr || tr.status !== 'ok') return; // input is disabled in this state anyway
    const video = getVideo();
    const t = video ? video.currentTime : 0;
    const windowText = buildWindow(tr.entries, t);
    if (!windowText) {
      ui.showError(`Nothing is said within ${QUESTION_WINDOW_SECONDS}s of ${fmtTime(t)}, so there's no transcript to ask about. Move to a part with speech.`);
      return;
    }
    ui.input.value = '';
    ask(text, windowText, { devFail });
  }

  // ---- suggestions ----
  function renderSuggestions() {
    const tr = state.transcript;
    if (!tr || tr.status !== 'ok') return ui.setSuggestions([]);
    const top = getTopTopics(state.stats, 4)
      .map((t) => ({ ...t, text: segmentText(tr.entries, t.segment) }))
      .filter((t) => t.text);
    ui.setSuggestions(top.map((t) => {
      const from = fmtTime(t.segment * SEGMENT_SECONDS), to = fmtTime((t.segment + 1) * SEGMENT_SECONDS);
      const snippet = t.text.length > 200 ? t.text.slice(0, 200) + '…' : t.text;
      const short = t.text.length > 40 ? t.text.slice(0, 40) + '…' : t.text;
      return {
        label: `${from} · ${short}`,
        onClick: () => {
          if (state.busy) return;
          sendWithRetry({ type: 'logClick', videoId: state.videoId, segment: t.segment, score: t.score, ts: Date.now() },
            { retries: 0 }).catch(() => {});
          ask(
            `Explain the part from ${from} to ${to}, which says: "${snippet}". ` +
            'What is the key idea, and what is most likely to be confusing about it?',
            windowAround(tr.entries, t.segment * SEGMENT_SECONDS + SEGMENT_SECONDS / 2, SEGMENT_SECONDS),
            { label: `Explaining ${from}…`, historyText: `Explain ${from}–${to}.` },
          );
        },
      };
    }));
  }

  // ---- navigation ----
  async function onNavigate() {
    const id = currentVideoId();
    if (id === state.videoId) return attachVideo();
    flushStats(); // save the previous video's deltas first
    clearTimeout(state.pauseTimer);
    state.gen++;
    Object.assign(state, {
      videoId: id, transcript: null, history: [], busy: false, stats: {}, pending: {},
      watched: new Set(), lastReplay: null,
    });
    const gen = state.gen;
    ui.reset();
    if (!id) return ui.hide();
    ui.show();
    const video = getVideo();
    state.lastTime = video ? video.currentTime : 0;
    attachVideo();

    sendWithRetry({ type: 'getStats', videoId: id })
      .then((r) => { if (gen === state.gen && r && r.ok) { state.stats = r.stats; renderSuggestions(); } })
      .catch(() => {});

    ui.setStatus('Loading transcript…');
    const tr = await loadTranscript(id);
    if (gen !== state.gen) return;
    state.transcript = tr;
    if (tr.status === 'ok') {
      ui.setAskEnabled(true);
      ui.setStatus(`Transcript loaded (${tr.entries.length} lines). Pause the video or ask a question.`);
      renderSuggestions();
    } else {
      ui.setAskEnabled(false, tr.status === 'none' ? 'No captions: asking is off' : 'No transcript: asking is off');
      ui.setStatus(tr.message, true);
    }
  }

  document.addEventListener('yt-navigate-finish', () => { onNavigate(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushStats(); });
  window.addEventListener('pagehide', flushStats);
  setInterval(flushStats, STATS_FLUSH_MS);
  // The <video> element can appear after document_idle; keep checking cheaply.
  setInterval(attachVideo, 2000);
  onNavigate();

  // ---- overlay ----
  function buildOverlay() {
    const host = document.createElement('div');
    host.id = 'mini-tubeai-host';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        .box { position: fixed; right: 16px; bottom: 80px; width: 340px; max-height: 70vh;
          display: flex; flex-direction: column; gap: 8px; padding: 12px; box-sizing: border-box;
          background: #1f1f1f; color: #f1f1f1; border: 1px solid #3a3a3a; border-radius: 10px;
          font: 13px/1.45 Roboto, Arial, sans-serif; z-index: 2147483647;
          box-shadow: 0 6px 24px rgba(0,0,0,.4); }
        .box.collapsed > :not(header) { display: none; }
        header { display: flex; justify-content: space-between; align-items: center; font-weight: 600; }
        button { font: inherit; cursor: pointer; border-radius: 6px; border: 1px solid #555;
          background: #2c2c2c; color: inherit; padding: 4px 8px; }
        button:hover { background: #3a3a3a; }
        button:disabled, input:disabled { opacity: .5; cursor: default; }
        .status { color: #aaa; font-size: 12px; }
        .status.warn { color: #f5c46b; }
        .answer { white-space: pre-wrap; overflow-y: auto; max-height: 40vh; }
        .answer:empty { display: none; }
        .error { color: #ff8a80; display: flex; gap: 8px; align-items: flex-start; }
        .error[hidden] { display: none; }
        .sugg { display: flex; flex-wrap: wrap; gap: 6px; }
        .sugg button { font-size: 12px; text-align: left; }
        .row { display: flex; gap: 6px; }
        input { flex: 1; font: inherit; padding: 6px 8px; border-radius: 6px; border: 1px solid #555;
          background: #121212; color: inherit; min-width: 0; }
        .spin { display: inline-block; width: 10px; height: 10px; margin-right: 6px; border: 2px solid #777;
          border-top-color: #fff; border-radius: 50%; animation: s 0.8s linear infinite; vertical-align: -1px; }
        @keyframes s { to { transform: rotate(360deg); } }
      </style>
      <div class="box">
        <header><span>mini TubeAI</span><button class="toggle" title="Collapse">–</button></header>
        <div class="status"></div>
        <div class="answer"></div>
        <div class="error" hidden><span class="msg"></span><button class="retry">Retry</button></div>
        <div class="sugg"></div>
        <div class="row"><input placeholder="Ask about this video..." /><button class="ask">Ask</button></div>
      </div>`;
    const $ = (sel) => root.querySelector(sel);
    const box = $('.box'), status = $('.status'), answer = $('.answer'), errBox = $('.error'),
      errMsg = $('.msg'), retryBtn = $('.retry'), sugg = $('.sugg'), input = $('input'), askBtn = $('.ask');
    let retryFn = null;
    let askAllowed = false; // true only once a transcript is loaded
    const PLACEHOLDER = 'Ask about this video...';

    // Keep YouTube's keyboard shortcuts (k, j, l, f, space...) from firing while typing.
    for (const type of ['keydown', 'keyup', 'keypress']) {
      input.addEventListener(type, (e) => {
        e.stopPropagation();
        if (type === 'keydown' && e.key === 'Enter') onSubmit(input.value);
      });
    }
    askBtn.addEventListener('click', () => onSubmit(input.value));
    retryBtn.addEventListener('click', () => { const f = retryFn; errBox.hidden = true; if (f) f(); });
    $('.toggle').addEventListener('click', (e) => {
      box.classList.toggle('collapsed');
      e.target.textContent = box.classList.contains('collapsed') ? '+' : '–';
    });
    document.documentElement.appendChild(host);

    const api = {
      input,
      show() { host.style.display = ''; },
      hide() { host.style.display = 'none'; },
      setStatus(text, warn) { status.textContent = text; status.classList.toggle('warn', !!warn); },
      setAskEnabled(enabled, placeholder) {
        askAllowed = enabled;
        input.disabled = askBtn.disabled = !enabled || state.busy;
        input.placeholder = enabled ? PLACEHOLDER : (placeholder || 'Loading transcript…');
      },
      setBusy(busy, label) {
        input.disabled = askBtn.disabled = busy || !askAllowed;
        for (const b of sugg.querySelectorAll('button')) b.disabled = busy;
        if (busy) {
          status.textContent = '';
          const sp = document.createElement('span');
          sp.className = 'spin';
          status.append(sp, label || 'Thinking…');
          status.classList.remove('warn');
        } else if (status.querySelector('.spin')) {
          status.textContent = '';
        }
      },
      showAnswer(text) { answer.textContent = text; }, // textContent: never render model output as HTML
      showError(text, onRetry) {
        errMsg.textContent = text;
        retryFn = onRetry || null;
        retryBtn.hidden = !onRetry;
        errBox.hidden = false;
      },
      clearError() { errBox.hidden = true; retryFn = null; },
      setSuggestions(items) {
        sugg.textContent = '';
        for (const it of items) {
          const b = document.createElement('button');
          b.textContent = it.label;
          b.title = 'Ask about this part';
          b.disabled = state.busy;
          b.addEventListener('click', it.onClick);
          sugg.append(b);
        }
      },
      reset() {
        answer.textContent = '';
        api.clearError();
        api.setSuggestions([]);
        api.setStatus('');
        input.value = '';
        api.setAskEnabled(false, 'Loading transcript…');
      },
    };
    return api;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    sendWithRetry, isRetryable, withTimeout, extractJsonObject, parseJson3, pickTrack,
    fmtTime, segmentOf, windowAround, buildWindow, segmentText,
  };
} else if (typeof window !== 'undefined' && !window.__miniTubeAiLoaded) {
  window.__miniTubeAiLoaded = true;
  main();
}
