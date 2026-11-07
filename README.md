# Babelfish

A local web app for live English ↔ Japanese captions. Large, high-contrast text, continuous microphone capture, contextual translation, and no synthesized voice.

## Run

Requires Node.js 22+ and a recent browser with AudioWorklet and microphone support. Chrome is the tested browser.

```sh
npm install
cp .env.example .env
# Set OPENAI_API_KEY in .env for real speech and translation.
npm run dev
```

Open **http://localhost:3000**. The sample conversation works without an API key and is explicitly labeled as simulated. The key stays on the server, never in the browser or Git. Restart after editing `.env`.

Live usage incurs OpenAI API charges and requires access to the configured models. No key was available during initial development; live provider connectivity, recognition quality, and actual latency have not yet been verified. The included browser integration test uses mocked provider events, not real recognition.

## Controls

- **Start listening**: grants microphone access and opens a speech session. English and Japanese are expected automatically.
- **Stop listening**: releases the microphone immediately and waits up to 12 seconds for final speech results. Translation already in progress may finish afterward.
- **Text size / Fullscreen**: make captions readable across a table.
- **Clean captions**: conservatively removes obvious fillers from subsequent captions. Preserves meaningful Japanese replies and hesitation; not a guarantee of removing every cough or vocal noise.
- **Save text**: explicitly downloads the conversation. **Clear** removes the current in-memory session.
- **Try a sample conversation**: no microphone, API usage, or real translation.

## Architecture

A small Node HTTP/WebSocket server serves the browser interface and keeps API credentials private. No frontend framework or build step is required.

1. Browser microphone → AudioWorklet → mono PCM16 at 24 kHz in 100 ms frames.
2. Browser noise suppression plus an adaptive energy gate. Three frames of pre-roll preserve word starts. End a turn after 600 ms quiet, a shorter pause after 4 seconds, or an 8-second maximum. This is a basic energy gate, not a trained speech/noise classifier.
3. Server relays audio to OpenAI realtime transcription (`gpt-live-transcribe`, low delay, English/Japanese hints). Source deltas display immediately.
4. Throttled partial translations and final translations use Responses (`gpt-4.1-mini` by default), with up to six preceding phrases. Structured output supplies both languages. Revision IDs prevent stale results replacing newer captions.
5. Turn IDs and predecessor IDs reconcile out-of-order transcription completion. Failed translations retain source text with a retry action.

Environment variables: `OPENAI_API_KEY`, `PORT` (3000), `TRANSCRIPTION_MODEL`, `TRANSLATION_MODEL`. The transcription adapter uses the `gpt-live-transcribe` protocol; other models may need different session settings.

The server binds **127.0.0.1** and checks Host/Origin. It is a local prototype, not a multi-user hosting service. Internet deployment requires HTTPS/WSS, authentication, per-user limits, and a hosting adapter. No deployment has been made.

## Data

Audio goes to OpenAI in live mode. Caption text and recent context go to OpenAI for translation. The app does not write audio or transcripts to disk, and Responses requests set `store: false`; provider retention is governed separately by your API account's policies. Conversation text remains in browser memory until cleared or the page is closed. At most 100 completed rows are rendered; export contains all completed phrases in memory. Sessions close after one hour.

## Verify

```sh
npm test
npm run check
npm run test:browser
```

Browser tests use installed Google Chrome by default. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` for another Chrome/Chromium binary, or install Playwright Chromium with `npx playwright install chromium` and set that variable to `bundled`.

See [development notes](docs/development.md) for design decisions and the first real-audio evaluation checklist.
