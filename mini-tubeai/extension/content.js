// content.js — runs in Chrome's isolated world on https://www.youtube.com/watch*.
// Draws the overlay and talks ONLY to background.js (never to the server).
// Stage 1: input + answer area; questions are echoed by the server.

// One wrapper around chrome.runtime.sendMessage. (Stage 3 adds the 35s
// timeout and single retry here.)
function sendToWorker(message) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        const le = chrome.runtime.lastError;
        if (le) reject(new Error(le.message || String(le)));
        else if (response === undefined) reject(new Error('The message port closed before a response was received.'));
        else resolve(response);
      });
    } catch (err) {
      reject(err); // e.g. "Extension context invalidated" after a reload
    }
  });
}

function describeSendError(err) {
  const m = String((err && err.message) || err);
  if (/context invalidated/i.test(m)) return 'mini TubeAI was reloaded or updated. Refresh this page.';
  return `The extension's background worker didn't answer. ${m}`;
}

function main() {
  const state = { busy: false };
  const ui = buildOverlay();

  async function ask(question) {
    if (state.busy) return;
    state.busy = true;
    ui.setBusy(true);
    ui.clearError();
    try {
      const res = await sendToWorker({ type: 'ask', question });
      if (res && res.ok) ui.showAnswer(res.answer);
      else ui.showError((res && res.error) || 'Unknown error.');
    } catch (err) {
      ui.showError(describeSendError(err));
    } finally {
      state.busy = false;
      ui.setBusy(false);
    }
  }

  function onSubmit() {
    const text = ui.input.value.trim();
    if (!text || state.busy) return;
    ui.input.value = '';
    ask(text);
  }

  // Hide the overlay off watch pages (YouTube navigates without reloading).
  const sync = () => (location.pathname === '/watch' ? ui.show() : ui.hide());
  document.addEventListener('yt-navigate-finish', sync);
  sync();

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
        .status:empty { display: none; }
        .answer { white-space: pre-wrap; overflow-y: auto; max-height: 40vh; }
        .answer:empty { display: none; }
        .error { color: #ff8a80; white-space: pre-wrap; }
        .error:empty { display: none; }
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
        <div class="error"></div>
        <div class="row"><input placeholder="Ask about this video..." /><button class="ask">Ask</button></div>
      </div>`;
    const $ = (sel) => root.querySelector(sel);
    const box = $('.box'), status = $('.status'), answer = $('.answer'), errBox = $('.error'),
      input = $('input'), askBtn = $('.ask');

    // Keep YouTube's keyboard shortcuts (k, j, l, f, space...) from firing while typing.
    for (const type of ['keydown', 'keyup', 'keypress']) {
      input.addEventListener(type, (e) => {
        e.stopPropagation();
        if (type === 'keydown' && e.key === 'Enter') onSubmit();
      });
    }
    askBtn.addEventListener('click', onSubmit);
    $('.toggle').addEventListener('click', (e) => {
      box.classList.toggle('collapsed');
      e.target.textContent = box.classList.contains('collapsed') ? '+' : '–';
    });
    document.documentElement.appendChild(host);

    return {
      input,
      show() { host.style.display = ''; },
      hide() { host.style.display = 'none'; },
      setBusy(busy) {
        input.disabled = askBtn.disabled = busy;
        status.textContent = '';
        if (busy) {
          const sp = document.createElement('span');
          sp.className = 'spin';
          status.append(sp, 'Thinking…');
        }
      },
      showAnswer(text) { answer.textContent = text; }, // textContent: never render server text as HTML
      showError(text) { errBox.textContent = text; },
      clearError() { errBox.textContent = ''; },
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { sendToWorker, describeSendError };
} else if (typeof window !== 'undefined' && !window.__miniTubeAiLoaded) {
  window.__miniTubeAiLoaded = true;
  main();
}
