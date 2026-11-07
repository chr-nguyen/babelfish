# Babelfish

A web app for live English ↔ Japanese captions. Large, high-contrast text, continuous microphone capture, contextual translation, and no synthesized voice.

It runs in one of two modes:

| | **Local mode** | **OpenAI mode** |
|---|---|---|
| Speech recognition | Nemotron 3.5 ASR streaming 0.6B (NeMo-Speech.cpp), on this machine | OpenAI realtime transcription |
| Translation | Qwen3.5-2B (llama.cpp), on this machine | `gpt-4.1-mini` with conversation context |
| Data leaves the computer | No | Audio and caption text go to OpenAI |
| Needs | ~2.6 GB of downloads, ~2.5 GB free RAM | `OPENAI_API_KEY`, pay-per-use |
| Translation quality | Usable, occasional meaning errors | Better (not yet measured live) |

## Run

Requires Node.js 22+ and a recent Chromium-based browser (Chrome is tested).

```sh
npm install
```

### Local mode (no API key, nothing sent online)

Linux x86_64. The first step downloads pinned, SHA-256-verified runtimes and models into the git-ignored `.benchmark/` folder.

```sh
python3 -m venv .benchmark/venv          # only needed for the benchmarks
benchmarks/fetch_local.sh                # one time, ~2.6 GB
npm run local
```

`npm run local` starts the speech server (port 8090), the translation server (port 8091) and the app, then serves **http://localhost:3000**. Startup takes about 10–30 seconds. Ctrl+C stops the servers it started.

### OpenAI mode

```sh
cp .env.example .env    # set OPENAI_API_KEY
npm run dev
```

The key stays on the server, never in the browser or Git. Restart after editing `.env`. Live OpenAI connectivity, recognition quality and latency have not yet been verified with a real key.

Without either mode configured, **Try a sample conversation** still works. It is clearly labeled as simulated.

## Using it

- **Start listening**: grants microphone access and starts captions. English and Japanese are detected automatically.
- **Stop listening**: releases the microphone and waits for the last sentence to finish.
- **⛶ Fullscreen**: the caption view for reading across a table (see below).
- **Text size**: scales captions in both the page and fullscreen.
- **Clean captions**: conservatively removes obvious fillers (um, えーと). It keeps meaningful short replies like はい and うん.
- **Save text**: downloads the conversation. **Clear** removes it from memory.

### Fullscreen view

The original language fills the top half and the translation the bottom half. Each half is a scrolling history: a new sentence glides everything up, the previous line is shown lighter, and older lines dim further and fade out at the top. A translation that arrives late still fills in the right line, even after that line has scrolled up. The control bar and cursor hide after 3 seconds without mouse movement. **Esc** exits. With reduced motion enabled in the OS, lines fade instead of sliding.

## How it works

A small Node HTTP/WebSocket server (`server.js`) serves the page and relays to the speech and translation services. There is no frontend framework and no build step.

```
microphone → AudioWorklet (PCM16, 100 ms frames) → WebSocket /api/listen → server → speech service
                                                                       ↓ partial / final text
                     browser captions ← /api/translate ← server → translation service
```

1. **Audio**: the browser resamples to the speech model's rate (16 kHz local, 24 kHz OpenAI) by creating the AudioContext at that rate. A worklet then emits mono PCM16 in 100 ms frames.
2. **Speech**
   - **Local**: all audio is streamed continuously, because NeMo-Speech finds sentence ends from silence itself. Its protocol resembles OpenAI's realtime events but has no item IDs, so the server assigns turn IDs. Lone fragments such as "っ" or "で", which the model emits around language switches, are dropped.
   - **OpenAI**: a client-side energy gate sends only speech, with 300 ms of audio kept from just before speech starts. It ends a turn after 600 ms of quiet, a shorter pause after 4 s, or 8 s at most.
3. **Translation**
   - **Local**: only finished sentences are translated, because the two models share the CPU. Qwen is asked for the other language only, with thinking disabled and prompt caching on. Context lines are passed only if they are in the same language as the sentence: given context already in the target language, the small model tends to copy it.
   - **OpenAI**: in-progress phrases are also translated, at most every 1–2 s, as are final ones. Structured output returns both languages plus the detected source.
4. **Captions**: the source column always shows the real transcript. Each phrase has a revision number, and the newest translation received is shown even while the sentence is still being spoken; an older response never overwrites a newer one. Finished phrases cancel in-progress requests and retry automatically if the server is busy. Turn IDs and predecessor IDs keep phrases in order when they finish out of order.

Environment variables: `OPENAI_API_KEY`, `PORT` (3000), `TRANSCRIPTION_MODEL`, `TRANSLATION_MODEL`, `BABELFISH_PROVIDER=local` (set by `npm run local`), `LOCAL_ASR_URL` (`ws://127.0.0.1:8090`), `LOCAL_LLM_URL` (`http://127.0.0.1:8091`).

The server binds **127.0.0.1** and checks Host and Origin. It is a local prototype, not a multi-user service. Internet deployment would need HTTPS/WSS, authentication and per-user limits.

## Performance (local mode)

Measured on an i5-8250U laptop (4 cores, 8 GB RAM) with the sample recordings from Adel's LiveTranslate package (not included in this repository). Details and methods are in [benchmarks/README.md](benchmarks/README.md).

| Stage | Typical | Slow (p90 / max) |
|---|---|---|
| Speech starts → first text | ~1.3 s | |
| Speech ends → sentence final | ~1.6 s | ~3.4 s |
| Sentence → translation | ~1.6 s | ~3.7 s |
| **Speech ends → translated caption** | **~3 s** | **~7 s** |

Things that did not help on this hardware: 8 threads (slower than 4), the integrated GPU via Vulkan (2.5× slower), speculative decoding with a 0.8B draft model (2.7× slower), and Qwen3.5-0.8B (fast but drops negation and numbers).

Known weaknesses:
- Short Japanese replies right after English are sometimes missed by the streaming model, and results vary between runs.
- Recognition errors pass straight into the translation (e.g. "penicillin" heard as "pencil").
- Qwen3.5-2B occasionally flips meaning ("Okay" → いいえ, "Good afternoon" → おはようございます).

## Data

- **Local mode**: audio and text stay on this machine.
- **OpenAI mode**: audio and caption text with recent context go to OpenAI. Responses requests set `store: false`; retention is otherwise governed by your API account.

In both modes the app writes nothing to disk. Conversation text stays in browser memory until cleared or the page is closed. At most 100 finished rows are rendered, but export includes every finished phrase in memory. Sessions close after one hour.

## Verify

```sh
npm test               # unit tests
npm run check          # syntax check
npm run test:browser   # Playwright, with mocked speech and translation
```

Browser tests use installed Google Chrome by default. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` for another binary, or `bundled` after `npx playwright install chromium`.

To exercise the real local pipeline end to end, start `npm run local` and replay a WAV file through Chrome's fake microphone:

```sh
node scripts/demo-local.mjs path/to/sample.wav   # logs captions with timings, saves test-results/local-*.png
```

See [development notes](docs/development.md) for design decisions and the real-audio evaluation checklist.
