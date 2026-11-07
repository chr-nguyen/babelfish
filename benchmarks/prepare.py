"""Download official checkpoints and convert compact MT models for CPU inference."""
import os
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
os.environ['HF_HOME'] = str(ROOT / '.benchmark/huggingface')
os.environ['HF_HUB_DISABLE_XET'] = '1'
os.environ['OMP_NUM_THREADS'] = '4'
import json
from huggingface_hub import snapshot_download, model_info
from ctranslate2.converters import TransformersConverter
records = {}
for size in ['tiny', 'base', 'small']:
    repo = f'Systran/faster-whisper-{size}'
    revision = model_info(repo).sha
    path = snapshot_download(repo, revision=revision, allow_patterns=['config.json','model.bin','tokenizer.json','vocabulary.*'], max_workers=2)
    records[size] = {'repo': repo, 'revision': revision, 'path': path}
    print('Downloaded', repo, flush=True)
for pair, repo in [('ja-en','Helsinki-NLP/opus-mt-ja-en'),('en-ja','Helsinki-NLP/opus-tatoeba-en-ja')]:
    revision = model_info(repo).sha
    path = snapshot_download(repo, revision=revision, allow_patterns=['*.json','*.spm','pytorch_model.bin'], max_workers=2)
    target = ROOT / '.benchmark' / pair
    if not (target / 'model.bin').exists():
        TransformersConverter(path).convert(str(target), quantization='int8', force=True)
    records[pair] = {'repo': repo, 'revision': revision, 'path': str(target), 'tokenizer': path}
    print('Prepared', repo, flush=True)
(ROOT / '.benchmark/models.json').write_text(json.dumps(records, indent=2))
