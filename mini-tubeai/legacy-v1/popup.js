// popup.js — saves the OpenAI API key into chrome.storage.local.
// The popup is a trusted extension page, so it can use storage directly.
const keyInput = document.getElementById('key');
const status = document.getElementById('status');

// Ask the background which key it will use (it can see config.js; we can't).
chrome.runtime.sendMessage({ type: 'keyStatus' }).then((res) => {
  const source = res && res.source;
  if (source === 'popup') keyInput.placeholder = 'Key saved (hidden). Paste to replace.';
  else if (source === 'config') {
    keyInput.placeholder = 'Paste a key to override config.js';
    status.textContent = 'Using key from config.js ✓';
  }
}).catch(() => {});

document.getElementById('save').addEventListener('click', async () => {
  const key = keyInput.value.trim();
  status.classList.remove('err');
  if (!key) {
    status.textContent = 'Enter a key first';
    status.classList.add('err');
    return;
  }
  try {
    await chrome.storage.local.set({ openaiApiKey: key });
    keyInput.value = '';
    keyInput.placeholder = 'Key saved (hidden). Paste to replace.';
    status.textContent = 'Saved ✓';
  } catch (err) {
    status.textContent = 'Save failed: ' + err.message;
    status.classList.add('err');
  }
});
