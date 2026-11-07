"""Stream sample WAVs in real time into a local NeMo-Speech realtime server and time captions.

Usage: streaming_asr.py LABEL SAMPLES_DIR [--server ws://127.0.0.1:8090] [--translate http://127.0.0.1:8091]

Audio is paced at 1x real time in 100 ms frames, as a microphone would deliver it. For every
event we record wall time and how much audio had been sent ("audio_s"), so:
  first_text_s   = first delta of a sentence - speech onset (estimated from frame energy)
  final_after_end_s = completed sentence - end of the speech before it (endpointing + decode)
With --translate, each completed sentence is translated by llama-server *while recognition
continues*, measuring the two models competing for the same CPU.
"""
import asyncio, json, sys, time, wave, argparse, statistics, os, re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import numpy as np, psutil, websockets

sys.path.insert(0, str(Path(__file__).parent))
from translate_llm import translate

ROOT = Path(__file__).resolve().parents[1]
FRAME = 1600  # 100 ms at 16 kHz
FILES = ['mixed-en-ja.wav', 'meetA.wav', 'meetB.wav']
is_ja = lambda t: len(re.findall(r'[぀-ヿ㐀-鿿]', t)) > .3 * max(1, len(t.replace(' ', '')))


def server_proc():
    for p in psutil.process_iter(['name']):
        if 'nemo-speech' in (p.info['name'] or ''): return p


async def stream_file(url, path, pool, translate_url, cpu):
    with wave.open(str(path)) as f:
        assert f.getframerate() == 16000 and f.getnchannels() == 1 and f.getsampwidth() == 2
        pcm = np.frombuffer(f.readframes(f.getnframes()), np.int16)
    events, sent, jobs = [], [0], []
    async with websockets.connect(f'{url}/v1/audio/transcriptions/realtime', max_size=None) as ws:
        await ws.send(json.dumps({'type': 'session.update', 'session': {'sample_rate': 16000, 'automatic_punctuation': True}}))
        t0 = time.perf_counter(); done = asyncio.Event(); utter_first = [None]

        async def receive():
            async for raw in ws:
                ev = json.loads(raw); now = time.perf_counter() - t0; audio_s = sent[0] / 16000
                kind = ev.get('type', '')
                if kind.endswith('transcription.delta'):
                    if utter_first[0] is None: utter_first[0] = now
                    events.append({'type': 'delta', 't': now, 'audio_s': audio_s})
                elif kind.endswith('transcription.completed'):
                    text = (ev.get('transcript') or ev.get('text') or '').strip()
                    row = {'type': 'completed', 't': now, 'audio_s': audio_s, 'text': text,
                           'provisional_s': now - (utter_first[0] or now), 'keys': sorted(ev)}
                    utter_first[0] = None; events.append(row)
                    if translate_url and text:
                        target = 'en' if is_ja(text) else 'ja'
                        jobs.append((row, pool.submit(translate, translate_url, text, target)))
                elif kind == 'input_audio_buffer.committed' and done.is_set():
                    return
                elif kind == 'error':
                    events.append({'type': 'error', 't': now, 'event': ev})

        receiver = asyncio.create_task(receive())
        for i in range(0, len(pcm), FRAME):
            await ws.send(pcm[i:i + FRAME].tobytes()); sent[0] = min(len(pcm), i + FRAME)
            proc = server_proc_cache[0]; cpu.append(proc.cpu_percent() if proc else None)
            await asyncio.sleep(max(0, t0 + (i + FRAME) / 16000 - time.perf_counter()))
        end_audio = time.perf_counter() - t0
        for _ in range(10): await ws.send(np.zeros(FRAME, np.int16).tobytes())  # 1 s silence
        done.set(); await ws.send(json.dumps({'type': 'input_audio_buffer.commit'}))
        try: await asyncio.wait_for(receiver, 15)
        except asyncio.TimeoutError: receiver.cancel()
    for row, job in jobs:
        try:
            out, m = job.result(timeout=120)
            row.update(translation=out, translation_s=m['seconds'], translation_first_token_s=m['first_token_seconds'])
        except Exception as e: row['translation_error'] = repr(e)
    completed = [e for e in events if e['type'] == 'completed']
    last = completed[-1]['t'] if completed else None
    # Approximate speech timing from 100 ms frame energy (fine for these clean samples).
    rms = np.sqrt([np.mean((pcm[i:i + FRAME] / 32768.0) ** 2) for i in range(0, len(pcm), FRAME)])
    voiced = rms > max(.01, 3 * np.median(rms))
    prev_audio = 0.0; first_delta = None
    for e in events:
        if e['type'] == 'delta' and first_delta is None: first_delta = e
        if e['type'] != 'completed': continue
        lo, hi = int(prev_audio * 10), min(len(voiced), int(e['audio_s'] * 10))
        idx = np.nonzero(voiced[lo:hi])[0]
        if len(idx):
            onset, end = (lo + idx[0]) / 10, (lo + idx[-1] + 1) / 10
            e['final_after_end_s'] = e['t'] - end
            if first_delta and first_delta['t'] >= onset: e['first_text_s'] = first_delta['t'] - onset
        prev_audio = e['audio_s']; first_delta = None
    return {'file': path.name, 'audio_seconds': len(pcm) / 16000, 'tail_s': (last - end_audio) if last else None,
            'events': events}


server_proc_cache = [None]
med = lambda xs: statistics.median(v) if (v := [x for x in xs if x is not None]) else None
pct = lambda xs, q: float(np.percentile(v, q)) if (v := [x for x in xs if x is not None]) else None


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('label'); ap.add_argument('samples', type=Path)
    ap.add_argument('--server', default='ws://127.0.0.1:8090'); ap.add_argument('--translate')
    a = ap.parse_args()
    proc = server_proc(); server_proc_cache[0] = proc
    if proc: proc.cpu_percent()
    pool = ThreadPoolExecutor(1); files = []; cpu = []
    for name in FILES:
        r = await stream_file(a.server, a.samples / name, pool, a.translate, cpu); files.append(r)
        for e in r['events']:
            if e['type'] == 'completed':
                print(json.dumps({'file': name, **{k: v for k, v in e.items() if k != 'keys'}}, ensure_ascii=False), flush=True)
    deltas = [e for f in files for e in f['events'] if e['type'] == 'delta']
    comps = [e for f in files for e in f['events'] if e['type'] == 'completed']
    trans = [e['translation_s'] for e in comps if 'translation_s' in e]
    cpu = [c for c in cpu if c is not None]
    summary = {
        'label': a.label, 'translate': bool(a.translate), 'load_before': os.getloadavg(),
        'sentences': len(comps), 'deltas': len(deltas),
        'median_first_text_s': med([e.get('first_text_s') for e in comps]),
        'median_final_after_end_s': med([e.get('final_after_end_s') for e in comps]),
        'p90_final_after_end_s': pct([e.get('final_after_end_s') for e in comps], 90),
        'median_provisional_s': statistics.median(e['provisional_s'] for e in comps) if comps else None,
        'tail_s': [f['tail_s'] for f in files],
        'median_translation_s': statistics.median(trans) if trans else None,
        'max_translation_s': max(trans) if trans else None,
        'server_cpu_percent_median': statistics.median(cpu) if cpu else None,
        'server_rss_mb': proc.memory_info().rss / 2**20 if proc else None,
        'event_keys': comps[0]['keys'] if comps else None}
    (ROOT / '.benchmark' / f'result-stream-{a.label}.json').write_text(json.dumps({**summary, 'files': files}, ensure_ascii=False, indent=2))
    print('SUMMARY', json.dumps(summary, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    asyncio.run(main())
