# mini TubeAI

Ask questions about the YouTube video you're watching. A Chrome extension
sends your question to a small Python server on your own machine. The server
finds the relevant parts of the video's captions and asks OpenAI.

```
 YouTube tab                     Chrome extension                  your machine (127.0.0.1 only)
┌───────────────────┐  message  ┌────────────────────┐  HTTP+JSON  ┌──────────────────────┐
│ content.js        │ ────────► │ background.js      │ ──────────► │ server (FastAPI)     │
│ overlay, captions │ ◄──────── │ adds X-Tube-Token  │ ◄────────── │ /health /ingest /ask │
└───────────────────┘           └────────────────────┘             └───┬─────────────┬────┘
                                 popup: paste token once               │             │
                                                                       ▼             ▼
                                                               LanceDB (files    OpenAI
                                                               in server/data)   (embeddings + chat)
```

Only the server talks to OpenAI. Your OpenAI key lives in `server/.env` and
never goes into the extension.

**Status: Stage 1 of 4 (skeleton).** The server echoes your question back.
Captions, retrieval and OpenAI arrive in stages 2 and 3.

See [PLAN.md](PLAN.md) for the full design and every default.

## 1. Run the server

Requires Python 3.10 or later.

```sh
cd mini-tubeai/server
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env            # then put your OpenAI key in .env (needed from stage 2)
.venv/bin/python -m tubeai
```

On first start it creates a random token and prints it in a box. It prints
the token on every start, and it's also saved in `server/data/token.txt`.
The server only listens on `127.0.0.1:8000`, so other machines can't reach it.

## 2. Load the extension

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select `mini-tubeai/extension`.
   The ID should be `eclaebfeenkjabmcnnogpckkahoppkpn`, fixed by the `key`
   in `manifest.json`. The server's CORS rule only allows that ID.
3. Click the mini TubeAI toolbar icon, paste the token and click **Save**.
4. Open or refresh any YouTube video. The panel appears at the bottom right.

## 3. Run the tests

```sh
cd mini-tubeai/server && .venv/bin/python -m pytest -q
cd mini-tubeai/extension && npm test        # Node 18+, no dependencies
```

## Security model

- **Network:** the server binds to `127.0.0.1` only.
- **Token:** every route except `/health` needs the `X-Tube-Token` header.
  A missing or wrong token gets a 401. The comparison is constant-time.
- **CORS:** only `chrome-extension://eclaebfeenkjabmcnnogpckkahoppkpn` is
  allowed. Ordinary web pages can't read responses from the server, and the
  token stops them from triggering anything.
- **`/health`** needs no token and returns only `{ok, version}`. This lets the
  extension tell "server not running" apart from "wrong token".

## Can LanceDB run inside the extension? No

`@lancedb/lancedb` is a native Node.js add-on. It ships a compiled binary per
platform (`lancedb.linux-x64-gnu.node`, `lancedb.darwin-arm64.node`, ...) and
only installs on darwin, linux or win32. Chrome extensions have no Node
runtime and can't load `.node` binaries, and npm has no WASM or browser build.
So the vector database lives in the Python server.

## Known weaknesses

- **The local server must be running.** If it isn't, the overlay says so and
  shows the start command.
- **Chunk sizes, `TOP_K` and the ranking weights are untuned guesses.**
- **Auto-generated captions are noisy, so retrieval is noisy.**
- **The model sees the captions only, not the video.**
- **Each new video costs a little to embed** (one batch of embeddings plus one
  summary call).
- **The token is stored unencrypted** in `chrome.storage.local`, and in
  `server/data/token.txt`.
- **Retries can bill you twice.** If a request reached OpenAI and the reply
  was lost, the retry makes a second call. *(Retries arrive in stage 3.)*
