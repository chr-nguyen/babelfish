# Local CPU feasibility benchmark

These scripts measure actual local inference, not cloud APIs or synthetic CPU scores.
Downloaded weights and the isolated Python environment live in ignored `.benchmark/`.
They are not part of the web app, and do not change its provider.

## Reproduce

```sh
python3 -m venv .benchmark/venv
.benchmark/venv/bin/pip install faster-whisper 'transformers>=4.48,<5' sentencepiece sacremoses psutil
.benchmark/venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu
.benchmark/venv/bin/python benchmarks/prepare.py
.benchmark/venv/bin/python benchmarks/run.py tiny /path/to/LiveTranslate-Setup/app/samples
.benchmark/venv/bin/python benchmarks/run.py base /path/to/LiveTranslate-Setup/app/samples
.benchmark/venv/bin/python benchmarks/run.py small /path/to/LiveTranslate-Setup/app/samples
.benchmark/venv/bin/python benchmarks/run.py ja-en
.benchmark/venv/bin/python benchmarks/run.py en-ja
```

Run timed jobs sequentially. Preparation resolves and records the exact model revisions.
Results include warm inference times, model load time, process peak resident memory,
available system memory, background load and recognized/translated text.

Speech runs use CPU int8, four threads, greedy decoding, automatic language detection,
and six 6-second clips, repeated twice after one warm-up. The clips are offsets 0 and
12 seconds of `mixed-en-ja.wav`, and offsets 0 and 24 seconds of `meetA.wav` and
`meetB.wav`. VAD is disabled to measure recognition rather than silence skipping.
The synthetic mixed sample and real-voice mixed meetings come from Adel's supplied
package; no audio files are copied into the repository. See that package's notices
for recording provenance.

Translation uses the same two OPUS model families as Adel's local mode, converted
locally to CTranslate2 int8, four threads, beam size two. Six manually written
sentences per direction are repeated three times after one warm-up. These timings
are for translation only, not simultaneous execution with speech recognition.

RTF (real-time factor) is processing seconds / audio seconds. RTF below 1 means
batch throughput can keep up; it does NOT mean immediate streaming captions.
Chunk collection and translation add latency. These small samples are not a WER,
CER or translation-quality benchmark, and the 95th percentile is descriptive only.

## Local streaming pipeline (2026-11-07)

`fetch_local.sh` downloads pinned, SHA-256-verified runtimes and models: NeMo-Speech.cpp 0.3.0
with Nemotron 3.5 ASR streaming 0.6B q8 (the same revision as Adel's LiveTranslate),
llama.cpp b12180 (CPU and Vulkan builds), and Qwen3.5 0.8B and 2B (Q4_K_M).

```sh
benchmarks/fetch_local.sh
.benchmark/venv/bin/pip install 'websockets>=13'
benchmarks/llm_run.sh q2b-cpu-t4 cpu Qwen3.5-2B-Q4_K_M.gguf -t 4      # translation only
benchmarks/asr_run.sh nemotron /path/to/LiveTranslate-Setup/app/samples  # streaming ASR only
# combined: start llama-server on :8091 first, then
benchmarks/asr_run.sh combined /path/to/samples --translate http://127.0.0.1:8091
```

`translate_llm.py` uses the same 12 sentences as the OPUS-MT runs, with two preceding lines of
context, thinking disabled, greedy decoding and prompt caching. `streaming_asr.py` streams
the samples at 1x real time in 100 ms frames. Speech onset and end are estimated from frame
energy, so per-sentence latencies are approximate.

Machine: i5-8250U (4 cores / 8 threads), 8 GB RAM (~2.5–3.5 GB available), UHD 620.

| Translation setup | Median | p95 | First token | Notes |
|---|---|---|---|---|
| OPUS-MT int8 (earlier run) | 0.08 s | 0.11 s | — | stiff; casual phrasing errors |
| Qwen3.5-0.8B, CPU, 4 threads | 0.59 s | 1.02 s | 0.35 s | **unusable**: drops negation and numbers, invents sentences |
| **Qwen3.5-2B, CPU, 4 threads** | **1.67 s** | 2.05 s | 0.81 s | keeps negation and numbers; natural; occasional meaning error |
| Qwen3.5-2B, CPU, 8 threads | 2.28 s | 3.47 s | 1.19 s | hyperthreads hurt |
| Qwen3.5-2B, Vulkan (UHD 620) | 4.13 s | 6.41 s | 2.55 s | iGPU slower than CPU |
| Qwen3.5-2B + 0.8B draft (speculative) | 4.46 s | 6.64 s | 1.58 s | 17–39 % acceptance; draft competes for cores |
| Qwen3.5-2B, MTP speculative | — | — | — | GGUF has no MTP tensors |

| Streaming ASR (Nemotron 0.6B q8) | Alone | With Qwen-2B translating |
|---|---|---|
| Speech onset → first text (median) | 1.09 s | 1.34 s |
| Speech end → final sentence (median / p90) | 1.52 / 3.61 s | 1.57 / 3.38 s |
| Stream end → last result | 0.9–1.2 s | 1.2–2.3 s |
| Sentence translation (median / max) | — | 1.56 / 3.73 s |
| Server CPU / RSS | ~450 % / 890 MB | ~410 % / 895 MB |

Findings: Nemotron keeps up in real time with both models resident. It transcribes the
Japanese read sentences that Whisper base mislabeled as English or invented. It still emits
junk fragments around language switches ("っ", "で", "Aksus"), and English medical terms
are weaker than Whisper small ("alerged to pencil then"). ASR errors pass straight into
translation ("pencil" → 鉛筆). Translation errors to watch: "Good afternoon" → おはようございます,
and "Okay" → いいえ (a polarity flip). Speech end → translated caption is about 3 s at the
median and about 7 s at p90.
