// YouTube Learning Assistant - Background Script
// Enhanced with LangChain for better AI reasoning
// Manifest V3 compatible

// import { aiService } from './services/aiService.js';
// import { vectorService } from './services/vectorService.js';

// Configuration
const OPENAI_API_KEY = '';

// Performance metrics tracking
const metrics = {
  responseTimes: [],
  failures: 0,

  logSuccess(duration) {
    this.responseTimes.push(duration);
    this.printMetrics();
  },

  logFailure(duration) {
    this.responseTimes.push(duration);
    this.failures++;
    this.printMetrics();
  },

  printMetrics() {
    const total = this.responseTimes.length;
    const sum = this.responseTimes.reduce((a, b) => a + b, 0);
    const avg = total ? Math.round(sum / total) : 0;
    const success = total - this.failures;
    const successRate = total ? ((success / total) * 100).toFixed(1) : "0.0";

    console.log(`📊 GPT Metrics:
  🔢 Total Requests: ${total}
  ✅ Successes: ${success}
  ❌ Failures: ${this.failures}
  📈 Success Rate: ${successRate}%
  ⏱ Average Time: ${avg} ms`);
  },

  // Manual function to print current metrics
  getCurrentMetrics() {
    const total = this.responseTimes.length;
    const sum = this.responseTimes.reduce((a, b) => a + b, 0);
    const avg = total ? Math.round(sum / total) : 0;
    const success = total - this.failures;
    const successRate = total ? ((success / total) * 100).toFixed(1) : "0.0";

    return {
      total,
      success,
      failures: this.failures,
      successRate,
      averageTime: avg
    };
  }
};

// Add this to your background.js if not present
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const GPT_MODEL = 'gpt-4';
const TEMPERATURE = 0.7;

async function makeGPTRequest(prompt, topic) {
  const startTime = performance.now();
  
  try {
    const requestBody = {
      model: GPT_MODEL,
      messages: [
        { role: 'system', content: 'You are a helpful educational assistant...' },
        { role: 'user', content: prompt }
      ],
      temperature: TEMPERATURE,
      max_tokens: 500
    };
    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify(requestBody)
    });
    if (!response.ok) throw new Error('OpenAI API error');
    const data = await response.json();
    
    // Calculate and log response time
    const endTime = performance.now();
    const duration = Math.round(endTime - startTime);
    console.log(`[⏱️ GPT Response Time] ${duration} ms`);
    
    // Log success metrics
    metrics.logSuccess(duration);
    
    return {
      success: true,
      gptText: data.choices[0].message.content,
      topic: topic,
      usage: data.usage
    };
  } catch (error) {
    // Calculate and log response time for failures
    const endTime = performance.now();
    const duration = Math.round(endTime - startTime);
    console.log(`[⏱️ GPT Response Time (Failed)] ${duration} ms`);
    
    // Log failure metrics
    metrics.logFailure(duration);
    
    return { success: false, error: error.message || 'Unknown error' };
  }
}

// Find related topics using vector search
// async function findRelatedTopics(topic) {
//   try {
//     log(`Finding related topics for: "${topic}"`);
//     const relatedTopics = await vectorService.findRelatedTopics(topic, 3);
//     return {
//       success: true,
//       relatedTopics
//     };
//   } catch (error) {
//     return handleError(error, 'findRelatedTopics');
//   }
// }

function log(...args) {
  console.log('[YT-Background]', ...args);
}

