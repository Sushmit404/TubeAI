//Extracts the transcript and video state 
//Runs inside the YouTube page
//Can modify the DOM, insert buttons, display learning tools
//The script injects the UI— topic breakdown, quiz buttons, etc.
//Uses chrome.runtime.sendMessage() to communicate with background.js
//chrome.runtime.onMessage.addListener() to listen for messages from background.js

//chrome.runtime.sendMessage()
//chrome.runtime.onMessage.addListener()

//chrome.runtime.sendMessage()
//chrome.runtime.onMessage.addListener()

// contentScript.js

// This script runs on YouTube pages, waits for the video to load, listens for pause events,
// injects a floating helper box, and sends a Chrome message with the pause timestamp.

console.log("[YT-Helper] Content script loaded");

(function() {
  const BOX_ID = "yt-helper-box";
  let lastVideo = null;
  let videoObserver = null;
  let pauseListener = null;
  let playListener = null;

  function log(...args) {
    console.log("[YT-Helper]", ...args);
  }

  function showHelperBox(time) {
    let box = document.getElementById(BOX_ID);
    if (!box) {
      box = document.createElement("div");
      box.id = BOX_ID;
      box.style.position = "fixed";
      box.style.bottom = "100px";
      box.style.right = "20px";
      box.style.backgroundColor = "#1e1e1e";
      box.style.color = "#fff";
      box.style.padding = "12px 18px";
      box.style.borderRadius = "10px";
      box.style.zIndex = 9999;
      box.style.boxShadow = "0 0 10px rgba(0,0,0,0.5)";
      box.style.fontSize = "16px";
      box.style.fontFamily = "sans-serif";
      box.style.pointerEvents = "none";
      document.body.appendChild(box);
    }
    box.textContent = `⏸️ Paused at ${time.toFixed(2)} seconds`;
    log(`Helper box shown at ${time.toFixed(2)}s`);
  }

  function hideHelperBox() {
    const box = document.getElementById(BOX_ID);
    if (box) {
      box.remove();
      log("Helper box removed");
    }
  }

  function sendPauseMessage(time) {
    try {
      chrome.runtime.sendMessage({
        type: "VIDEO_PAUSED",
        videoId: window.location.href,
        time: time
      });
      log("Sent VIDEO_PAUSED message", { time });
    } catch (e) {
      log("Error sending message:", e);
    }
  }

  function attachPauseAndPlayListeners(video) {
    if (!video) return;

    // Remove listeners from the previous video
    if (lastVideo && lastVideo !== video) {
      if (pauseListener) lastVideo.removeEventListener("pause", pauseListener);
      if (playListener) lastVideo.removeEventListener("play", playListener);
      lastVideo._ytHelperListenersAttached = false;
    }

    if (video._ytHelperListenersAttached) return;
    video._ytHelperListenersAttached = true;

    pauseListener = () => {
      log("Pause event fired", { currentTime: video.currentTime, paused: video.paused, ended: video.ended });
      // Only show if the video has actually played and is not at the very start
      if (video.currentTime > 0.1 && !video.ended && video.paused) {
        showHelperBox(video.currentTime);
        sendPauseMessage(video.currentTime);
      } else {
        log("Pause event ignored (likely not a real user pause)");
      }
    };
    playListener = () => {
      hideHelperBox();
    };

    video.addEventListener("pause", pauseListener);
    video.addEventListener("play", playListener);
    log("Pause and play listeners attached to video element");

    lastVideo = video;
  }

  function findAndAttach() {
    const video = document.querySelector("video");
    if (video && (!video._ytHelperListenersAttached || video !== lastVideo)) {
      attachPauseAndPlayListeners(video);
    }
  }

  function observeVideoElement() {
    // Clean up previous observer if any
    if (videoObserver) videoObserver.disconnect();

    // Attach immediately if video is present
    findAndAttach();

    // Observe for new video elements
    videoObserver = new MutationObserver(() => {
      findAndAttach();
    });
    videoObserver.observe(document.body, { childList: true, subtree: true });
    log("Observing for video element changes...");
  }

  // Run on initial load and on YouTube navigation (SPA)
  function onYouTubeNavigation() {
    log("YouTube navigation detected, (re)initializing...");
    observeVideoElement();
  }

  // Listen for YouTube's SPA navigation events
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      onYouTubeNavigation();
    }
  }).observe(document.body, { childList: true, subtree: true });

  // Initial run
  onYouTubeNavigation();
})();

