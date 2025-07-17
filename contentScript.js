// YouTube Learning Assistant: Passive Behavior Tracker + Assistant Popup
// Tracks pause, seek, replay, and watch time per transcript topic
// Shows popup only when user clicks 'Start Assistant' from extension popup
// Manifest V3 compatible

(function() {
  // --- CONFIG ---
  const WATCH_INTERVAL = 1.0; // seconds, how often to sample watch time
  const BOX_ID = "yt-helper-box";

  // --- STATE ---
  let lastTime = 0;
  let lastTopic = null;
  let lastPaused = true;
  let watchTimer = null;
  let transcriptData = [];
  let watchEvents = [];
  let topicReplayCounts = {};
  let timeWatchedByTopic = {};
  let currentVideoUrl = null; // Track current video URL

  // --- UTILS ---
  function log(...args) {
    console.log('[YT-Tracker]', ...args);
  }

  // Find the closest transcript entry at or before the given time
  function getTopicAtTime(time) {
    if (!transcriptData.length) {
      console.log('[YT-Tracker] No transcript data available for time:', time);
      return null;
    }
    let matched = null;
    for (let i = transcriptData.length - 1; i >= 0; i--) {
      if (transcriptData[i].time <= time) {
        matched = transcriptData[i];
        break;
      }
    }
    // If paused after the last transcript, show the last segment
    if (!matched && transcriptData.length) {
      matched = transcriptData[transcriptData.length - 1];
    }
    if (matched) {
      console.log('[YT-Tracker] Found topic at time', time, ':', matched.text.substring(0, 50) + '...');
    } else {
      console.log('[YT-Tracker] No topic found at time:', time);
    }
    return matched ? matched.text : null;
  }

  function getSentenceAtTime(time) {
    if (!transcriptData.length) return null;
    // Find the closest segment at or before the given time
    let idx = transcriptData.findIndex(seg => seg.time > time);
    if (idx === -1) idx = transcriptData.length;
    let start = idx - 1;
    // Go backwards to the start of the sentence
    while (start > 0 && !/[.!?]/.test(transcriptData[start - 1].text.trim().slice(-1))) {
      start--;
    }
    // Go forwards to the end of the sentence
    let end = idx - 1;
    while (end + 1 < transcriptData.length && !/[.!?]/.test(transcriptData[end].text.trim().slice(-1))) {
      end++;
    }
    // Join the text
    return transcriptData.slice(start, end + 1).map(seg => seg.text).join(' ');
  }

  function getSnippetAtTime(time, windowSize = 15) {
    if (!transcriptData.length) {
      console.log('[YT-Tracker] No transcript data available for snippet at time:', time);
      return null;
    }
    
    // Handle edge case: time is 0 or very early
    if (time <= 0) {
      // Use the first few segments
      const earlySnippet = transcriptData.slice(0, Math.min(windowSize, transcriptData.length))
        .map(seg => seg.text).join(' ');
      console.log('[YT-Tracker] Generated early snippet at time', time, ':', earlySnippet.substring(0, 100) + '...');
      return earlySnippet;
    }
    
    let idx = transcriptData.findIndex(seg => seg.time > time);
    if (idx === -1) {
      // Time is after all transcript segments, use the last few
      const endSnippet = transcriptData.slice(-Math.min(windowSize, transcriptData.length))
        .map(seg => seg.text).join(' ');
      console.log('[YT-Tracker] Generated end snippet at time', time, ':', endSnippet.substring(0, 100) + '...');
      return endSnippet;
    }
    
    let start = Math.max(0, idx - Math.floor(windowSize / 2));
    let end = Math.min(transcriptData.length, start + windowSize);
    const snippet = transcriptData.slice(start, end).map(seg => seg.text).join(' ');
    console.log('[YT-Tracker] Generated snippet at time', time, ':', snippet.substring(0, 100) + '...');
    return snippet;
  }

  // Save all tracking data to chrome.storage.local
  function saveTrackingData() {
    chrome.storage.local.set({
      watchEvents,
      topicReplayCounts,
      timeWatchedByTopic
    });
  }

  // --- EVENT HANDLERS ---

  // Handle pause event
  function handlePause(video) {
    console.log('[YT-Tracker] handlePause called');
    const currentTime = video.currentTime;
    const topic = getSnippetAtTime(currentTime, 20); // 20-word window
    console.log('[YT-Tracker] Paused at:', currentTime, 'Topic:', topic);
    
    // Show paused time and topic
    const infoString = topic
      ? `${currentTime.toFixed(1)}s\n🧠 Topic: ${topic}`
      : `${currentTime.toFixed(1)}s\n🧠 Topic: (No transcript found)`;
    console.log('[YT-Tracker] Calling showHelperBox with:', infoString);
    showHelperBox(infoString);
    
    // Only generate GPT help if we have a valid topic
    if (topic && topic.trim().length > 0) {
      const gptPrompt = `\nYou are a helpful YouTube learning assistant.\n\n1. Summarize the topic at this paused moment in ONE concise sentence.\n2. Give a simple explanation in 5 bullet points.\n3. Create a quiz question with 3 multiple-choice answers (A, B, C), and indicate the correct answer.\n\nTopic: \"${topic}\"\n`;
      generateGPTHelp(gptPrompt, topic);
      console.log('[YT-Tracker] Built GPT prompt for topic:', topic);
      console.log(gptPrompt);
      
      // Track replay
      topicReplayCounts[topic] = (topicReplayCounts[topic] || 0) + 1;
    } else {
      console.log('[YT-Tracker] No valid topic found, skipping GPT request');
    }
    
    saveTrackingData();
  }

  // Handle seek event
  function handleSeek(video, from, to) {
    watchEvents.push({ type: 'seek', from, to });
    log('Seek event:', { from, to });
    saveTrackingData();
  }

  // Watch time accumulation
  function startWatchTimer(video) {
    if (watchTimer) clearInterval(watchTimer);
    watchTimer = setInterval(() => {
      if (video.paused || video.ended) return;
      const currentTime = video.currentTime;
      const topic = getTopicAtTime(currentTime);
      if (topic) {
        timeWatchedByTopic[topic] = (timeWatchedByTopic[topic] || 0) + WATCH_INTERVAL;
      }
      lastTime = currentTime;
      lastTopic = topic;
      saveTrackingData();
    }, WATCH_INTERVAL * 1000);
  }

  function stopWatchTimer() {
    if (watchTimer) clearInterval(watchTimer);
    watchTimer = null;
  }

  // --- MAIN LOGIC ---
  function attachVideoListeners(video) {
    if (video._ytTrackerAttached) return;
    video._ytTrackerAttached = true;
    log('Attaching listeners to video');
    lastTime = video.currentTime;
    lastPaused = video.paused;
    lastTopic = getTopicAtTime(lastTime);

    // Pause event
    video.addEventListener('pause', () => {
      handlePause(video);
      lastPaused = true;
      stopWatchTimer();
    });
    // Play event
    video.addEventListener('play', () => {
      lastPaused = false;
      startWatchTimer(video);
    });
    // Seek event
    video.addEventListener('seeked', () => {
      const newTime = video.currentTime;
      if (Math.abs(newTime - lastTime) > 1.0) { // Ignore tiny jumps
        handleSeek(video, lastTime, newTime);
      }
      lastTime = newTime;
      lastTopic = getTopicAtTime(newTime);
    });
    // Start timer if already playing
    if (!video.paused && !video.ended) {
      startWatchTimer(video);
    }
  }

  // --- TRANSCRIPT EXTRACTION ---
  function openTranscriptPanel() {
    console.log('[YT-Tracker] Attempting to open transcript panel');
    
    // Method 1: Try clicking the transcript button
    const transcriptButton = document.querySelector('button[aria-label*="transcript"], button[aria-label*="Transcript"], ytd-button-renderer[aria-label*="transcript"], ytd-button-renderer[aria-label*="Transcript"]');
    if (transcriptButton) {
      console.log('[YT-Tracker] Found transcript button, clicking it');
      transcriptButton.click();
      return true;
    }
    
    // Method 2: Try finding the more actions button and then transcript
    const moreActionsButton = document.querySelector('button[aria-label*="More actions"], ytd-button-renderer[aria-label*="More actions"]');
    if (moreActionsButton) {
      console.log('[YT-Tracker] Found more actions button, clicking it');
      moreActionsButton.click();
      
      // Wait for menu to appear and click transcript
      setTimeout(() => {
        const transcriptMenuItem = document.querySelector('tp-yt-paper-item[aria-label*="transcript"], tp-yt-paper-item[aria-label*="Transcript"], ytd-menu-service-item-renderer[aria-label*="transcript"], ytd-menu-service-item-renderer[aria-label*="Transcript"]');
        if (transcriptMenuItem) {
          console.log('[YT-Tracker] Found transcript menu item, clicking it');
          transcriptMenuItem.click();
        }
      }, 500);
      return true;
    }
    
    // Method 3: Try keyboard shortcut (Ctrl+Shift+Y or Cmd+Shift+Y)
    console.log('[YT-Tracker] Trying keyboard shortcut for transcript');
    const event = new KeyboardEvent('keydown', {
      key: 'y',
      code: 'KeyY',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true
    });
    document.dispatchEvent(event);
    
    console.log('[YT-Tracker] No transcript button found');
    return false;
  }

  function extractTranscriptFromDOM() {
    // Try to find transcript lines in the YouTube transcript panel
    // (User must have opened the transcript panel for this to work)
    const transcriptLines = document.querySelectorAll('ytd-transcript-segment-renderer');
    if (!transcriptLines.length) {
      console.warn('[YT-Tracker] No transcript lines found in DOM. Attempting to open transcript panel...');
      // Try to automatically open the transcript panel
      const opened = openTranscriptPanel();
      if (opened) {
        // Wait a bit for the panel to load, then try extraction again
        setTimeout(() => {
          extractTranscriptFromDOM();
        }, 1500);
      } else {
        chrome.storage.local.set({ transcriptData: [] });
        // Update global variable
        transcriptData = [];
      }
      return;
    }
    const newTranscriptData = Array.from(transcriptLines).map(line => {
      const timeStr = line.querySelector('.segment-timestamp')?.textContent.trim();
      const text = line.querySelector('.segment-text')?.textContent.trim();
      // Convert timeStr (e.g., "1:23" or "0:01:23") to seconds
      let time = 0;
      if (timeStr) {
        const parts = timeStr.split(':').map(Number);
        if (parts.length === 2) {
          time = parts[0] * 60 + parts[1];
        } else if (parts.length === 3) {
          time = parts[0] * 3600 + parts[1] * 60 + parts[2];
        }
      }
      return { time, text };
    });
    // Update both storage and global variable
    chrome.storage.local.set({ transcriptData: newTranscriptData });
    transcriptData = newTranscriptData; // Update global variable
    console.log('[YT-Tracker] Extracted transcriptData:', transcriptData);
  }

  // Find the closest transcript entry at or before the given time
  function getTopicAtTime(time) {
    if (!transcriptData.length) return null;
    let matched = null;
    for (let i = transcriptData.length - 1; i >= 0; i--) {
      if (transcriptData[i].time <= time) {
        matched = transcriptData[i];
        break;
      }
    }
    // If paused after the last transcript, show the last segment
    if (!matched && transcriptData.length) {
      matched = transcriptData[transcriptData.length - 1];
    }
    return matched ? matched.text : null;
  }

  // --- TRANSCRIPT LOADING ---
  function loadTranscriptAndInit() {
    chrome.storage.local.get(['transcriptData', 'watchEvents', 'topicReplayCounts', 'timeWatchedByTopic'], (res) => {
      transcriptData = Array.isArray(res.transcriptData) ? res.transcriptData : [];
      watchEvents = Array.isArray(res.watchEvents) ? res.watchEvents : [];
      topicReplayCounts = res.topicReplayCounts || {};
      timeWatchedByTopic = res.timeWatchedByTopic || {};
      // observeForVideo(); // This is now handled by robustVideoAndAssistantObserver
      // Try to extract transcript on load
      // setTimeout(extractTranscriptFromDOM, 2000); // Wait for transcript panel to load if open
    });
  }

  // Function to reload transcript data from storage
  function reloadTranscriptData() {
    chrome.storage.local.get(['transcriptData'], (res) => {
      transcriptData = Array.isArray(res.transcriptData) ? res.transcriptData : [];
      console.log('[YT-Tracker] Reloaded transcript data:', transcriptData.length, 'segments');
    });
  }

  // Function to check if video URL has changed
  function checkVideoUrlChange() {
    const videoUrl = window.location.href;
    if (currentVideoUrl && currentVideoUrl !== videoUrl) {
      console.log('[YT-Tracker] Video URL changed from', currentVideoUrl, 'to', videoUrl);
      // Clear transcript data for new video
      transcriptData = [];
      chrome.storage.local.set({ transcriptData: [] });
    }
    currentVideoUrl = videoUrl;
  }

  // --- VIDEO DETECTION ---
  // This function is now handled by robustVideoAndAssistantObserver

  // --- Reset assistantStarted on navigation or reload ---
  function resetAssistantStateOnNavigation() {
    // Reset the assistantStarted flag
    chrome.storage.local.set({ assistantStarted: false });
    // Clear transcriptData
    chrome.storage.local.set({ transcriptData: [] });
    // Close the assistant window if open
    const box = document.getElementById('yt-helper-box');
    if (box) box.remove();
    // Try to extract transcript again (in case of new video)
    setTimeout(extractTranscriptFromDOM, 2000);
  }

  // --- VIDEO + ASSISTANT STATE OBSERVER ---
  function robustVideoAndAssistantObserver() {
    let lastVideo = null;
    let observer = null;

    function attachIfNeeded() {
      chrome.storage.local.get(['assistantStarted'], (res) => {
        if (!res.assistantStarted) return;
        const video = document.querySelector('video');
        if (video && !video._ytTrackerAttached) {
          attachVideoListeners(video);
          lastVideo = video;
        }
      });
    }

    // Observe for video elements and assistant state
    if (observer) observer.disconnect();
    observer = new MutationObserver(attachIfNeeded);
    observer.observe(document.body, { childList: true, subtree: true });
    // Try immediately
    attachIfNeeded();

    // Listen for assistantStarted changes
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.assistantStarted) {
        if (changes.assistantStarted.newValue) {
          // Assistant started: attach listeners and extract transcript
          attachIfNeeded();
          setTimeout(extractTranscriptFromDOM, 1000);
          showHelperBox('');
        } else {
          // Assistant stopped: remove box
          hideHelperBox();
        }
      }
    });
  }

  // --- AUTOSTART ---
  loadTranscriptAndInit();
  robustVideoAndAssistantObserver();

  // Listen for transcript data changes in storage
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.transcriptData) {
      console.log('[YT-Tracker] Transcript data changed in storage, reloading...');
      reloadTranscriptData();
    }
  });

  // --- ASSISTANT POPUP LOGIC ---
  // Listen for messages from the popup (e.g., to show the assistant window immediately)
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === 'SHOW_ASSISTANT_WINDOW') {
      chrome.storage.local.get(['assistantStarted'], (res) => {
        if (res.assistantStarted) {
          showHelperBox(''); // Show empty or default content; will update as needed
        }
      });
    }
    if (message && message.type === 'SHOW_ASSISTANT_WINDOW_WITH_CONTENT') {
      chrome.storage.local.get(['assistantStarted'], (res) => {
        if (res.assistantStarted) {
          showHelperBox(message.content);
        }
      });
    }
  });

  function showHelperBox(info) {
    chrome.storage.local.get(['assistantStarted'], (res) => {
      console.log('[YT-Tracker] assistantStarted is', res.assistantStarted);
      if (!res.assistantStarted) return;
      let box = document.getElementById(BOX_ID);
      let header, body;
      if (!box) {
        box = document.createElement("div");
        box.id = BOX_ID;
        box.innerHTML = `
          <div id="yt-helper-header" class="yt-helper-header" style="display:flex;align-items:center;">
            <span style="font-size:18px;vertical-align:middle;">🧠</span>
            <span style="margin-left:8px; font-weight:600;">YouTube Learning Assistant</span>
            <span id="yt-helper-minimize" style="cursor: pointer; margin-left:auto; font-size:18px;">−</span>
            <span id="yt-helper-close" style="cursor: pointer; margin-left:8px; font-size:18px;">✖️</span>
          </div>
          <div id="yt-helper-body" class="yt-helper-body">
            <div id="yt-paused-info"></div>
            <div style="margin:10px 0 8px 0; border-bottom:1px solid #ececec;"></div>
            <div id="yt-chat-area"></div>
            <!-- <div id="yt-gpt-response"></div> -->
            <form id="yt-chat-form" style="display:flex;gap:8px;margin-top:12px;">
              <input id="yt-chat-input" type="text" placeholder="Ask about this video..." style="flex:1;padding:8px 12px;border-radius:8px;border:1px solid #ccc;font-size:15px;" autocomplete="off" />
              <button type="submit" style="padding:8px 16px;border-radius:8px;background:#2563eb;color:#fff;border:none;font-weight:600;cursor:pointer;">Send</button>
            </form>
          </div>
        `;
        // STYLE the outer box
        Object.assign(box.style, {
          position: "fixed",
          top: "32px",
          right: "32px",
          width: "340px",
          backgroundColor: "#fff",
          color: "#222",
          padding: "0",
          borderRadius: "16px",
          boxShadow: "0 4px 24px rgba(0,0,0,0.13)",
          zIndex: "999999",
          fontFamily: "'Segoe UI', 'Roboto', 'Arial', sans-serif",
          overflow: "hidden",
          border: "1px solid #e5e7eb",
          display: "flex",
          flexDirection: "column",
          height: "100%",
          maxHeight: "90vh",
          minHeight: "220px",
          maxWidth: "90vw",
          minWidth: "320px"
        });
        // HEADER styles
        header = box.querySelector("#yt-helper-header");
        Object.assign(header.style, {
          background: "#f7f7fa",
          color: "#222",
          padding: "12px 18px",
          fontWeight: "bold",
          fontSize: "15px",
          display: "flex",
          alignItems: "center",
          borderBottom: "1px solid #ececec"
        });
        // BODY styles
        body = box.querySelector("#yt-helper-body");
        Object.assign(body.style, {
          padding: "18px 18px 16px 18px",
          flex: "1 1 auto",
          minHeight: "0",
          overflowY: "auto",
          fontSize: "15px",
          lineHeight: "1.6"
        });
        // Close Button
        const closeBtn = box.querySelector("#yt-helper-close");
        closeBtn.addEventListener("click", () => {
          box.remove();
        });
        document.body.appendChild(box);
        // Attach floating box manager
        setTimeout(() => {
          new FloatingBoxManager(box, header, body);
          // Add chat input handler
          const chatForm = box.querySelector('#yt-chat-form');
          const chatInput = box.querySelector('#yt-chat-input');
          const chatArea = box.querySelector('#yt-chat-area');
          if (chatForm && chatInput && chatArea) {
            chatForm.onsubmit = (e) => {
              e.preventDefault();
              const msg = chatInput.value.trim();
              if (!msg) return;
              // Display user message in chat area
              const msgDiv = document.createElement('div');
              msgDiv.style.margin = '8px 0';
              msgDiv.innerHTML = `<b>You:</b> ${msg}`;
              chatArea.appendChild(msgDiv);
              chatInput.value = '';
              chatArea.scrollTop = chatArea.scrollHeight;
              // Send to background for AI answer
              chrome.storage.local.get(['transcriptData'], (res) => {
                const transcriptData = Array.isArray(res.transcriptData) ? res.transcriptData : [];
                const video = document.querySelector('video');
                const currentTime = video ? video.currentTime : null;
                chrome.runtime.sendMessage({
                  type: 'CHAT_QUESTION',
                  question: msg,
                  transcriptData,
                  currentTime
                });
              });
            };
          }
        }, 0);
      } else {
        header = box.querySelector("#yt-helper-header");
        body = box.querySelector("#yt-helper-body");
      }
      // Only show paused time, not topic
      const pausedInfoDiv = box.querySelector('#yt-paused-info');
      if (typeof info === "number") {
        pausedInfoDiv.innerHTML = `<div style="font-weight:600;font-size:16px;">⏸️ Paused at <span style='color:#2563eb'>${info.toFixed(2)}s</span></div>`;
      } else if (typeof info === "string" && info.trim() !== "") {
        // Only show paused time, not topic
        let [timestamp] = info.split('\n');
        pausedInfoDiv.innerHTML = `<div style="font-weight:600;font-size:16px;">⏸️ Paused at <span style='color:#2563eb'>${timestamp.replace('s','')}s</span></div>`;
      } else {
        pausedInfoDiv.innerHTML = `<p>Welcome! The assistant is now active.</p>`;
      }
      // Do not overwrite the GPT response section here
    });
  }

  // Comment out updateGptResponseBox and related message handling
  // function updateGptResponseBox(html) {
  //   const box = document.getElementById(BOX_ID);
  //   if (!box) return;
  //   const gptDiv = box.querySelector('#yt-gpt-response');
  //   if (gptDiv) {
  //     gptDiv.innerHTML = html;
  //     const body = box.querySelector('#yt-helper-body');
  //     if (body) body.scrollTop = body.scrollHeight;
  //   }
  // }

  // Listen for GPT response and update only the GPT response section
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[YT-Tracker] Received message in contentScript:', message);
    if (message && message.type === 'GPT_HELP_RESPONSE') {
      console.log('[YT-Tracker] Processing GPT response:', message);
      
      if (message.error) {
        console.log('[YT-Tracker] GPT response error:', message.gptText);
        // Show error in the assistant box
        const box = document.getElementById('yt-helper-box');
        if (box) {
          const body = box.querySelector('#yt-helper-body');
          if (body) {
            body.innerHTML = `<div style="color:#c00;font-size:15px;line-height:1.6;">
              <b>❌ Error:</b> ${message.gptText || 'AI output unavailable.'}
            </div>`;
          }
        }
        return;
      }
      
      // Use the response text directly since we're using the simple GPT request
      const gptText = message.gptText || '';
      console.log('[YT-Tracker] GPT response text:', gptText);
      
      // Show the response in the assistant box
      const box = document.getElementById('yt-helper-box');
      if (box) {
        const body = box.querySelector('#yt-helper-body');
        if (body) {
          body.innerHTML = `<div style="font-size:15px;line-height:1.6;">
            <b>💡 AI Explanation</b>
            <pre style="background:#f7f7fa;padding:10px 12px;border-radius:8px;margin-top:8px;white-space:pre-wrap;font-size:14px;">${gptText}</pre>
          </div>`;
        }
      }
    } else if (message && message.type === 'CHAT_ANSWER') {
      const box = document.getElementById('yt-helper-box');
      if (!box) return;
      const chatArea = box.querySelector('#yt-chat-area');
      if (chatArea) {
        const aiDiv = document.createElement('div');
        aiDiv.style.margin = '8px 0';
        aiDiv.innerHTML = `<b>Assistant:</b> ${message.answer}`;
        chatArea.appendChild(aiDiv);
        chatArea.scrollTop = chatArea.scrollHeight;
      }
    } else {
      // Log all other messages for debugging
      console.log('[YT-Tracker] Unhandled message type:', message.type);
    }
  });



  // --- Hide helper box in fullscreen mode ---
  function hideHelperBox() {
    const box = document.getElementById(BOX_ID);
    if (box) box.remove();
  }

  // --- Reset assistantStarted on navigation or reload ---
  function resetAssistantOnNav() {
    let lastUrl = location.href;
    new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        console.log('[YT-Tracker] Navigation detected, clearing transcript data and re-extracting');
        // Clear old transcript data from storage
        chrome.storage.local.set({ transcriptData: [] });
        // Clear global transcriptData variable
        transcriptData = [];
        // Reset video URL tracking
        currentVideoUrl = null;
        // Reset assistant state
        chrome.storage.local.set({ assistantStarted: false });
        // Try to extract transcript for new video after a delay, and auto-open transcript panel
        setTimeout(() => {
          extractTranscriptFromDOM();
          // Also try to open transcript panel automatically
          setTimeout(openTranscriptPanel, 1000);
        }, 2000);
      }
    }).observe(document.body, { childList: true, subtree: true });
  }
  resetAssistantOnNav();

  // Only start tracking after assistantStarted is true
  // This logic is now handled by robustVideoAndAssistantObserver

  // Wait for video element, then attach listeners if assistantStarted
  // This function is now handled by robustVideoAndAssistantObserver

  // --- End Passive Behavior Tracker ---

})();

