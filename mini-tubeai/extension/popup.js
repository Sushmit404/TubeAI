// popup.js — saves the server token into chrome.storage.local.
const input = document.getElementById('token');
const status = document.getElementById('status');
const SAVED_PLACEHOLDER = 'Token saved (hidden). Paste to replace.';

chrome.storage.local.get('tubeToken').then(({ tubeToken }) => {
  if (tubeToken) input.placeholder = SAVED_PLACEHOLDER;
});

document.getElementById('save').addEventListener('click', async () => {
  const token = input.value.trim();
  status.classList.remove('err');
  if (!token) {
    status.textContent = 'Paste a token first';
    status.classList.add('err');
    return;
  }
  try {
    await chrome.storage.local.set({ tubeToken: token });
    input.value = '';
    input.placeholder = SAVED_PLACEHOLDER;
    status.textContent = 'Saved ✓';
  } catch (err) {
    status.textContent = 'Save failed: ' + err.message;
    status.classList.add('err');
  }
});
