"""Sequential CPU benchmark; no audio or text is sent to a hosted inference API."""
import os, sys, json, time, statistics, resource, wave, platform
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
os.environ['HF_HOME'] = str(ROOT / '.benchmark/huggingface')
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['OMP_NUM_THREADS'] = '4'
os.environ['MKL_NUM_THREADS'] = '4'
import numpy as np
import psutil
models = json.loads((ROOT / '.benchmark/models.json').read_text())
model_name = sys.argv[1]
result = {'model': model_name, 'threads': 4, 'cpu': platform.processor(), 'load_before': os.getloadavg(), 'available_memory_before_mb': psutil.virtual_memory().available/2**20, 'runs': []}
def summarize():
    times = [r['seconds'] for r in result['runs']]
    result.update(median_seconds=statistics.median(times), p95_seconds=float(np.percentile(times,95)), peak_rss_mb=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024, load_after=os.getloadavg(), available_memory_after_mb=psutil.virtual_memory().available/2**20)
    if model_name in ['tiny','base','small']:
        result['aggregate_real_time_factor'] = sum(times)/sum(r['audio_seconds'] for r in result['runs'])
    path = ROOT / '.benchmark' / f'result-{model_name}.json'
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print('SUMMARY',json.dumps({k:v for k,v in result.items() if k!='runs'}),flush=True)
if model_name in ['tiny','base','small']:
    from faster_whisper import WhisperModel
    start = time.perf_counter()
    model = WhisperModel(models[model_name]['path'], device='cpu', compute_type='int8', cpu_threads=4, num_workers=1)
    result['load_seconds'] = time.perf_counter()-start
    samples = Path(sys.argv[2])
    clips=[]
    for filename, offsets in [('mixed-en-ja.wav',[0,12]),('meetA.wav',[0,24]),('meetB.wav',[0,24])]:
        with wave.open(str(samples/filename)) as f:
            assert f.getnchannels()==1 and f.getframerate()==16000 and f.getsampwidth()==2
            pcm=np.frombuffer(f.readframes(f.getnframes()),np.int16).astype(np.float32)/32768
        for offset in offsets: clips.append((filename,offset,pcm[offset*16000:(offset+6)*16000]))
    list(model.transcribe(clips[0][2],beam_size=1, vad_filter=False)[0])
    for repeat in range(2):
        for filename,offset,pcm in clips:
            start=time.perf_counter(); segments,info=model.transcribe(pcm,beam_size=1,vad_filter=False,condition_on_previous_text=False)
            text=' '.join(segment.text for segment in segments).strip()
            seconds=time.perf_counter()-start
            row={'sample':filename,'offset':offset,'repeat':repeat,'audio_seconds':len(pcm)/16000,'seconds':seconds,'language':info.language,'text':text}
            result['runs'].append(row); print(json.dumps(row,ensure_ascii=False),flush=True)
else:
    import ctranslate2
    from transformers import MarianTokenizer
    start=time.perf_counter()
    tok=MarianTokenizer.from_pretrained(models[model_name]['tokenizer'],local_files_only=True)
    model=ctranslate2.Translator(models[model_name]['path'],device='cpu',compute_type='int8',inter_threads=1,intra_threads=4)
    result['load_seconds']=time.perf_counter()-start
    texts = [
      'Shall we take a short break and get some coffee?',
      'The meeting is tomorrow at three, not today.',
      'I think we should wait until we hear back from Tanaka.',
      'Sorry, did you say fifteen or fifty?',
      'Yes, that sounds good. Let us talk about the rest on the way.',
      'We have not decided yet whether to go ahead with the new plan.'
    ] if model_name=='en-ja' else [
      '少し休憩して、コーヒーでも飲みませんか？',
      '会議は今日ではなく、明日の午後三時です。',
      '田中さんから返事が来るまで、待ったほうがいいと思います。',
      'すみません、十五ですか、それとも五十ですか？',
      'はい、いいですね。続きは歩きながら話しましょう。',
      '新しい計画を進めるかどうかは、まだ決まっていません。'
    ]
    def translate(text):
        prefix='>>jpn<< ' if model_name=='en-ja' and '>>jpn<<' in tok.get_vocab() else ''
        tokens=tok.convert_ids_to_tokens(tok.encode(prefix+text))
        out=model.translate_batch([tokens],beam_size=2,max_decoding_length=160)[0]
        return tok.decode(tok.convert_tokens_to_ids(out.hypotheses[0]),skip_special_tokens=True)
    translate(texts[0])
    for repeat in range(3):
        for text in texts:
            start=time.perf_counter(); output=translate(text); seconds=time.perf_counter()-start
            row={'input':text,'output':output,'repeat':repeat,'seconds':seconds}
            result['runs'].append(row);print(json.dumps(row,ensure_ascii=False),flush=True)
summarize()