// --- FloatingBoxManager: Handles drag, resize (all directions), minimize, persist ---
class FloatingBoxManager {
  constructor(box, header, body) {
    this.box = box;
    this.header = header;
    this.body = body;
    this.isDragging = false;
    this.isResizing = false;
    this.resizeDir = null;
    this.offset = { x: 0, y: 0 };
    this.start = { x: 0, y: 0 };
    this.minimized = false;
    this.size = { width: 340, height: null };
    this.position = { top: 32, left: null, right: 32 };
    this.preMinimize = null; // Store size/position before minimize
    this.init();
  }
  async init() {
    const state = await this.getState();
    if (state) {
      this.applyState(state);
    }
    this.makeDraggable();
    this.makeResizable();
    this.makeMinimizable();
    this.observeFullscreen();
  }
  getState() {
    return new Promise(resolve => {
      chrome.storage.local.get(["ytHelperBoxState"], res => {
        resolve(res.ytHelperBoxState || null);
      });
    });
  }
  saveState() {
    const state = {
      position: this.position,
      size: this.size,
      minimized: this.minimized
    };
    chrome.storage.local.set({ ytHelperBoxState: state });
  }
  applyState(state) {
    if (state.position) {
      Object.assign(this.position, state.position);
      this.box.style.top = this.position.top !== null ? this.position.top + "px" : "";
      this.box.style.left = this.position.left !== null ? this.position.left + "px" : "";
      this.box.style.right = this.position.right !== null ? this.position.right + "px" : "";
    }
    if (state.size) {
      Object.assign(this.size, state.size);
      this.box.style.width = this.size.width + "px";
      if (this.size.height) this.box.style.height = this.size.height + "px";
    }
    if (state.minimized) {
      this.setMinimized(true);
    }
  }
  makeDraggable() {
    this.header.style.cursor = "move";
    this.header.addEventListener("mousedown", e => {
      if (e.target.closest("#yt-helper-minimize") || e.target.closest("#yt-helper-close")) return;
      this.isDragging = true;
      this.start.x = e.clientX;
      this.start.y = e.clientY;
      const rect = this.box.getBoundingClientRect();
      this.offset.x = this.start.x - rect.left;
      this.offset.y = this.start.y - rect.top;
      document.body.style.userSelect = "none";
    });
    document.addEventListener("mousemove", e => {
      if (!this.isDragging) return;
      let x = e.clientX - this.offset.x;
      let y = e.clientY - this.offset.y;
      x = Math.max(0, Math.min(window.innerWidth - this.box.offsetWidth, x));
      y = Math.max(0, Math.min(window.innerHeight - 40, y));
      this.box.style.left = x + "px";
      this.box.style.top = y + "px";
      this.box.style.right = "auto";
      this.position = { top: y, left: x, right: null };
      this.saveState();
    });
    document.addEventListener("mouseup", () => {
      this.isDragging = false;
      document.body.style.userSelect = "";
    });
  }
  makeResizable() {
    // Add resize handles for all edges/corners
    const directions = [
      { dir: 'top', style: { top: '-3px', left: '0', width: '100%', height: '6px', cursor: 'ns-resize' } },
      { dir: 'bottom', style: { bottom: '-3px', left: '0', width: '100%', height: '6px', cursor: 'ns-resize' } },
      { dir: 'left', style: { left: '-3px', top: '0', width: '6px', height: '100%', cursor: 'ew-resize' } },
      { dir: 'right', style: { right: '-3px', top: '0', width: '6px', height: '100%', cursor: 'ew-resize' } },
      { dir: 'top-left', style: { top: '-3px', left: '-3px', width: '12px', height: '12px', cursor: 'nwse-resize' } },
      { dir: 'top-right', style: { top: '-3px', right: '-3px', width: '12px', height: '12px', cursor: 'nesw-resize' } },
      { dir: 'bottom-left', style: { bottom: '-3px', left: '-3px', width: '12px', height: '12px', cursor: 'nesw-resize' } },
      { dir: 'bottom-right', style: { bottom: '-3px', right: '-3px', width: '16px', height: '16px', cursor: 'nwse-resize' } }
    ];
    directions.forEach(({ dir, style }) => {
      const handle = document.createElement('div');
      handle.className = `yt-helper-resize-handle yt-helper-resize-${dir}`;
      Object.assign(handle.style, {
        position: 'absolute',
        zIndex: 2,
        ...style,
        background: 'transparent',
        borderRadius: dir.includes('corner') ? '4px' : '0',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'flex-end',
      });
      if (dir === 'bottom-right') {
        handle.innerHTML = `<svg width="16" height="16"><polyline points="4,16 16,16 16,4" style="fill:none;stroke:#bbb;stroke-width:2"/></svg>`;
      }
      this.box.appendChild(handle);
      handle.addEventListener('mousedown', e => {
        if (this.minimized) return;
        e.stopPropagation();
        this.isResizing = true;
        this.resizeDir = dir;
        this.start.x = e.clientX;
        this.start.y = e.clientY;
        this.start.width = this.box.offsetWidth;
        this.start.height = this.box.offsetHeight;
        this.start.top = this.box.offsetTop;
        this.start.left = this.box.offsetLeft;
        document.body.style.userSelect = 'none';
      });
    });
    document.addEventListener('mousemove', e => {
      if (!this.isResizing || this.minimized) return;
      let newWidth = this.start.width;
      let newHeight = this.start.height;
      let newTop = this.start.top;
      let newLeft = this.start.left;
      if (this.resizeDir.includes('right')) {
        newWidth = Math.max(240, this.start.width + (e.clientX - this.start.x));
      }
      if (this.resizeDir.includes('left')) {
        newWidth = Math.max(240, this.start.width - (e.clientX - this.start.x));
        newLeft = this.start.left + (e.clientX - this.start.x);
      }
      if (this.resizeDir.includes('bottom')) {
        newHeight = Math.max(80, this.start.height + (e.clientY - this.start.y));
      }
      if (this.resizeDir.includes('top')) {
        newHeight = Math.max(80, this.start.height - (e.clientY - this.start.y));
        newTop = this.start.top + (e.clientY - this.start.y);
      }
      // Clamp to viewport
      newWidth = Math.min(newWidth, window.innerWidth - newLeft - 10);
      newHeight = Math.min(newHeight, window.innerHeight - newTop - 10);
      newLeft = Math.max(0, Math.min(window.innerWidth - newWidth, newLeft));
      newTop = Math.max(0, Math.min(window.innerHeight - newHeight, newTop));
      this.box.style.width = newWidth + 'px';
      this.box.style.height = newHeight + 'px';
      this.box.style.left = newLeft + 'px';
      this.box.style.top = newTop + 'px';
      this.box.style.right = 'auto';
      this.size = { width: newWidth, height: newHeight };
      this.position = { top: newTop, left: newLeft, right: null };
      this.saveState();
    });
    document.addEventListener('mouseup', () => {
      this.isResizing = false;
      this.resizeDir = null;
      document.body.style.userSelect = '';
    });
  }
  makeMinimizable() {
    // Move minimize button to the left of close button in header
    let minBtn = this.header.querySelector("#yt-helper-minimize");
    let closeBtn = this.header.querySelector("#yt-helper-close");
    if (closeBtn && minBtn && minBtn.nextSibling !== closeBtn) {
      this.header.insertBefore(minBtn, closeBtn);
    }
    minBtn.onclick = () => {
      this.setMinimized(!this.minimized);
      this.saveState();
    };
  }
  setMinimized(min) {
    this.minimized = min;
    if (min) {
      // Save current size/position before minimizing
      this.preMinimize = {
        width: this.box.offsetWidth,
        height: this.box.offsetHeight,
        top: this.box.offsetTop,
        left: this.box.offsetLeft
      };
      this.body.style.display = "none";
      this.box.style.height = "auto";
      this.box.style.minHeight = "0";
      this.box.style.flex = "0 0 auto";
      this.header.querySelector("#yt-helper-minimize").textContent = "+";
      this.header.querySelector("#yt-helper-minimize").title = "Maximize";
      this.header.querySelector("span").textContent = "📘";
      this.header.querySelector("span+span").textContent = "YouTube Learning Assistant";
      // Hide resize handles
      this.box.querySelectorAll('.yt-helper-resize-handle').forEach(h => h.style.display = 'none');
    } else {
      this.body.style.display = "";
      this.box.style.height = this.preMinimize ? this.preMinimize.height + "px" : "";
      this.box.style.minHeight = "";
      this.box.style.flex = "";
      this.header.querySelector("#yt-helper-minimize").textContent = "−";
      this.header.querySelector("#yt-helper-minimize").title = "Minimize";
      this.header.querySelector("span").textContent = "🧠";
      this.header.querySelector("span+span").textContent = "YouTube Learning Assistant";
      // Restore previous size/position if available
      if (this.preMinimize) {
        this.box.style.width = this.preMinimize.width + "px";
        this.box.style.top = this.preMinimize.top + "px";
        this.box.style.left = this.preMinimize.left + "px";
        this.box.style.right = "auto";
        this.size = { width: this.preMinimize.width, height: this.preMinimize.height };
        this.position = { top: this.preMinimize.top, left: this.preMinimize.left, right: null };
      }
      // Show resize handles
      this.box.querySelectorAll('.yt-helper-resize-handle').forEach(h => h.style.display = '');
    }
  }
  observeFullscreen() {
    document.addEventListener('fullscreenchange', () => {
      if (document.fullscreenElement) {
        hideHelperBox();
      }
    });
  }
}

