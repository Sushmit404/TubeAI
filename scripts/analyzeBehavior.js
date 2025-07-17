// scripts/analyzeBehavior.js

// Returns a promise that resolves to the top 4 topics by relevanceScore
export async function getTopTopics() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['watchEvents'], (res) => {
      const events = Array.isArray(res.watchEvents) ? res.watchEvents : [];
      const topicStats = {};
      for (const evt of events) {
        if (!evt.topic) continue;
        if (!topicStats[evt.topic]) {
          topicStats[evt.topic] = {
            topic: evt.topic,
            totalPauses: 0,
            totalReplays: 0,
            totalWatchTime: 0
          };
        }
        if (evt.eventType === 'pause') {
          topicStats[evt.topic].totalPauses += 1;
        }
        if (evt.eventType === 'replay') {
          topicStats[evt.topic].totalReplays += 1;
        }
        if (evt.eventType === 'watch' && typeof evt.durationWatched === 'number') {
          topicStats[evt.topic].totalWatchTime += evt.durationWatched;
        }
      }
      // Compute relevanceScore
      const scored = Object.values(topicStats).map(stat => {
        stat.relevanceScore = stat.totalPauses + (2 * stat.totalReplays) + (stat.totalWatchTime / 10);
        return stat;
      });
      // Sort descending by relevanceScore
      scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
      // Return top 4
      resolve(scored.slice(0, 4));
    });
  });
} 