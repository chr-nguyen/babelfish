"""Keep ASR and both MT models resident and time sequential caption processing."""
import os, sys, json, time, wave, resource, statistics
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
os.environ['HF_HOME']=str(ROOT/'.benchmark/huggingface')
os.environ['HF_HUB_OFFLINE']='1'
os.environ['OMP_NUM_THREADS']='4'
import numpy as np
from faster_whisper import WhisperModel
from transformers import MarianTokenizer
import ctranslate2
models=json.loads((ROOT/'.benchmark/models.json').read_text())
asr=WhisperModel(models['base']['path'],device='cpu',compute_type='int8',cpu_threads=4)
translators={p:ctranslate2.Translator(models[p]['path'],device='cpu',compute_type='int8',intra_threads=4) for p in ['ja-en','en-ja']}
tokenizers={p:MarianTokenizer.from_pretrained(models[p]['tokenizer'],local_files_only=True) for p in translators}
rows=[]
samples=Path(sys.argv[1])
for repeat in range(2):
 for filename,offset in [('mixed-en-ja.wav',0),('mixed-en-ja.wav',6),('meetA.wav',0),('meetA.wav',6),('meetB.wav',0),('meetB.wav',6)]:
  with wave.open(str(samples/filename)) as f: pcm=np.frombuffer(f.readframes(f.getnframes()),np.int16).astype(np.float32)/32768
  pcm=pcm[offset*16000:(offset+6)*16000]
  start=time.perf_counter();segments,info=asr.transcribe(pcm,beam_size=1,vad_filter=False,condition_on_previous_text=False)
  text=' '.join(s.text for s in segments).strip(); recognized=time.perf_counter()
  pair='ja-en' if info.language=='ja' else 'en-ja';tok=tokenizers[pair]
  prefix='>>jpn<< ' if pair=='en-ja' and '>>jpn<<' in tok.get_vocab() else ''
  tokens=tok.convert_ids_to_tokens(tok.encode(prefix+text))
  output=translators[pair].translate_batch([tokens],beam_size=2,max_decoding_length=160)[0]
  translated=tok.decode(tok.convert_tokens_to_ids(output.hypotheses[0]),skip_special_tokens=True)
  row={'file':filename,'offset':offset,'repeat':repeat,'language':info.language,'source':text,'translation':translated,'asr_seconds':recognized-start,'translation_seconds':time.perf_counter()-recognized,'total_seconds':time.perf_counter()-start}
  rows.append(row);print(json.dumps(row,ensure_ascii=False),flush=True)
result={'runs':rows,'peak_rss_mb':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024,'warm_median_seconds':statistics.median(r['total_seconds'] for r in rows if r['repeat']==1),'warm_p95_seconds':float(np.percentile([r['total_seconds'] for r in rows if r['repeat']==1],95))}
(ROOT/'.benchmark/result-pipeline.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
print('SUMMARY',json.dumps({k:v for k,v in result.items() if k!='runs'}),flush=True)
