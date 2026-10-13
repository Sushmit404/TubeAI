// popup.js — saves the OpenAI API key into chrome.storage.local.
// The popup is a trusted extension page, so it can use storage directly.
const keyInput = document.getElementById('key');
const status = document.getElementById('status');

chrome.storage.local.get('openaiApiKey').then(({ openaiApiKey }) => {
  if (openaiApiKey) keyInput.placeholder = 'Key saved (hidden). Paste to replace.';
});

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
