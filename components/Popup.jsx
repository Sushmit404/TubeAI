import React, { useState, useEffect } from 'react';
import './Popup.css';

const Popup = () => {
  const [assistantStarted, setAssistantStarted] = useState(false);
  const [learningStats, setLearningStats] = useState({
    totalWatchTime: 0,
    totalPauses: 0,
    topicsLearned: 0,
    averageReplayCount: 0
  });
  const [recentTopics, setRecentTopics] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadInitialState();
    loadLearningStats();
  }, []);

  const loadInitialState = () => {
    chrome.storage.local.get(['assistantStarted'], (res) => {
      setAssistantStarted(res.assistantStarted || false);
    });
  };

  const loadLearningStats = () => {
    chrome.storage.local.get(['watchEvents', 'timeWatchedByTopic', 'topicReplayCounts'], (res) => {
      const events = res.watchEvents || [];
      const timeWatched = res.timeWatchedByTopic || {};
      const replayCounts = res.topicReplayCounts || {};

      const totalWatchTime = Object.values(timeWatched).reduce((sum, time) => sum + time, 0);
      const totalPauses = events.filter(e => e.type === 'pause').length;
      const topicsLearned = Object.keys(timeWatched).length;
      const averageReplayCount = Object.values(replayCounts).reduce((sum, count) => sum + count, 0) / Math.max(Object.keys(replayCounts).length, 1);

      setLearningStats({
        totalWatchTime: Math.round(totalWatchTime / 60), // Convert to minutes
        totalPauses,
        topicsLearned,
        averageReplayCount: Math.round(averageReplayCount * 10) / 10
      });

      // Get recent topics
      const recentTopicsList = Object.keys(timeWatched)
        .sort((a, b) => timeWatched[b] - timeWatched[a])
        .slice(0, 5)
        .map(topic => ({
          topic,
          watchTime: timeWatched[topic],
          replayCount: replayCounts[topic] || 0
        }));

      setRecentTopics(recentTopicsList);
    });
  };

  const handleStartAssistant = () => {
    setLoading(true);
    chrome.storage.local.set({ assistantStarted: true }, () => {
      setAssistantStarted(true);
      setLoading(false);
      
      // Send message to content script
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { type: 'SHOW_ASSISTANT_WINDOW' });
        }
      });
    });
  };

  const handleStopAssistant = () => {
    chrome.storage.local.set({ assistantStarted: false }, () => {
      setAssistantStarted(false);
    });
  };

  const formatTime = (minutes) => {
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  };

  return (
    <div className="popup-container">
      <header className="popup-header">
        <div className="logo">
          <span className="logo-icon">🧠</span>
          <h1>Learning Assistant</h1>
        </div>
        <div className="status-indicator">
          <div className={`status-dot ${assistantStarted ? 'active' : 'inactive'}`}></div>
          <span className="status-text">
            {assistantStarted ? 'Active' : 'Inactive'}
          </span>
        </div>
      </header>

      <main className="popup-main">
        {!assistantStarted ? (
          <div className="start-section">
            <div className="welcome-message">
              <h2>Welcome to Your Learning Assistant!</h2>
              <p>Transform your YouTube watching into active learning with AI-powered explanations and quizzes.</p>
            </div>
            
            <button 
              className="start-button"
              onClick={handleStartAssistant}
              disabled={loading}
            >
              {loading ? 'Starting...' : 'Start Learning Assistant'}
            </button>
          </div>
        ) : (
          <div className="dashboard-section">
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-icon">⏱️</div>
                <div className="stat-content">
                  <div className="stat-value">{formatTime(learningStats.totalWatchTime)}</div>
                  <div className="stat-label">Total Watch Time</div>
                </div>
              </div>
              
              <div className="stat-card">
                <div className="stat-icon">⏸️</div>
                <div className="stat-content">
                  <div className="stat-value">{learningStats.totalPauses}</div>
                  <div className="stat-label">Learning Pauses</div>
                </div>
              </div>
              
              <div className="stat-card">
                <div className="stat-icon">📚</div>
                <div className="stat-content">
                  <div className="stat-value">{learningStats.topicsLearned}</div>
                  <div className="stat-label">Topics Learned</div>
                </div>
              </div>
              
              <div className="stat-card">
                <div className="stat-icon">🔄</div>
                <div className="stat-content">
                  <div className="stat-value">{learningStats.averageReplayCount}</div>
                  <div className="stat-label">Avg Replays</div>
                </div>
              </div>
            </div>

            {recentTopics.length > 0 && (
              <div className="recent-topics">
                <h3>Recent Learning Topics</h3>
                <div className="topics-list">
                  {recentTopics.map((item, index) => (
                    <div key={index} className="topic-item">
                      <div className="topic-text">{item.topic.substring(0, 50)}...</div>
                      <div className="topic-stats">
                        <span className="watch-time">{Math.round(item.watchTime)}s</span>
                        <span className="replay-count">{item.replayCount} replays</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button 
              className="stop-button"
              onClick={handleStopAssistant}
            >
              Stop Assistant
            </button>
          </div>
        )}
      </main>

      <footer className="popup-footer">
        <div className="footer-links">
          <button className="link-button" onClick={() => chrome.runtime.openOptionsPage()}>
            Settings
          </button>
          <button className="link-button" onClick={() => window.open('https://github.com/your-repo', '_blank')}>
            GitHub
          </button>
        </div>
      </footer>
    </div>
  );
};

export default Popup; 