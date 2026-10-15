# mini TubeAI — plan

A Chrome extension for YouTube backed by a local Python server. The server
splits each video's captions into chunks, stores them in a vector database
(LanceDB), finds the chunks relevant to a question, and asks OpenAI. The
extension never sees the OpenAI key.

```
 YouTube tab                               your machine only
┌──────────────────────────┐   chrome     ┌──────────────────┐   HTTP+JSON    ┌────────────────────────┐
│ content.js               │  messages    │ background.js    │  127.0.0.1:8000│ server (FastAPI)       │
│  overlay, captions,      │ ───────────► │  only caller of  │ ─────────────► │  /health /ingest /ask  │
│  <video> tracking, rank  │ ◄─────────── │  the server      │ ◄───────────── │  X-Tube-Token required │
└──────────────────────────┘              └──────────────────┘                └───────┬────────┬───────┘
 popup.html: paste token once → chrome.storage.local                          LanceDB │        │ OpenAI
                                                                              (files) ▼        ▼ (embeddings, chat)
```

## File layout

```
mini-tubeai/
  PLAN.md  README.md
  extension/                    load this folder unpacked
    manifest.json               MV3; storage; 127.0.0.1:8000 + youtube.com; fixed "key" → fixed ID
    background.js               the ONLY extension code that calls the server
    content.js                  overlay, captions, ingest trigger, pause/quiz, tracking (stage 4)
    rank.js                     getTopTopics(stats, n=4)            (stage 4)
    popup.html, popup.js        token field + Save + "Saved"
    package.json                only `npm test`
    test/*.test.js              node --test
  server/
    .env.example                OPENAI_API_KEY=...  (copy to .env, gitignored)
    requirements.txt
    tubeai/
      config.py                 every tunable as a named constant
      __main__.py               `python -m tubeai`: prints token, runs uvicorn on 127.0.0.1:8000
      main.py                   create_app(): routes, CORS, auth
      auth.py                   token create/load + X-Tube-Token check
      chunker.py                segments → overlapping chunks        (stage 2)
      store.py                  LanceDB tables: chunks, videos       (stage 2)
      llm.py                    OpenAI embeddings + chat, usage log  (stage 2–3)
      rag.py                    retrieval + prompt building          (stage 3)
    tests/                      pytest
    data/                       token.txt + lancedb/  (gitignored, created at first start)
  legacy-v1/                    the earlier extension-only version, kept for reference
```

## Data flow for one question (after stage 3)

1. **Typing:** you type "why does he use a mutex here?" in the overlay at 7:42.
2. **content.js → background.js:** `content.js` sends `{type:'ask', videoId, question, currentTime: 462, history}`
   through `sendWithRetry()`, which allows 35s per attempt and retries once if
   the port closes or the reply times out. The input is locked while it waits.
3. **background.js → server:** `background.js` reads the token from
   `chrome.storage.local` (fresh for every request) and POSTs to
   `http://127.0.0.1:8000/ask` with the `X-Tube-Token` header.
4. **Server checks:**
   - **Token:** it checks the token in constant time. Missing or wrong → 401.
   - **CORS:** only `chrome-extension://<our id>` is allowed.
5. **Retrieval** (`rag.py`):
   1. Embed the question with `text-embedding-3-small`.
   2. Ask LanceDB for the 5 nearest chunks where `videoId = …`.
   3. Add the chunk that contains 462s, drop duplicates and sort by time.
   4. Load the video's stored summary.
6. **Prompt:**
   - instructions: answer only from the excerpts, say so when it isn't
     there, cite `[m:ss]` timestamps, and remember you only see captions;
   - the summary;
   - the chunks, each labelled `[m:ss–m:ss]`;
   - the last 4 history turns;
   - the question.
7. **OpenAI call:** chat completion with `CHAT_MODEL`, a 30s timeout, and at
   most 500 output tokens. The token `usage` is logged.
8. **Reply:** `{answer, sources:[{startSec,endSec}]}`, from server to worker to
   content script.
9. **Display:** the overlay shows the answer and the sources as clickable
   `[7:30–8:30]` chips that seek the video. History gets the new turn.

Ingest happens once per video, before the first question: `content.js` gets
the captions and sends `{type:'ingest', videoId, segments}`. The server
answers `{status:'exists'}` right away if it has the video. Otherwise it
chunks the captions, embeds them in batches, stores them, writes a summary,
and returns `{status:'ingested', chunks:n}`.

## Defaults I chose

| Area | Default | Why |
|---|---|---|
| Layout | `mini-tubeai/extension` + `mini-tubeai/server`; the old version moved to `legacy-v1/` | It wasn't deleted, because it holds your local `config.js` |
| Extension ID | Fixed with a `key` in the manifest: `eclaebfeenkjabmcnnogpckkahoppkpn` | CORS can name the exact origin; can be overridden with `TUBE_EXTENSION_ID` in `.env` |
| Bind | `127.0.0.1:8000`, set in code, not configurable from the command line | Never reachable from the network |
| Token | 32 random bytes (urlsafe) in `server/data/token.txt`, made on first start, printed on every start | Printed every time so you can find it again |
| `/health` | **No token needed**; returns only `{ok, version}` | The extension can tell "server down" from "bad token" |
| Every other route | Token needed; 401 if missing or wrong | |
| CORS | `allow_origins=[chrome-extension://<id>]`, methods GET/POST, headers Content-Type and X-Tube-Token | |
| Worker → server timeout | 32s | Above the server's 30s OpenAI timeout, below the content script's 35s |
| Config | `server/tubeai/config.py`: `CHUNK_SECONDS=60`, `CHUNK_OVERLAP_SECONDS=10`, `TOP_K=5`, `MAX_HISTORY_TURNS=4`, `MAX_OUTPUT_TOKENS=500`, `EMBEDDING_MODEL=text-embedding-3-small`, `CHAT_MODEL=gpt-4` (or `TUBE_CHAT_MODEL` in `.env`) | Untuned guesses, as the file says |
| Embedding batches | 100 chunks per request | |
| Summary | One chat call at ingest; long videos are trimmed to the first ~12k chars plus evenly spaced samples | Keeps the call cheap; noted as a weakness |
| LanceDB | Tables `chunks` (`videoId`, `startSec`, `endSec`, `text`, `vector`) and `videos` (`videoId`, `title`, `summary`, `ingestedAt`) | |
| Concurrency | A per-video lock so two tabs don't ingest the same video at once | |
| Captions | Read from HTML (see README). Track order: manual English, auto English, any manual, first | |
| Pause | Debounced 800ms; explanation + 2-question quiz about the chunk at that moment | |
| History | Content-script memory, per video; the last 4 turns are sent | |
| Stats | `stats:<videoId>` in `chrome.storage.local`; an LRU index keeps the last 50 videos | |
| Dev failure | Unpacked builds only. Type `/fail drop <q>` or `/fail hang <q>`; it fails once per requestId | |
| Tests | Server: pytest, with fake embeddings and a mocked OpenAI. Extension: `node --test`, no dependencies | |
