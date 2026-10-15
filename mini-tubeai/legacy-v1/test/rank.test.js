const test = require('node:test');
const assert = require('node:assert/strict');
const { getTopTopics, scoreSegment } = require('../rank.js');

test('score = pauses + 2*replays + watchTime/10', () => {
  assert.equal(scoreSegment({ pauses: 1, replays: 2, watchTime: 30 }), 1 + 4 + 3);
  assert.equal(scoreSegment({}), 0);
});

test('orders by score, highest first, capped at n=4 by default', () => {
  const stats = {
    0: { pauses: 0, replays: 0, watchTime: 30 }, // 3
    1: { pauses: 5, replays: 0, watchTime: 0 },  // 5
    2: { pauses: 0, replays: 4, watchTime: 0 },  // 8
    3: { pauses: 1, replays: 0, watchTime: 0 },  // 1
    4: { pauses: 0, replays: 1, watchTime: 10 }, // 3
    5: { pauses: 2, replays: 0, watchTime: 0 },  // 2
  };
  assert.deepEqual(getTopTopics(stats).map((t) => t.segment), [2, 1, 0, 4]);
  assert.deepEqual(getTopTopics(stats, 2).map((t) => t.segment), [2, 1]);
});

test('ties go to the earlier segment, regardless of key order', () => {
  const stats = {
    9: { pauses: 2, replays: 0, watchTime: 0 },
    3: { pauses: 0, replays: 1, watchTime: 0 },
    6: { pauses: 1, replays: 0, watchTime: 10 },
  };
  assert.deepEqual(getTopTopics(stats).map((t) => t.segment), [3, 6, 9]);
});

test('empty, missing and all-zero input give []', () => {
  assert.deepEqual(getTopTopics({}), []);
  assert.deepEqual(getTopTopics(null), []);
  assert.deepEqual(getTopTopics(undefined), []);
  assert.deepEqual(getTopTopics({ 0: { pauses: 0, replays: 0, watchTime: 0 } }), []);
  assert.deepEqual(getTopTopics({ 0: { pauses: 1 } }, 0), []);
});