// Handle messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  log('Received message:', message);

  if (message.type === 'GPT_HELP_REQUEST') {
    const { prompt, topic } = message;
    
    if (!prompt || !topic) {
      log('Invalid message: missing prompt or topic');
      sendResponse({
        success: false,
        error: 'Missing prompt or topic in request'
      });
      return true; // Keep message channel open for async response
    }

    log(`Processing GPT help request for topic: "${topic}"`);
    log('Sender:', sender);
    
    // Set a timeout to ensure we don't keep the channel open too long
    const timeoutId = setTimeout(() => {
      log('GPT request timeout, sending error response');
      try {
        sendResponse({
          type: 'GPT_HELP_RESPONSE',
          topic: topic,
          gptText: 'Request timeout - please try again',
          error: true,
          success: false
        });
      } catch (sendError) {
        log('Error sending timeout response:', sendError);
      }
    }, 30000); // 30 second timeout
    
    // Use the plain GPT request function
    makeGPTRequest(prompt, topic)
      .then(result => {
        clearTimeout(timeoutId); // Clear the timeout
        try {
          if (result.success) {
            log('Sending successful GPT response to content script');
            sendResponse({
              type: 'GPT_HELP_RESPONSE',
              topic: result.topic,
              gptText: result.gptText,
              usage: result.usage,
              success: true
            });
          } else {
            log('Sending error response to content script');
            sendResponse({
              type: 'GPT_HELP_RESPONSE',
              topic: topic,
              gptText: `Error: ${result.error}`,
              error: true,
              success: false
            });
          }
        } catch (sendError) {
          log('Error sending response:', sendError);
          // Fallback: try to send via tabs API
          if (sender.tab && sender.tab.id) {
            chrome.tabs.sendMessage(sender.tab.id, {
              type: 'GPT_HELP_RESPONSE',
              topic: result.success ? result.topic : topic,
              gptText: result.success ? result.gptText : `Error: ${result.error}`,
              error: !result.success,
              success: result.success
            }).catch(tabError => {
              log('Error sending via tabs API:', tabError);
            });
          }
        }
      })
      .catch(error => {
        clearTimeout(timeoutId); // Clear the timeout
        log('Unexpected error in GPT request:', error);
        try {
          sendResponse({
            type: 'GPT_HELP_RESPONSE',
            topic: topic,
            gptText: `Unexpected error: ${error.message}`,
            error: true,
            success: false
          });
        } catch (sendError) {
          log('Error sending error response:', sendError);
          // Fallback: try to send via tabs API
          if (sender.tab && sender.tab.id) {
            chrome.tabs.sendMessage(sender.tab.id, {
              type: 'GPT_HELP_RESPONSE',
              topic: topic,
              gptText: `Unexpected error: ${error.message}`,
              error: true,
              success: false
            }).catch(tabError => {
              log('Error sending error via tabs API:', tabError);
            });
          }
        }
      });

    // Return true to indicate we'll send response asynchronously
    return true;
  }

  // Handle chat questions from the assistant window
  if (message.type === 'CHAT_QUESTION') {
    const { question, transcriptData, currentTime } = message;
    // Always send the full transcript if not too large
    let contextSnippet = '';
    if (Array.isArray(transcriptData) && transcriptData.length > 0) {
      // If the transcript is not too large, send the whole thing
      if (transcriptData.length <= 200) { // ~200 segments is usually safe for GPT-4
        contextSnippet = transcriptData.map(seg => seg.text).join(' ');
      } else if (currentTime != null) {
        // Fallback: use a large window around the current time
        let idx = transcriptData.findIndex(seg => seg.time > currentTime);
        if (idx === -1) idx = transcriptData.length;
        let start = Math.max(0, idx - 50);
        let end = Math.min(transcriptData.length, idx + 50);
        contextSnippet = transcriptData.slice(start, end).map(seg => seg.text).join(' ');
      }
    }
    // Update the prompt to instruct the AI to use all the transcript and allow analysis/critique
    const prompt = `You are a helpful assistant for YouTube videos. Use ALL of the transcript below to answer the user's question. If the question asks for analysis, critique, or fact-checking, you may use your own knowledge in addition to the transcript, but clearly indicate when you are using outside knowledge. If the answer is not present in the transcript and you cannot answer, say: 'The transcript does not contain this information.'

Transcript:
${contextSnippet}

User question: ${question}
`;
    makeGPTRequest(prompt, question)
      .then(result => {
        const answer = result.success ? result.gptText : (result.error || 'AI error');
        if (sender.tab && sender.tab.id) {
          chrome.tabs.sendMessage(sender.tab.id, {
            type: 'CHAT_ANSWER',
            answer
          });
        }
      });
    return true;
  }

  // Handle related topics request
  if (message.type === 'FIND_RELATED_TOPICS') {
    const { topic } = message;
    
    if (!topic) {
      sendResponse({
        success: false,
        error: 'Missing topic in request'
      });
      return true;
    }

    // findRelatedTopics(topic)
    //   .then(result => {
    //     chrome.tabs.sendMessage(sender.tab.id, {
    //       type: 'RELATED_TOPICS_RESPONSE',
    //       topic: topic,
    //       relatedTopics: result.success ? result.relatedTopics : [],
    //       error: result.success ? null : result.error
    //     }).catch(error => {
    //       log('Error sending related topics response:', error);
    //     });
    //   })
    //   .catch(error => {
    //     log('Error finding related topics:', error);
    //     chrome.tabs.sendMessage(sender.tab.id, {
    //       type: 'RELATED_TOPICS_RESPONSE',
    //       topic: topic,
    //       relatedTopics: [],
    //       error: error.message
    //     }).catch(sendError => {
    //       log('Error sending error response:', sendError);
    //     });
    //   });
  }

  // Handle metrics request
  if (message.type === 'GET_METRICS') {
    sendResponse({
      success: true,
      metrics: metrics.getCurrentMetrics()
    });
    return false; // Synchronous response
  }

  return true; // Keep message channel open for async responses
});

// Extension installation/update handling
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    log('YouTube Learning Assistant installed');
  } else if (details.reason === 'update') {
    log('YouTube Learning Assistant updated');
  }
});

// Handle extension startup
chrome.runtime.onStartup.addListener(() => {
  log('YouTube Learning Assistant background script started');
});

// Handle persistent connections from content scripts
chrome.runtime.onConnect.addListener((port) => {
  log('Content script connected via port');
  
  port.onMessage.addListener((message) => {
    log('Received message via port:', message);
    
    if (message.type === 'GPT_HELP_REQUEST') {
      const { prompt, topic } = message;
      
      if (!prompt || !topic) {
        port.postMessage({
          type: 'GPT_HELP_RESPONSE',
          success: false,
          error: 'Missing prompt or topic in request'
        });
        return;
      }
      
      log(`Processing GPT help request via port for topic: "${topic}"`);
      
      makeGPTRequest(prompt, topic)
        .then(result => {
          if (result.success) {
            log('Sending successful GPT response via port');
            port.postMessage({
              type: 'GPT_HELP_RESPONSE',
              topic: result.topic,
              gptText: result.gptText,
              usage: result.usage,
              success: true
            });
          } else {
            log('Sending error response via port');
            port.postMessage({
              type: 'GPT_HELP_RESPONSE',
              topic: topic,
              gptText: `Error: ${result.error}`,
              error: true,
              success: false
            });
          }
        })
        .catch(error => {
          log('Unexpected error in GPT request via port:', error);
          port.postMessage({
            type: 'GPT_HELP_RESPONSE',
            topic: topic,
            gptText: `Unexpected error: ${error.message}`,
            error: true,
            success: false
          });
        });
    }
  });
  
  port.onDisconnect.addListener(() => {
    log('Content script disconnected from port');
  });
});

// Log when background script loads
log('Background script loaded and ready to handle GPT requests');

  