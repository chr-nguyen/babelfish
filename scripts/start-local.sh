#!/usr/bin/env bash
# Run Babelfish fully on this machine: NeMo-Speech (Nemotron streaming ASR) on :8090,
# llama-server (Qwen3.5-2B) on :8091, then the app on :3000. Models come from
# benchmarks/fetch_local.sh. Ctrl+C stops everything this script started.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; B="$ROOT/.benchmark"
NEMO="$B/nemo-speech/nemo-speech-0.3.0-linux-x86_64-cpu/bin/nemo-speech"
LLAMA="$B/llama-cpu/llama-b12180/llama-server"
[[ -x "$NEMO" && -x "$LLAMA" ]] || { echo "Local models missing. Run benchmarks/fetch_local.sh first."; exit 1; }
pids=(); trap 'kill "${pids[@]}" 2>/dev/null || true' EXIT
up() { curl -s -o /dev/null "$1"; }
if ! up http://127.0.0.1:8090/; then
  echo "Starting speech recognition (Nemotron streaming 0.6B)…"
  "$NEMO" serve --host 127.0.0.1 --port 8090 --no-ui --asr-model "$B/downloads/nemotron-3.5-asr-streaming-0.6b.q8_0.gguf" \
    --asr.endpointing.enable=true --asr.endpointing.stop_history_eou_ms=1200 > "$B/nemo.log" 2>&1 & pids+=($!)
fi
if ! up http://127.0.0.1:8091/health; then
  echo "Starting translation (Qwen3.5-2B, 4 threads)…"
  # 4 threads measured fastest on a 4-core CPU; Vulkan and speculative decoding were slower.
  "$LLAMA" -m "$B/downloads/Qwen3.5-2B-Q4_K_M.gguf" --host 127.0.0.1 --port 8091 -c 4096 -t 4 --no-webui > "$B/llama.log" 2>&1 & pids+=($!)
fi
for i in $(seq 180); do up http://127.0.0.1:8090/ && curl -sf http://127.0.0.1:8091/health >/dev/null && break; sleep 1; done
curl -sf http://127.0.0.1:8091/health >/dev/null || { echo "Model servers did not start; see .benchmark/*.log"; exit 1; }
BABELFISH_PROVIDER=local node "$ROOT/server.js"
