# mini TubeAI

A small Manifest V3 Chrome extension for YouTube. While you watch, a floating
panel lets you ask questions about the video. When you pause, it explains the
part around that point and gives you a 2-question quiz. It also suggests the
parts you paused on or replayed the most. Plain JavaScript, with no build step
and no dependencies.

See [PLAN.md](PLAN.md) for the architecture and every default it uses.

## Load it in Chrome

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and select this `mini-tubeai/` folder.
3. Click the mini TubeAI toolbar icon, paste your OpenAI API key and click
   **Save**. You should see "Saved ✓".
4. Open a YouTube video that has captions. If the tab was already open,
   reload it first. The panel appears at the bottom right.

After you change any file, click the reload icon on the extension card and
then **refresh the YouTube tab**. Chrome doesn't re-inject content scripts
into tabs that are already open.

## Run the tests

Requires Node 18 or later. There's nothing to install.

```sh
cd mini-tubeai
npm test          # same as: node --test
```

The tests cover:

- `rank.js`: ordering, ties and empty input.
- The background handler with a mocked `fetch`: success, 401, 429, network
  error, timeout, missing key, and a fresh key read on every request.
- The content script's `sendWithRetry`: success on the retry, failure after
  one retry, and errors that shouldn't be retried.
- Transcript parsing and windowing.

## Permissions

| Permission | Why |
|---|---|
| `storage` | Holds the API key, per-video stats and the suggestion-click log |
| `https://api.openai.com/*` | Lets the service worker call chat completions |
| `https://www.youtube.com/*` | Requested per the spec. The content script's fetches are same-origin, so they would probably work without it. See "Decisions" below |

The content script runs only on `https://www.youtube.com/watch*`. The
extension doesn't use `tabs`, `scripting` or any other permission.

## Where the transcript comes from, and why

Content scripts run in an isolated world, so they can't read
`window.ytInitialPlayerResponse`. mini TubeAI reads the same data from HTML
instead:

1. **First page load:** it parses the player response out of the page's
   inline `<script>` tags. It only uses the result if
   `videoDetails.videoId` matches the current video.
2. **After in-page navigation** (YouTube is a single-page app): those script
   tags still describe the first video. So it fetches `/watch?v=<id>`
   (same-origin, no extra permission) and parses the same object from the
   returned HTML.

It then picks a caption track and fetches `baseUrl&fmt=json3`.

I chose this over injecting a script into the page's own world. Injection
would need an extra file in `web_accessible_resources` and a
`postMessage` bridge to send data back. It would also run code inside
YouTube's page and depend on YouTube's internal variables staying stable. The
cost of my approach is one extra HTML request per in-page navigation.

If the video has no captions, the panel says so and doesn't call OpenAI.

## Failure handling

- Every `chrome.runtime.sendMessage` call goes through `sendWithRetry()` in
  `content.js`, which allows 35s per attempt. If the reply times out or the
  port closes, it retries once. If that fails too, the panel shows the error
  and a **Retry** button. The input is always unlocked in a `finally` block,
  so the spinner can't get stuck.
- The background's own OpenAI timeout is 30s, shorter than the content
  script's 35s, so an OpenAI timeout normally arrives as a clean `timeout`
  error rather than as a lost message.
- **Simulating a dead worker (unpacked builds only):** type
  `/fail drop What is this?` to get no response, which looks like "message
  port closed". Type `/fail hang What is this?` to get no response for 35s,
  which triggers the timeout. Each fails once and the automatic retry
  succeeds. To kill the worker for real, open
  `chrome://serviceworker-internals`, find mini TubeAI and click **Stop**
  while a request is in progress.

## Known weaknesses

- **Retries can bill you twice.** If the worker sent the OpenAI request and
  then died or went quiet, the retry sends a second request, and both are
  billed. The same applies to the Retry button. This is a deliberate trade:
  a hung panel is worse than a rare duplicate charge.
- **The API key may be readable by content scripts.** On startup the worker
  calls `chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'})`.
  The sources disagree on whether this works for `storage.local`: Chrome's
  docs say it does, MDN says only `storage.session` supports it. If Chrome
  rejects or lacks the call, the worker logs a warning in its console and
  the key stays readable by this extension's content scripts. Pages on
  youtube.com still can't read it either way. The content script never reads
  storage, so behavior is the same in both cases.
- **The key is stored in plain text** in the extension's profile storage.
  Anyone with access to your Chrome profile on disk can read it.
- **Transcript fetching may break.** YouTube sometimes requires an extra token
  on timedtext requests and returns an empty body without it. When that
  happens the panel shows "Captions exist, but YouTube returned an empty
  transcript". The EU cookie-consent interstitial can also break the HTML
  fetch.
- **The panel can fail to appear after in-page navigation.** The content
  script only matches `/watch*`. If you open YouTube's home page and click
  into a video, Chrome never injects the script, so there's no panel until
  you reload the page. If you land on a watch page first, navigation works,
  and the panel hides itself off watch pages.
- **Auto-explain costs money on every settled pause,** which can mean a lot
  of calls if you pause often.
- **Ranking weights are untuned** (`pauses + 2*replays + watchTime/10`).
- **Stats are best effort.** A batch whose message fails is dropped, not
  retried. Replays only count for segments watched in the current session.
- **History is in memory only.** It's lost on page reload and reset when the
  video changes.
- **There are no icons,** so Chrome shows a default letter icon.

## Decisions I need from you

None of these blocked the build. I picked the first option in each case.

1. **Location:** the code is in `mini-tubeai/` and the old TubeAI files at the
   repo root are untouched. Should the old code be deleted, or this folder
   moved to the root?
2. **Model:** the default is `gpt-4` as specified. It is far more expensive
   than `gpt-4o-mini` or newer models. Should the default change?
3. **Content script match:** the spec says `/watch*`, which means no panel
   after in-page navigation from the home page. Should I match
   `https://www.youtube.com/*` and only show the panel on watch pages?
4. **The youtube.com host permission:** keep it, as specified, or drop it to
   shrink the permission prompt?
5. **Auto-explain on every pause:** keep it, add a cooldown (for example one
   per 60s), or make it opt-in? Making it a toggle would add a second control
   to the popup, which the spec currently forbids.
6. **Locking the key:** if `setAccessLevel` turns out to be unsupported for
   `storage.local`, should the key move to `storage.session`? That is locked
   by default but cleared on browser restart, so you'd re-enter the key each
   session.
7. **Pause counting:** a pause only counts after it lasts 800ms. Should every
   raw pause count instead?
8. **Replay memory:** should a backward seek into a segment watched in an
   earlier session also count as a replay? Right now only the current
   session counts.
