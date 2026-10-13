const test = require('node:test');
const assert = require('node:assert/strict');
const { buildWindow } = require('../content.js');

// A 10-minute video with one 5s caption line every 5s: line i covers [5i, 5i+5).
const video = Array.from({ length: 120 }, (_, i) => ({ startSec: i * 5, endSec: i * 5 + 5, text: `line${i}` }));
const times = (w) => w.split('\n').map((l) => l.match(/^\[(.+?)\]/)[1]);

test('middle of the video: about +/-60s around currentTime', () => {
  const w = buildWindow(video, 300); // 5:00
  const t = times(w);
  assert.equal(t[0], '3:55');  // line 47 [235,240) touches 240 = 300-60
  assert.equal(t[t.length - 1], '6:00'); // line 72 starts at 360 = 300+60
  assert.ok(w.includes('[5:00] line60'));
});

test('start of the video: window is clipped at 0, not shifted', () => {
  const t = times(buildWindow(video, 10));
  assert.equal(t[0], '0:00');
  assert.equal(t[t.length - 1], '1:10'); // 10 + 60
});

test('end of the video: window is clipped at the last line', () => {
  const t = times(buildWindow(video, 598)); // 9:58 of a 10:00 video
  assert.equal(t[0], '8:55'); // line 107 [535,540) is the first to reach 538 = 598-60
  assert.equal(t[t.length - 1], '9:55'); // last line; nothing exists past 10:00
});

test('short transcript: everything fits, nothing invented', () => {
  const short = [
    { startSec: 1, endSec: 4, text: 'Hi.' },
    { startSec: 4, endSec: 9, text: 'This is short.' },
  ];
  assert.equal(buildWindow(short, 3), '[0:01] Hi.\n[0:04] This is short.');
  assert.equal(buildWindow(short, 500), ''); // nothing within 60s -> empty, caller won't send
  assert.equal(buildWindow([], 0), '');
});

test('character cap drops the lines farthest from currentTime first', () => {
  const w = buildWindow(video, 300, { maxChars: 60 });
  assert.ok(w.length <= 60);
  assert.ok(w.includes('line60'), w); // the line at currentTime survives
  const nums = w.split('\n').map((l) => Number(l.match(/line(\d+)/)[1]));
  assert.ok(Math.max(...nums) - 60 <= 3 && 60 - Math.min(...nums) <= 3, w);
});
