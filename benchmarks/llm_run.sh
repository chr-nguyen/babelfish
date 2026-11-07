#!/usr/bin/env bash
# Usage: llm_run.sh LABEL BUILD(cpu|vulkan) MODEL.gguf [extra llama-server args...]
# Starts llama-server on :8091, waits for it, runs translate_llm.py, then stops it.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; B="$ROOT/.benchmark"
label=$1 build=$2 model=$3; shift 3
"$B/llama-$build/llama-b12180/llama-server" -m "$B/downloads/$model" --host 127.0.0.1 --port 8091 \
  -c 2048 --no-webui "$@" > "$B/llama-$label.log" 2>&1 &
pid=$!; trap 'kill $pid 2>/dev/null; wait $pid 2>/dev/null' EXIT
for i in $(seq 120); do curl -sf http://127.0.0.1:8091/health >/dev/null && break; sleep 1; done
"$B/venv/bin/python" "$ROOT/benchmarks/translate_llm.py" "$label" | tee "$B/run-llm-$label.log" | grep SUMMARY
grep -E "model buffer size|load time" "$B/llama-$label.log" | head -3 || true
