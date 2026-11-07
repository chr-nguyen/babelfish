import { cleanCaption, languageOf, orderedItems, SpeechGate } from './core.js';
const $ = id => document.getElementById(id);
const items = new Map();
let mode = 'idle', configured = false, epoch = 0, run = null, started = 0, demoTimer, clockTimer;
const settings = { clean: true };
function status(text) { $('status-text').textContent = text; }
function notice(text = '') { $('notice').textContent = text; $('notice').hidden = !text; }
function elapsed() { const seconds = Math.floor((Date.now() - started) / 1000); return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }
function startClock() { started = Date.now(); $('timer').textContent = '00:00'; clearInterval(clockTimer); clockTimer = setInterval(() => $('timer').textContent = elapsed(), 1000); }
function setMode(next) {
  mode = next;
  document.body.classList.toggle('listening', ['live','demo'].includes(mode));
  $('start').classList.toggle('recording', mode === 'live');
  $('start').textContent = mode === 'live' ? '■ Stop listening' : mode === 'connecting' ? 'Connecting…' : mode === 'finishing' ? 'Finishing captions…' : '● Start listening';
  $('start').disabled = ['connecting','finishing','demo'].includes(mode);
  $('microphone').disabled = mode !== 'idle';
  $('demo').disabled = ['connecting','live','finishing'].includes(mode);
  $('demo').textContent = mode === 'demo' ? '■ Stop sample' : 'Try a sample conversation ↗';
  $('clear').disabled = !items.size || mode !== 'idle';
}
function itemFor(id) {
  if (!items.has(id)) items.set(id, { id, raw: '', en: '', ja: '', final: false, revision: 0, time: elapsed(), previous: null });
  return items.get(id);
}
function sorted() { return orderedItems([...items.values()]); }
function sourceText(item) { return cleanCaption(item.raw, settings.clean); }
function showCurrent() {
  const item = sorted().filter(i => sourceText(i) || i.en || i.ja).at(-1);
  if (!item) return;
  const source = item.source || languageOf(item.raw);
  for (const lang of ['en','ja']) {
    const caption = $(`${lang}-caption`);
    caption.classList.remove('placeholder');
    caption.classList.toggle('provisional', !item.final || item.pending);
    caption.textContent = item[lang] || (lang === source ? sourceText(item) : item.error ? 'Translation unavailable' : '…');
    $(`${lang}-state`).textContent = lang === source ? item.final ? 'Original · complete' : 'Original · live' : item.error ? 'Retry below' : item.pending || !item[lang] ? 'Translating…' : item.final ? 'Translation · complete' : 'Translation · live';
  }
  $('caption-note').textContent = item.error || (item.final && !item.pending ? 'Phrase complete. Ready for the next thought.' : 'Live captions may change as the sentence develops.');
}
function renderHistory() {
  const rows = sorted().filter(i => i.final && (sourceText(i) || i.en || i.ja));
  $('count').textContent = `${rows.length} ${rows.length === 1 ? 'phrase' : 'phrases'}`;
  $('download').disabled = !rows.length;
  $('clear').disabled = !items.size || mode !== 'idle';
  if (!rows.length) { $('history').replaceChildren(); const p = document.createElement('p'); p.className = 'empty'; p.textContent = 'Your completed captions will appear here.'; $('history').append(p); return; }
  const fragment = document.createDocumentFragment();
  for (const item of rows.slice(-100).reverse()) {
    const row = document.createElement('div'); row.className = 'history-row';
    const time = document.createElement('time'); time.textContent = item.time; row.append(time);
    const source = item.source || languageOf(item.raw);
    for (const lang of ['en','ja']) {
      const p = document.createElement('p'); p.lang = lang;
      const label = document.createElement('span'); label.className = 'phrase-state'; label.textContent = lang === source ? 'Original' : item.pending ? 'Translating…' : 'Translation'; p.append(label);
      p.append(document.createTextNode(item[lang] || (lang === source ? sourceText(item) : '')));
      if (item.error && lang !== source) { const retry = document.createElement('button'); retry.textContent = 'Retry translation'; retry.onclick = () => translate(item); p.append(retry); }
      row.append(p);
    }
    fragment.append(row);
  }
  $('history').replaceChildren(fragment);
}
function refresh() { showCurrent(); renderHistory(); }
async function translate(item) {
  clearTimeout(item.timer);
  const text = sourceText(item); if (!text) { item.pending = false; refresh(); return; }
  if (item.busy) { item.dirty = true; return; }
  const revision = item.revision, generation = epoch;
  item.busy = true; item.dirty = false; item.pending = true; item.error = '';
  const controller = new AbortController(); item.controller = controller;
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const list = sorted(), index = list.indexOf(item);
    const context = list.slice(Math.max(0, index - 6), index).map(i => sourceText(i).slice(0,3000));
    const response = await fetch('/api/translate', { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: text.slice(-3000), context, clean: settings.clean }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Translation unavailable.');
    if (generation !== epoch) return;
    // A stale response may never overwrite a newer revision of the original.
    if (revision === item.revision) { item.en = result.en; item.ja = result.ja; item.source = result.source; item.pending = false; }
  } catch (error) { if (generation === epoch && revision === item.revision) { item.error = error.name === 'AbortError' ? 'Translation timed out. Retry below.' : error.message; item.pending = false; } }
  finally {
    clearTimeout(timeout); item.busy = false;
    if (generation === epoch) { refresh(); if (item.dirty || revision !== item.revision) item.timer = setTimeout(() => translate(item), item.final ? 0 : 450); }
  }
}
function queueTranslation(item) {
  item.pending = true;
  if (item.final) { clearTimeout(item.timer); translate(item); }
  else if (!item.timer && !item.busy) item.timer = setTimeout(() => { item.timer = null; translate(item); }, 1000);
  else if (item.busy) item.dirty = true;
}
async function microphones() {
  const devices = await navigator.mediaDevices?.enumerateDevices(); if (!devices) return;
  const selected = $('microphone').value;
  $('microphone').replaceChildren(new Option('Default microphone',''));
  devices.filter(d => d.kind === 'audioinput').forEach((d,i) => $('microphone').add(new Option(d.label || `Microphone ${i + 1}`,d.deviceId)));
  if ([...$('microphone').options].some(o => o.value === selected)) $('microphone').value = selected;
}
async function releaseAudio(session) {
  session?.stream?.getTracks().forEach(t => t.stop());
  session?.node?.disconnect();
  if (session?.context && session.context.state !== 'closed') await session.context.close();
}
async function endSession(message = 'Session paused') {
  const session = run; run = null;
  clearTimeout(session?.finishTimer); clearTimeout(session?.connectTimer);
  await releaseAudio(session); session?.socket?.close();
  clearInterval(clockTimer); setMode('idle'); status(message);
}
function onSpeech(event, session) {
  if (run !== session) return;
  if (event.type === 'committed') { const item = itemFor(session.prefix + event.id); item.previous = event.previous ? session.prefix + event.previous : null; refresh(); }
  if (event.type === 'partial' || event.type === 'final') {
    const item = itemFor(session.prefix + event.id);
    item.raw = event.type === 'final' ? event.text : item.raw + (event.delta || '');
    item.revision++; item.final = event.type === 'final'; item.en = ''; item.ja = ''; item.error = '';
    if (item.final) session.pendingTurns = Math.max(0, session.pendingTurns - 1);
    queueTranslation(item); refresh();
  }
  if (event.type === 'caption-error') { session.pendingTurns = Math.max(0, session.pendingTurns - 1); notice(event.message); }
  if (event.type === 'finishing') session.finishAcknowledged = true;
  if (event.type === 'error') { notice(event.message); endSession('Connection interrupted'); }
  if (mode === 'finishing' && session.finishAcknowledged && !session.pendingTurns) endSession();
}
async function startListening() {
  if (!configured) { notice('Live mode needs an OpenAI API key. Add OPENAI_API_KEY to the server’s .env file and restart. You can try the sample conversation now.'); return; }
  if (!navigator.mediaDevices?.getUserMedia) { notice('Microphone access requires localhost or HTTPS and a supported browser.'); return; }
  for (const [id] of items) if (id.startsWith('demo-')) items.delete(id);
  renderHistory();
  notice(); setMode('connecting'); status('Connecting microphone');
  const session = { prefix: crypto.randomUUID(), gate: new SpeechGate(), pendingTurns: 0 }; run = session;
  try {
    session.stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: $('microphone').value ? { exact: $('microphone').value } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    if (run !== session) { await releaseAudio(session); return; }
    await microphones();
    session.context = new AudioContext(); await session.context.resume();
    await session.context.audioWorklet.addModule('/audio-worklet.js');
    session.node = new AudioWorkletNode(session.context,'pcm-capture');
    const mute = session.context.createGain(); mute.gain.value = 0;
    session.context.createMediaStreamSource(session.stream).connect(session.node); session.node.connect(mute).connect(session.context.destination);
    session.socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/listen`);
    session.connectTimer = setTimeout(() => { if (mode === 'connecting' && run === session) { notice('Speech service did not become ready. Check your API configuration.'); endSession('Connection timed out'); } }, 20000);
    session.socket.onmessage = message => {
      let event; try { event = JSON.parse(message.data); } catch { return; }
      if (run !== session) return;
      if (event.type === 'ready') { clearTimeout(session.connectTimer); setMode('live'); startClock(); status('Listening · English ↔ 日本語'); $('stage-label').textContent = 'LIVE CONVERSATION'; }
      onSpeech(event, session);
    };
    session.socket.onclose = () => { if (run === session) { notice('Speech connection closed. Start listening to reconnect.'); endSession('Disconnected'); } };
    session.socket.onerror = () => { if (run === session) { notice('Could not open the speech connection. Check your API configuration.'); endSession('Connection failed'); } };
    session.node.port.onmessage = message => {
      if (mode !== 'live' || session.socket.readyState !== 1) return;
      if (session.socket.bufferedAmount > 240000) { notice('Audio connection is too slow. Please reconnect.'); endSession('Connection too slow'); return; }
      const pcm = new Int16Array(message.data); let energy = 0;
      for (const sample of pcm) energy += (sample / 32768) ** 2;
      const gated = session.gate.push(message.data, Math.sqrt(energy / pcm.length));
      gated.frames.forEach(frame => session.socket.send(frame));
      if (gated.commit) { session.pendingTurns++; session.socket.send(JSON.stringify({ type: 'commit' })); }
    };
    session.stream.getAudioTracks()[0].onended = () => { if (run === session && mode === 'live') stopListening(); };
  } catch (error) { notice(error.name === 'NotAllowedError' ? 'Microphone access was denied. Allow it in your browser and try again.' : 'Could not start the microphone. Check the selected device and try again.'); await endSession('Microphone unavailable'); }
}
async function stopListening() {
  const session = run; if (!session) return;
  setMode('finishing'); status('Finishing the last phrase');
  await releaseAudio(session);
  if (session.socket?.readyState !== 1) { await endSession(); return; }
  if (session.gate.finish()) session.pendingTurns++;
  session.socket.send(JSON.stringify({ type: 'finish' }));
  session.finishTimer = setTimeout(() => { notice('Stopped waiting for the final speech result. Any partial caption remains visible.'); endSession(); }, 12000);
}
const samples = [
  { source: 'en', en: 'Shall we take a little break and get some coffee?', ja: '少し休憩して、コーヒーでも飲みませんか？' },
  { source: 'ja', en: 'Sounds good. There’s a nice café just around the corner.', ja: 'いいですね。すぐそこの角に、いいカフェがありますよ。' },
  { source: 'en', en: 'Perfect. We can talk about the rest on the way.', ja: 'いいですね。続きは歩きながら話しましょう。' }
];
function stopDemo() { clearTimeout(demoTimer); clearInterval(clockTimer); setMode('idle'); status('Sample finished'); }
function demo() {
  if (mode === 'demo') { stopDemo(); return; }
  notice('Sample conversation — prerecorded text, not live speech recognition. Your microphone is off.');
  setMode('demo'); startClock(); status('Sample · microphone off'); $('stage-label').textContent = 'SAMPLE CONVERSATION';
  let index = 0;
  function next() {
    if (index >= samples.length) { stopDemo(); return; }
    const sample = samples[index++]; const item = itemFor(`demo-${crypto.randomUUID()}`); item.source = sample.source;
    const characters = [...sample[sample.source]]; let position = 0;
    function tick() {
      if (mode !== 'demo') return;
      position = Math.min(position + 3, characters.length); item.raw = characters.slice(0, position).join('');
      item[sample.source] = item.raw; item.pending = true; showCurrent();
      if (position < characters.length) demoTimer = setTimeout(tick, 75);
      else demoTimer = setTimeout(() => { Object.assign(item, sample, { final: true, pending: false }); refresh(); demoTimer = setTimeout(next, 2200); }, 450);
    }
    tick();
  }
  next();
}
$('start').onclick = () => mode === 'live' ? stopListening() : startListening();
$('demo').onclick = demo;
$('size').oninput = () => { document.documentElement.style.setProperty('--caption-size', `${$('size').value}px`); $('size-value').value = $('size').value; };
$('clean').onchange = () => { settings.clean = $('clean').checked; showCurrent(); };
$('fullscreen').onclick = async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
  catch { document.body.classList.toggle('focus'); notice('Fullscreen is unavailable in this browser. Focus layout toggled instead.'); }
};
document.addEventListener('fullscreenchange', () => { document.body.classList.toggle('focus', Boolean(document.fullscreenElement)); $('fullscreen').textContent = document.fullscreenElement ? '⛶ Exit fullscreen' : '⛶ Fullscreen'; });
$('clear').onclick = () => {
  epoch++; for (const item of items.values()) { clearTimeout(item.timer); item.controller?.abort(); }
  items.clear(); renderHistory(); $('clear').disabled = true;
  for (const lang of ['en','ja']) { $(`${lang}-caption`).textContent = lang === 'en' ? 'Ready for your next conversation.' : '次の会話を始めましょう。'; $(`${lang}-caption`).className = 'caption placeholder'; $(`${lang}-state`).textContent = 'Ready'; }
  $('caption-note').textContent = 'Both languages appear here as you speak.';
};
$('download').onclick = () => {
  const text = sorted().filter(i => i.final).map(i => `${i.time}\nEN: ${i.en || (languageOf(i.raw) === 'en' ? sourceText(i) : '[Translation unavailable]')}\nJA: ${i.ja || (languageOf(i.raw) === 'ja' ? sourceText(i) : '[Translation unavailable]')}`).join('\n\n');
  const url = URL.createObjectURL(new Blob([`Babelfish · English / 日本語\n\n${text}`], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = `babelfish-${new Date().toISOString().slice(0,10)}.txt`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
window.addEventListener('pagehide', () => { run?.stream?.getTracks().forEach(t => t.stop()); run?.socket?.close(); });
fetch('/api/status').then(r => r.json()).then(data => { configured = data.configured; if (!configured) $('session-note').textContent = 'Try the demo. Add an API key to enable live captions.'; }).catch(() => notice('The app server is unavailable. Reload once it is running.'));
microphones().catch(() => {});
