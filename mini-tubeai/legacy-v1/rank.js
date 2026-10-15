// rank.js — picks the segments a viewer struggled with most.
// Loaded as a classic content script (defines a global) and as a CommonJS
// module in Node tests.

// Weights are an UNTUNED GUESS: a replay is treated as twice as telling as a
// pause, and 10 seconds of watching counts like one pause. Suggestion clicks
// are logged (see content.js / background.js) so these can be tuned later.
const RANK_WEIGHTS = { pauses: 1, replays: 2, watchTimeDivisor: 10 };

function scoreSegment(s) {
  if (!s) return 0;
  const pauses = Number(s.pauses) || 0;
  const replays = Number(s.replays) || 0;
  const watchTime = Number(s.watchTime) || 0;
  return pauses * RANK_WEIGHTS.pauses +
    replays * RANK_WEIGHTS.replays +
    watchTime / RANK_WEIGHTS.watchTimeDivisor;
}

// stats: { [segmentIndex]: { pauses, replays, watchTime } }
// Returns up to n entries [{ segment, score }], highest score first.
// Ties go to the earlier segment. Segments scoring 0 are dropped.
function getTopTopics(stats, n = 4) {
  if (!stats || typeof stats !== 'object' || n <= 0) return [];
  return Object.keys(stats)
    .map((k) => ({ segment: Number(k), score: scoreSegment(stats[k]) }))
    .filter((t) => Number.isFinite(t.segment) && t.score > 0)
    .sort((a, b) => b.score - a.score || a.segment - b.segment)
    .slice(0, n);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getTopTopics, scoreSegment, RANK_WEIGHTS };
}
