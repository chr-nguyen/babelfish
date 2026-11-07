"""Time EN<->JA caption translation through a local llama-server (OpenAI-compatible API).

Usage: translate_llm.py LABEL [--server http://127.0.0.1:8091] [--no-context]
Start llama-server first (see benchmarks/README.md). Uses the same 12 sentences as the
OPUS-MT runs in run.py so outputs and timings compare directly.
"""
import json, sys, time, statistics, argparse, os
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parents[1]
EN = ['Shall we take a short break and get some coffee?',
      'The meeting is tomorrow at three, not today.',
      'I think we should wait until we hear back from Tanaka.',
      'Sorry, did you say fifteen or fifty?',
      'Yes, that sounds good. Let us talk about the rest on the way.',
      'We have not decided yet whether to go ahead with the new plan.']
JA = ['少し休憩して、コーヒーでも飲みませんか？',
      '会議は今日ではなく、明日の午後三時です。',
      '田中さんから返事が来るまで、待ったほうがいいと思います。',
      'すみません、十五ですか、それとも五十ですか？',
      'はい、いいですね。続きは歩きながら話しましょう。',
      '新しい計画を進めるかどうかは、まだ決まっていません。']

# Fixed text first so llama-server's prompt cache reuses it across requests.
SYSTEM = ('You translate live spoken conversation between English and Japanese for on-screen captions. '
          'Translate only the CURRENT line into the requested language. CONTEXT lines are earlier speech, '
          'for resolving references only; never translate or repeat them. Keep names, numbers, negation and '
          'politeness. Use natural spoken style. Output only the translation, with no notes or quotes.')


def translate(server, text, target, context=(), timeout=60):
    """Return (translation, metrics). Streams so time-to-first-token is measurable."""
    lang = 'Japanese' if target == 'ja' else 'English'
    user = (f'CONTEXT:\n' + '\n'.join(context) + '\n\n' if context else '') + f'Translate into {lang}.\nCURRENT: {text}'
    body = {'messages': [{'role': 'system', 'content': SYSTEM}, {'role': 'user', 'content': user}],
            'temperature': 0, 'max_tokens': 160, 'stream': True, 'cache_prompt': True,
            'chat_template_kwargs': {'enable_thinking': False}}
    start = time.perf_counter(); first = None; out = []; timings = {}
    with requests.post(f'{server}/v1/chat/completions', json=body, stream=True, timeout=timeout) as r:
        r.raise_for_status()
        for line in r.iter_lines():
            if not line.startswith(b'data: ') or line == b'data: [DONE]': continue
            chunk = json.loads(line[6:])
            timings = chunk.get('timings') or timings
            for choice in chunk.get('choices', []):
                piece = (choice.get('delta') or {}).get('content')
                if piece:
                    first = first or time.perf_counter()
                    out.append(piece)
    end = time.perf_counter()
    return ''.join(out).strip(), {
        'seconds': end - start, 'first_token_seconds': (first or end) - start,
        'prompt_tokens': timings.get('prompt_n'), 'prompt_ms': timings.get('prompt_ms'),
        'output_tokens': timings.get('predicted_n'), 'output_tokens_per_second': timings.get('predicted_per_second')}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('label'); ap.add_argument('--server', default='http://127.0.0.1:8091')
    ap.add_argument('--no-context', action='store_true'); ap.add_argument('--repeats', type=int, default=3)
    a = ap.parse_args()
    translate(a.server, EN[0], 'ja')  # warm-up
    runs = []
    for repeat in range(a.repeats):
        for source, target, texts in [('en', 'ja', EN), ('ja', 'en', JA)]:
            for i, text in enumerate(texts):
                context = [] if a.no_context else texts[max(0, i - 2):i]
                output, m = translate(a.server, text, target, context)
                row = {'direction': f'{source}-{target}', 'input': text, 'output': output, 'repeat': repeat, **m}
                runs.append(row); print(json.dumps(row, ensure_ascii=False), flush=True)
    secs = [r['seconds'] for r in runs]; ttft = [r['first_token_seconds'] for r in runs]
    tps = [r['output_tokens_per_second'] for r in runs if r['output_tokens_per_second']]
    summary = {'label': a.label, 'context': not a.no_context, 'n': len(runs), 'load_before': os.getloadavg(),
               'median_seconds': statistics.median(secs), 'p95_seconds': sorted(secs)[int(.95 * (len(secs) - 1))],
               'median_first_token_seconds': statistics.median(ttft),
               'median_output_tokens_per_second': statistics.median(tps) if tps else None}
    (ROOT / '.benchmark' / f'result-llm-{a.label}.json').write_text(json.dumps({**summary, 'runs': runs}, ensure_ascii=False, indent=2))
    print('SUMMARY', json.dumps(summary), flush=True)


if __name__ == '__main__':
    main()
