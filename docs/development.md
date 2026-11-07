# First version — 2026-11-07

## Product intent

A web app for continuous English/Japanese audio → bilingual on-screen text. The primary priorities are legibility, speed, natural phrasing, and conservative filler reduction. There is no spoken translation. Fixed English/Japanese columns, 28–80 px caption controls (mobile capped at 56 px), fullscreen, and explicit source/translation labels support reading at a distance.

## What Adel's LiveTranslate informed

Reviewed `Downloads/LiveTranslate-Setup/app/index.html`, `server.py`, README, and third-party notices. No source, recordings, models, or installers were copied into this repository. Useful patterns were AudioWorklet microphone capture, provisional/final captions, language switching, sentence-boundary handling, and reproducible audio tests. This version omits speaker biometrics and the Windows model installation. Translation is separate from speaker analysis and doesn't discard queued finalized phrases to catch up.

## Current limits

- No API key was configured during development. Real EN/JA recognition, code-switching, noise rejection and latency are unmeasured. Do not treat demo timings or mocked integration tests as evidence of provider performance.
- The energy gate rejects quiet background; loud non-speech sounds can still pass. Future improvement: a trained VAD, evaluated against quiet speech and short Japanese acknowledgments.
- Partial language placement is a Japanese-character heuristic; structured translation resolves the source language afterward. Mixed-language speech may move between provisional labels.
- Natural translation uses short context and instructions, and still needs human bilingual evaluation. Japanese sentence endings can force revisions.
- Translated text arrives per partial/final request, not token-by-token. Requests are throttled and capped; busy/failed translations expose Retry.
- Conversation data is transient browser memory; no persistent history, accounts or shared-room feature.
- This app is local-only and must not be exposed by changing the bind address without adding authentication and deployment controls.

## Next real-audio evaluation

Use consented recordings and live microphones, not just synthetic speech. For each case, measure first source text, first useful translation, stable final translation, dropped words, and translation revisions:

1. English then Japanese, including short `はい`, `うん`, dates, names, numbers and negation.
2. Long Japanese clauses, mid-sentence pauses and sentence-final changes of meaning.
3. Switching languages mid-turn and back-to-back speakers.
4. Silence, breathing, coughing, laughter, fan/café noise, quiet speakers and false starts.
5. Network interruption, slow translation, microphone permission denial, stop during speech and restart.
6. A 30-minute conversation to examine backlog, stability and cost.

## API references used

- https://developers.openai.com/api/docs/guides/realtime-transcription
- https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses

Live transcription configuration follows the documented transcription session (`intent=transcription`), PCM24k input, client-side commits, English/Japanese language hints, and delta/completion item IDs. Model access must be confirmed with the user's API account.
