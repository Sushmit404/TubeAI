// popup.js

document.addEventListener('DOMContentLoaded', () => {
  const startBtn = document.getElementById('start-btn');
  const statusDiv = document.getElementById('status');

  // Reset assistantStarted to false on YouTube navigation or reload
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs[0] && tabs[0].url && tabs[0].url.includes('youtube.com')) {
      chrome.storage.local.set({ assistantStarted: false });
    }
  });

  // Check if already started (use assistantStarted flag)
  function updateButtonState() {
    chrome.storage.local.get(['assistantStarted'], (res) => {
      if (res.assistantStarted) {
        statusDiv.textContent = 'Assistant is already started!';
        startBtn.disabled = true;
        startBtn.style.background = '#aaa';
        startBtn.style.cursor = 'not-allowed';
      } else {
        statusDiv.textContent = '';
        startBtn.disabled = false;
        startBtn.style.background = '';
        startBtn.style.cursor = 'pointer';
      }
    });
  }

  updateButtonState();

  startBtn.addEventListener('click', () => {
    chrome.storage.local.set({ assistantStarted: true }, () => {
      statusDiv.textContent = 'Assistant started! You can now use the floating panel on YouTube.';
      startBtn.disabled = true;
      startBtn.style.background = '#aaa';
      startBtn.style.cursor = 'not-allowed';
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { type: 'SHOW_ASSISTANT_WINDOW' });
        }
      });
    });
  });

  // Listen for storage changes (in case navigation resets assistantStarted)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.assistantStarted) {
      updateButtonState();
    }
  });
  
  // Listen for messages (for debugging)
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[Popup] Received message:', message);
    if (message && message.type === 'GPT_HELP_RESPONSE') {
      console.log('[Popup] Processing GPT response:', message);
      // Parse the GPT response and show it in the popup
      showHelperBox({
        topic: message.topic,
        explanation: message.gptText,
        quiz: null // We'll add quiz parsing later
      });
    }
  });
});

// Add showHelperBox to display GPT output in the popup
function showHelperBox(responseObj) {
  // Remove any previous output
  let old = document.getElementById('yt-assistant-output');
  if (old) old.remove();

  // Create container
  const container = document.createElement('div');
  container.id = 'yt-assistant-output';
  container.style.marginTop = '18px';
  container.style.background = '#f7f7fa';
  container.style.borderRadius = '10px';
  container.style.padding = '14px 16px 14px 16px';
  container.style.boxShadow = '0 2px 8px rgba(0,0,0,0.04)';
  container.style.fontSize = '15px';
  container.style.lineHeight = '1.6';

  // Topic
  const topic = document.createElement('div');
  topic.innerHTML = `<b>🔹 Topic:</b> <span style="color:#2563eb">${responseObj.topic}</span>`;
  topic.style.marginBottom = '10px';
  container.appendChild(topic);

  // Explanation
  const explanation = document.createElement('div');
  explanation.innerHTML = `<b>💡 Explanation:</b><br><span>${responseObj.explanation}</span>`;
  explanation.style.marginBottom = '12px';
  container.appendChild(explanation);

  // Quiz
  if (responseObj.quiz) {
    const quiz = document.createElement('div');
    quiz.innerHTML = `<b>❓ Quiz:</b><br><span>${responseObj.quiz.question}</span>`;
    quiz.style.marginBottom = '8px';
    container.appendChild(quiz);
    // Choices
    const ul = document.createElement('ul');
    ul.style.listStyle = 'none';
    ul.style.padding = '0';
    responseObj.quiz.choices.forEach(choice => {
      const li = document.createElement('li');
      li.style.margin = '4px 0';
      li.innerHTML = `<span style="background:#e0e7ff;padding:4px 10px;border-radius:6px;">${choice}</span>`;
      ul.appendChild(li);
    });
    container.appendChild(ul);
  }

  // Insert after the welcome/status div
  const statusDiv = document.getElementById('status');
  if (statusDiv && statusDiv.parentNode) {
    statusDiv.parentNode.insertBefore(container, statusDiv.nextSibling);
  } else {
    document.body.appendChild(container);
  }
}
