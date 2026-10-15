# mini TubeAI — plan

## File layout

```
mini-tubeai/
  manifest.json      MV3; storage + 2 host permissions; content script on /watch*
  background.js      service worker: the only OpenAI caller, the only storage user
  content.js         overlay, transcript loading, <video> tracking, sendWithRetry()
  rank.js            getTopTopics(stats, n=4); loaded before content.js
  popup.html/.js     API key field + Save + "Saved ✓"
  test/*.test.js     node --test, no dependencies
  package.json       only holds `npm test`; nothing to install
```

Every file is plain JavaScript. There's no build step and no `.env`. Shared
files end with `if (typeof module !== 'undefined') module.exports = …`, so
Node can `require()` them while Chrome loads them as classic scripts.

## Data flow for one typed question

1. The user types into the overlay and presses Enter. `content.js` reads
   `video.currentTime` and builds a window of every transcript line within
   ±60s of it, as `[m:ss] text`. If that's over 6,000 characters, the lines
   farthest from the current time are dropped first. An empty window is
   never sent.
2. It sends `{type:'ask', requestId, question, windowText, currentTime, history}`, with history capped at 3 turns,
   to the background through `sendWithRetry()`, which allows 35s and retries
   once if the port closes or the reply times out. The input and Ask button
   are locked while it waits.
3. `background.js` reads `openaiApiKey` and the optional `model` from
   `chrome.storage.local`, fresh for each request. It builds the messages
   (system prompt, up to 6 history messages, then the excerpt plus the
   question), caps their length again, and POSTs to `/v1/chat/completions`
   with a 30s timeout through `AbortController`.
4. The background replies `{ok:true,text}`, or `{ok:false,code,error}` where
   `code` is one of `missing_key`, `unauthorized`, `rate_limited`, `network`,
   `timeout`, `http_error` or `bad_response`.
5. On success, the content script puts the answer into the overlay with
   `textContent` and adds the turn to that video's in-memory history. On
   failure it shows the error and a Retry button. In both cases it unlocks
   the input in a `finally` block.

Clicking a suggestion and a settled pause both go through the same `ask()`.

## Defaults I chose

| Area | Default |
|---|---|
| Location | `mini-tubeai/` folder; the old TubeAI files are left alone |
| Model | `gpt-4`. Override it from the service worker console: `chrome.storage.local.set({model:'gpt-4o-mini'})` |
| OpenAI params | temperature 0.3, max_tokens 600 |
| Transcript entries | `{startSec, endSec, text}`; `endSec` = start + caption duration |
| Question window | ±60s around `video.currentTime`, clipped (not shifted) at the start and end of the video, capped at 6,000 chars. The background also caps it at 12,000 |
| No captions or transcript failed | Message in the overlay, input and Ask button disabled. The background also refuses an empty `windowText` (`no_transcript`) |
| History | 3 turns (6 messages) kept per video in memory, all sent; each capped at 2,000 chars |
| System prompt | Answer from the excerpt; if it isn't there, say so plainly, then optionally give a short general answer labelled as not from the video |
| Transcript source | Inline `<script>` on first load; otherwise fetch the `/watch?v=ID` HTML and parse `ytInitialPlayerResponse` |
| Caption track | Manual English, then auto-generated English, then any manual track, then the first track |
| Segments | 30s, indexed by `floor(t/30)` |
| Pause | Counted after it lasts 800ms (debounced); ignored during ads and at video end |
| Auto-explain | On every debounced pause, unless a request is already running or there's no transcript. Window is ±60s. Controlled by the `AUTO_EXPLAIN_ON_PAUSE` constant |
| Replay | Backward seek of more than 1s into a segment watched **this session**. A repeat for the same segment within 2s is ignored |
| watchTime | Media seconds while playing. Gaps over 1.5s between `timeupdate` events are ignored as seeks. Ads are excluded |
| Stats writes | Batched deltas sent to the background every 10s, on pause, when the tab is hidden, and on navigation. Never retried, to avoid double counting |
| Storage keys | `openaiApiKey`, `model`, `stats:<videoId>`, `suggestionClicks` (last 1,000) |
| Content script and storage | The content script never touches `chrome.storage`; it sends messages to the background instead. This keeps working whether or not `setAccessLevel` locks it out |
| Dev failure | Unpacked builds only. Type `/fail drop <q>` (no reply, so "port closed") or `/fail hang <q>` (never replies, so 35s timeout). Each fails once per requestId, so the retry succeeds |
| Overlay | Closed shadow DOM, fixed bottom-right, collapsible. Typing in it doesn't trigger YouTube's keyboard shortcuts |
| Suggestions | Top 4 segments by score. Segments that score 0 are hidden. Ties go to the earlier segment |