// --- End FloatingBoxManager ---

// In showHelperBox, after creating the popup, always call new FloatingBoxManager(box, header, body);
// (Do not touch the passive behavior tracker logic below.)

function generateGPTHelp(prompt, topic) {
  console.log('[YT-Tracker] generateGPTHelp called for topic:', topic);
  console.log('[YT-Tracker] Prompt:', prompt);
  
  // Show loading message in the assistant box
  const box = document.getElementById('yt-helper-box');
  if (box) {
    const body = box.querySelector('#yt-helper-body');
    if (body) {
      body.innerHTML = `<div style="font-size:15px;line-height:1.6;">
        <b>💬 Thinking…</b>
        <div style="margin-top:8px;color:#888;">Generating explanation and quiz for: <b>${topic}</b></div>
      </div>`;
    }
  }
  
  // Function to handle GPT response
  function handleGPTResponse(response) {
    console.log('[YT-Tracker] Processing GPT response:', response);
    
    if (response.error) {
      console.log('[YT-Tracker] GPT response error:', response.gptText);
      // Show error in the assistant box
      if (box) {
        const body = box.querySelector('#yt-helper-body');
        if (body) {
          body.innerHTML = `<div style="color:#c00;font-size:15px;line-height:1.6;">
            <b>❌ Error:</b> ${response.gptText || 'AI output unavailable.'}
          </div>`;
        }
      }
      return;
    }
    
    // Use the response text directly
    const gptText = response.gptText || '';
    console.log('[YT-Tracker] GPT response text:', gptText);
    
    // Show the response in the assistant box
    if (box) {
      const body = box.querySelector('#yt-helper-body');
      if (body) {
        body.innerHTML = `<div style="font-size:15px;line-height:1.6;">
          <b>💡 AI Explanation</b>
          <pre style="background:#f7f7fa;padding:10px 12px;border-radius:8px;margin-top:8px;white-space:pre-wrap;font-size:14px;">${gptText}</pre>
        </div>`;
      }
    }
  }
  
  // Try regular message passing first
  console.log('[YT-Tracker] Sending GPT_HELP_REQUEST to background script');
  chrome.runtime.sendMessage({
    type: 'GPT_HELP_REQUEST',
    prompt,
    topic
  }, (response) => {
    console.log('[YT-Tracker] Background script response:', response);
    
    if (chrome.runtime.lastError) {
      console.log('[YT-Tracker] Message passing failed, trying port connection:', chrome.runtime.lastError);
      
      // Fallback to port connection
      const port = chrome.runtime.connect({ name: 'gpt-request' });
      
      port.onMessage.addListener((portResponse) => {
        console.log('[YT-Tracker] Port response:', portResponse);
        if (portResponse.type === 'GPT_HELP_RESPONSE') {
          handleGPTResponse(portResponse);
          port.disconnect();
        }
      });
      
      port.postMessage({
        type: 'GPT_HELP_REQUEST',
        prompt,
        topic
      });
      
      // Set a timeout for port connection
      setTimeout(() => {
        console.log('[YT-Tracker] Port connection timeout');
        port.disconnect();
        if (box) {
          const body = box.querySelector('#yt-helper-body');
          if (body) {
            body.innerHTML = `<div style="color:#c00;font-size:15px;line-height:1.6;">
              <b>❌ Error:</b> Request timeout - please try again
            </div>`;
          }
        }
      }, 30000);
      
    } else if (response && response.type === 'GPT_HELP_RESPONSE') {
      handleGPTResponse(response);
    }
  });
}
