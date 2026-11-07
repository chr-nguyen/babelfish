# Babelfish

A web app for live English ↔ Japanese captions. Large, high-contrast text, continuous microphone capture, contextual translation, and no synthesized voice.

It runs **entirely on this computer**: speech recognition and translation are local models, and no audio or text is sent online.

| Stage | Model | Runtime |
|---|---|---|
| Speech recognition | Nemotron 3.5 ASR streaming 0.6B (q8_0, 0.74 GB) | NeMo-Speech.cpp 0.3.0, CPU |
| Translation | Qwen3.5-2B Instruct (Q4_K_M, 1.3 GB) | llama.cpp `llama-server` b12180, CPU, 4 threads |

An optional OpenAI cloud mode also exists in the code, but it has never been run with a real API key (see [Optional: OpenAI cloud mode](#optional-openai-cloud-mode-untested)).

## Run

Requires Node.js 22+ and a recent Chromium-based browser (Chrome is tested).

```sh
npm install
```

Linux x86_64. The first step downloads pinned, SHA-256-verified runtimes and models (~2.6 GB) into the git-ignored `.benchmark/` folder. About 2.5 GB of free RAM is needed while running.

```sh
benchmarks/fetch_local.sh   # one time
npm run local
```

`npm run local` starts the speech server (port 8090), the translation server (port 8091) and the app, then serves **http://localhost:3000**. Startup takes about 10–30 seconds. Ctrl+C stops the servers it started.

Note: `npm start` and `npm run dev` start the untested OpenAI mode, not local mode.

Without any model running, **Try a sample conversation** still works. It is clearly labeled as simulated.

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

1. **Audio**: the browser resamples the microphone to 16 kHz by creating the AudioContext at that rate, and a worklet emits mono PCM16 in 100 ms frames. Browser noise suppression and auto-gain are off, because they hurt recognition.
2. **Speech**: all audio, including silence, is streamed continuously to NeMo-Speech, which finds sentence ends itself (after 1.2 s of quiet). It sends text as words are recognized and a final transcript per sentence. It has no item IDs, so the server assigns turn IDs. Lone fragments such as "っ" or "で", which the model emits around language switches, are dropped.
3. **Translation**: only finished sentences are translated, because the two models share the CPU. Qwen is asked for the other language only; the transcript is shown as-is for the original. See [Translation model settings](#translation-model-settings) below.
4. **Captions**: the source column always shows the real transcript. Each phrase has a revision number, and the newest translation received is shown even while the sentence is still being spoken; an older response never overwrites a newer one. Finished phrases cancel in-progress requests and retry automatically if the server is busy. Turn IDs and predecessor IDs keep phrases in order when they finish out of order.

### Translation model settings

| Setting | Value | Set in |
|---|---|---|
| Model | Qwen3.5-2B Instruct, Q4_K_M quantization (4-bit, 1.3 GB) | `scripts/start-local.sh` |
| Context window | **4,096 tokens**, shared by llama-server's default 4 parallel slots | `-c 4096` in `scripts/start-local.sh` |
| Max output per translation | **200 tokens** (a safety cap) | `max_tokens` in `lib/translation.js` |
| Context passed | Up to 2 earlier lines, same language as the sentence only | `localTranslationRequest` in `lib/translation.js` |
| Decoding | Temperature 0 (greedy), thinking disabled, prompt caching on | `lib/translation.js` |
| CPU threads | 4 | `-t 4` in `scripts/start-local.sh` |

Actual usage per translation, measured in the benchmark (with nearly the same prompt):

- **Prompt:** the fixed instructions are cached after the first request. Each request then processes about **59 new tokens** (at most 63).
- **Output:** about **12 tokens** (at most 17).

So a request uses under 100 of the 4,096 tokens. The window and output cap are far larger than needed. Context lines in the target language are left out because the small model tends to copy them instead of translating.

Environment variables: `PORT` (3000), `BABELFISH_PROVIDER=local` (set by `npm run local`), `LOCAL_ASR_URL` (`ws://127.0.0.1:8090`), `LOCAL_LLM_URL` (`http://127.0.0.1:8091`).

The server binds **127.0.0.1** and checks Host and Origin. It is a local prototype, not a multi-user service. Internet deployment would need HTTPS/WSS, authentication and per-user limits.

## Performance

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

Audio and text stay on this machine. The app writes nothing to disk. Conversation text stays in browser memory until cleared or the page is closed. At most 100 finished rows are rendered, but export includes every finished phrase in memory. Sessions close after one hour.

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

## Optional: OpenAI cloud mode (untested)

The code still contains the original cloud pipeline. It has **never been run with a real API key**, so its connectivity, quality and latency are unverified.

```sh
cp .env.example .env    # set OPENAI_API_KEY
npm run dev
```

- **Speech:** OpenAI realtime transcription (`gpt-live-transcribe` by default) at 24 kHz. A client-side energy gate sends only speech, keeping 300 ms from just before speech starts, and ends a turn after 600 ms of quiet, a shorter pause after 4 s, or 8 s at most.
- **Translation:** `gpt-4.1-mini` by default, with up to 6 earlier phrases as context. In-progress phrases are translated too, at most every 1–2 s. Structured output returns both languages plus the detected source, with at most 700 output tokens.
- **Data:** audio, caption text and recent context go to OpenAI. Requests set `store: false`; retention is otherwise governed by your API account.
- **Variables:** `OPENAI_API_KEY`, `TRANSCRIPTION_MODEL`, `TRANSLATION_MODEL`.

The key stays on the server, never in the browser or Git. Restart after editing `.env`.
