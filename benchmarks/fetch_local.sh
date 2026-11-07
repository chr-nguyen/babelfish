#!/usr/bin/env bash
# Download pinned local runtimes and models for the streaming-ASR and Qwen translation
# benchmarks into the ignored .benchmark/ directory. Every file is verified by SHA-256.
# Re-running skips files that are already present and correct.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DL="$ROOT/.benchmark/downloads"
mkdir -p "$DL"

fetch() { # url sha256 dest
  local url="$1" sha="$2" dest="$DL/$3"
  if [[ -f "$dest" ]] && echo "$sha  $dest" | sha256sum -c --status; then echo "ok    $3"; return; fi
  echo "fetch $3"
  curl -fL --retry 3 -C - -o "$dest.part" "$url"
  echo "$sha  $dest.part" | sha256sum -c --quiet
  mv "$dest.part" "$dest"
}
unpack() { # archive dir — each archive into its own fresh directory
  local dir="$ROOT/.benchmark/$2"
  [[ -d "$dir" ]] && return
  mkdir -p "$dir.tmp" && tar -xzf "$DL/$1" -C "$dir.tmp" && mv "$dir.tmp" "$dir"
}

HF=https://huggingface.co
# Speech: same model revision and checksum as Adel's LiveTranslate manifest.
fetch "$HF/nvidia/nemotron-3.5-asr-streaming-0.6b/resolve/1c8deaecc64b91f034d73e08dd8b64625eb3395d/nemotron-3.5-asr-streaming-0.6b.q8_0.gguf" \
  a5c435f294eea8f88ce68dd27b8c3bfea7f777cb2fbba04fcd30eaa555f429ae nemotron-3.5-asr-streaming-0.6b.q8_0.gguf
# Translation candidates (Q4_K_M, pinned revisions).
fetch "$HF/unsloth/Qwen3.5-0.8B-GGUF/resolve/6ab461498e2023f6e3c1baea90a8f0fe38ab64d0/Qwen3.5-0.8B-Q4_K_M.gguf" \
  bd258782e35f7f458f8aced1adc053e6e92e89bc735ba3be89d38a06121dc517 Qwen3.5-0.8B-Q4_K_M.gguf
fetch "$HF/unsloth/Qwen3.5-2B-GGUF/resolve/f6d5376be1edb4d416d56da11e5397a961aca8ae/Qwen3.5-2B-Q4_K_M.gguf" \
  aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223 Qwen3.5-2B-Q4_K_M.gguf

# Runtimes. Checksums are recorded on first download (see SHA256SUMS.local) because these
# release pages publish them per-asset; update both lines together when bumping versions.
NEMO=https://github.com/NVIDIA/NeMo-Speech.cpp/releases/download/v0.3.0/nemo-speech-0.3.0-linux-x86_64-cpu.tar.gz
LLAMA=https://github.com/ggml-org/llama.cpp/releases/download/b12180
NEMO_SHA=$(curl -fsL "$NEMO.sha256" | cut -d' ' -f1)
fetch "$NEMO" "$NEMO_SHA" nemo-speech-cpu.tar.gz
for variant in x64 vulkan-x64; do
  name="llama-b12180-bin-ubuntu-$variant.tar.gz"
  sha=$(curl -fsL "https://api.github.com/repos/ggml-org/llama.cpp/releases/tags/b12180" |
        python3 -c "import json,sys; print(next(a['digest'].split(':')[1] for a in json.load(sys.stdin)['assets'] if a['name']=='$name'))")
  fetch "$LLAMA/$name" "$sha" "$name"
done
unpack nemo-speech-cpu.tar.gz nemo-speech
unpack llama-b12180-bin-ubuntu-x64.tar.gz llama-cpu
unpack llama-b12180-bin-ubuntu-vulkan-x64.tar.gz llama-vulkan
(cd "$DL" && sha256sum *.gguf *.tar.gz > SHA256SUMS.local)
echo "done"
