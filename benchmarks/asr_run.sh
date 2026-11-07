#!/usr/bin/env bash
# Usage: asr_run.sh LABEL SAMPLES_DIR [--translate URL]
# Starts NeMo-Speech (Nemotron streaming 0.6B) on :8090, streams the samples, then stops it.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; B="$ROOT/.benchmark"
label=$1 samples=$2; shift 2
"$B/nemo-speech/nemo-speech-0.3.0-linux-x86_64-cpu/bin/nemo-speech" serve --host 127.0.0.1 --port 8090 \
  --asr-model "$B/downloads/nemotron-3.5-asr-streaming-0.6b.q8_0.gguf" --no-ui \
  --asr.endpointing.enable=true --asr.endpointing.stop_history_eou_ms=1200 > "$B/nemo-$label.log" 2>&1 &
pid=$!; trap 'kill $pid 2>/dev/null; wait $pid 2>/dev/null' EXIT
for i in $(seq 180); do curl -s -o /dev/null http://127.0.0.1:8090/ && break; sleep 1; done
"$B/venv/bin/python" "$ROOT/benchmarks/streaming_asr.py" "$label" "$samples" "$@" | tee "$B/run-stream-$label.log"
