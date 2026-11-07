"""Locate Japanese-bearing windows in the supplied fixtures; not a scored test."""
import os, json, wave, sys
from pathlib import Path
os.environ['HF_HUB_OFFLINE']='1'
import numpy as np
from faster_whisper import WhisperModel
root=Path(__file__).resolve().parents[1]
models=json.loads((root/'.benchmark/models.json').read_text())
model=WhisperModel(models['tiny']['path'],device='cpu',compute_type='int8',cpu_threads=4)
for filename in ['mixed-en-ja.wav','meetA.wav','meetB.wav']:
 with wave.open(str(Path(sys.argv[1])/filename)) as f:
  pcm=np.frombuffer(f.readframes(f.getnframes()),np.int16).astype(np.float32)/32768
 for offset in [6,18,36,48,60]:
  clip=pcm[offset*16000:(offset+6)*16000]
  if len(clip)<16000*4: continue
  segments, info=model.transcribe(clip,beam_size=1,vad_filter=False,condition_on_previous_text=False)
  print(json.dumps({'file':filename,'offset':offset,'language':info.language,'text':' '.join(s.text for s in segments)},ensure_ascii=False),flush=True)
