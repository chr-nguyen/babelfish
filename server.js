import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { translationRequest, validateInput, parseTranslation, localTranslationRequest, parseLocalTranslation } from './lib/translation.js';
const port = Number(process.env.PORT || 3000);
const key = process.env.OPENAI_API_KEY;
// BABELFISH_PROVIDER=local uses NeMo-Speech (streaming ASR) and llama-server on this machine.
const local = process.env.BABELFISH_PROVIDER === 'local';
const asrUrl = process.env.LOCAL_ASR_URL || 'ws://127.0.0.1:8090';
const llmUrl = process.env.LOCAL_LLM_URL || 'http://127.0.0.1:8091';
const configured = local || Boolean(key);
const root = new URL('./public/', import.meta.url);
const allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
const sameOrigin = req => allowedHosts.has(req.headers.host) && (!req.headers.origin || [`http://localhost:${port}`, `http://127.0.0.1:${port}`].includes(req.headers.origin));
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
let translating = 0;
export const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src 'self' blob:; object-src 'none'; frame-ancestors 'none'");
  if (!sameOrigin(req)) return json(res, 403, { error: 'Request not allowed.' });
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/api/status' && req.method === 'GET') return json(res, 200, local
    // Local: no partial translations (one CPU shared with speech), 16 kHz continuous audio.
    ? { configured, provider: 'local', liveTranslation: false, sampleRate: 16000, continuous: true }
    : { configured, provider: 'openai', liveTranslation: true, sampleRate: 24000, continuous: false });
  if (path === '/api/translate' && req.method === 'POST') {
    if (!configured) return json(res, 503, { error: 'Add OPENAI_API_KEY to .env and restart the server to enable live translation.' });
    if (translating >= 4) return json(res, 429, { error: 'Translation is busy. Please retry this caption.' });
    translating++;
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 18000);
    res.on('close', () => { if (!res.writableEnded) abort.abort(); });
    try {
      // Collect bytes, then decode once: decoding per chunk corrupts multibyte
      // (Japanese) characters split across chunk boundaries.
      const chunks = []; let size = 0;
      for await (const chunk of req) { chunks.push(chunk); size += chunk.length; if (size > 80000) { json(res, 413, { error: 'Caption too long.' }); return; } }
      let input; try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return json(res, 400, { error: 'Invalid caption request.' }); }
      if (!validateInput(input)) return json(res, 400, { error: 'Invalid caption request.' });
      if (local) {
        const { source, body } = localTranslationRequest(input);
        const response = await fetch(`${llmUrl}/v1/chat/completions`, { method: 'POST', signal: abort.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!response.ok) return json(res, 502, { error: `Local translator returned ${response.status}. Is llama-server running?` });
        return json(res, 200, parseLocalTranslation(await response.json(), input, source));
      }
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST', signal: abort.signal, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(translationRequest(input, process.env.TRANSLATION_MODEL || 'gpt-4.1-mini'))
      });
      if (!response.ok) return json(res, 502, { error: `Translation service returned ${response.status}. Check the server's API configuration or retry.` });
      json(res, 200, parseTranslation(await response.json()));
    } catch { if (!res.destroyed) json(res, 502, { error: 'Translation could not finish. Your original caption is kept; retry when ready.' }); }
    finally { translating--; clearTimeout(timeout); }
    return;
  }
  const files = { '/': 'index.html', '/app.js': 'app.js', '/styles.css': 'styles.css', '/core.js': 'core.js', '/audio-worklet.js': 'audio-worklet.js' };
  if (req.method !== 'GET' || !files[path]) return json(res, 404, { error: 'Not found.' });
  try {
    const file = files[path];
    res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.css') ? 'text/css' : 'text/javascript');
    res.end(await readFile(new URL(file, root)));
  } catch { json(res, 500, { error: 'Could not load the app.' }); }
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 12000 });
server.on('upgrade', (req, socket, head) => {
  if (!sameOrigin(req) || req.url !== '/api/listen' || !configured || wss.clients.size >= 2) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
});
wss.on('connection', client => local ? localSession(client) : openaiSession(client));
// Local streaming ASR. NeMo-Speech speaks an OpenAI-like realtime protocol, but does its own
// endpointing on continuous audio and has no item IDs, so turn IDs are assigned here.
function localSession(client) {
  const upstream = new WebSocket(`${asrUrl}/v1/audio/transcriptions/realtime`, { handshakeTimeout: 15000 });
  const send = value => { if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(value)); };
  let ready = false, finished = false, turn = 0, current = null, last = null;
  const open = () => { current = `t${++turn}`; send({ type: 'committed', id: current, previous: last }); };
  const sessionTimeout = setTimeout(() => { send({ type: 'error', message: 'Session reached one hour. Start a new session to continue.' }); client.close(); }, 3600000);
  upstream.on('open', () => upstream.send(JSON.stringify({ type: 'session.update', session: { sample_rate: 16000, automatic_punctuation: true } })));
  upstream.on('message', raw => {
    let event; try { event = JSON.parse(raw); } catch { return; }
    const type = event.type || '';
    if (type === 'session.updated') { ready = true; send({ type: 'ready' }); }
    else if (type.endsWith('transcription.delta')) { if (!event.delta) return; if (!current) open(); send({ type: 'partial', id: current, delta: event.delta }); }
    else if (type.endsWith('transcription.completed')) {
      const text = (event.transcript || '').trim();
      // Drop lone fragments ("っ", "で") the model emits around language switches.
      const meaningful = text.replace(/[\s\p{P}]/gu, '').length >= 2;
      if (!current && !meaningful) return;
      if (!current) open();
      send({ type: 'final', id: current, text: meaningful ? text : '' }); last = current; current = null;
    }
    else if (type === 'input_audio_buffer.committed' && finished) send({ type: 'finished' });
    else if (type === 'error') { send({ type: 'error', message: 'Local speech server rejected the request.' }); client.close(); }
  });
  client.on('message', (data, binary) => {
    if (!ready || upstream.readyState !== WebSocket.OPEN || finished) return;
    if (binary) { if (data.length % 2 === 0) upstream.send(data); return; }
    let event; try { event = JSON.parse(data); } catch { return; }
    if (event.type === 'finish') { finished = true; send({ type: 'finishing' }); upstream.send(JSON.stringify({ type: 'input_audio_buffer.commit' })); }
  });
  upstream.on('error', () => { send({ type: 'error', message: 'Could not connect to the local speech server. Run npm run local.' }); client.close(); });
  upstream.on('close', () => { if (client.readyState === WebSocket.OPEN) { send({ type: 'error', message: 'Local speech connection ended. Start again to reconnect.' }); client.close(); } });
  client.on('error', () => {});
  client.on('close', () => { clearTimeout(sessionTimeout); upstream.close(); });
}
function openaiSession(client) {
  const upstream = new WebSocket('wss://api.openai.com/v1/realtime?intent=transcription', { headers: { Authorization: `Bearer ${key}` }, handshakeTimeout: 15000 });
  const send = value => { if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(value)); };
  let ready = false, bytes = 0, finished = false;
  const sessionTimeout = setTimeout(() => { send({ type: 'error', message: 'Session reached one hour. Start a new session to continue.' }); client.close(); }, 3600000);
  upstream.on('open', () => upstream.send(JSON.stringify({ type: 'session.update', session: { type: 'transcription', audio: { input: {
    format: { type: 'audio/pcm', rate: 24000 }, transcription: { model: process.env.TRANSCRIPTION_MODEL || 'gpt-live-transcribe', languages: ['en', 'ja'], delay: 'low', prompt: 'A conversation in English and Japanese.' }, turn_detection: null
  } } } })));
  upstream.on('message', raw => {
    let event; try { event = JSON.parse(raw); } catch { return; }
    if (event.type === 'session.updated') { ready = true; send({ type: 'ready' }); }
    else if (event.type === 'input_audio_buffer.committed') send({ type: 'committed', id: event.item_id, previous: event.previous_item_id });
    else if (event.type === 'conversation.item.input_audio_transcription.delta') send({ type: 'partial', id: event.item_id, delta: event.delta });
    else if (event.type === 'conversation.item.input_audio_transcription.completed') send({ type: 'final', id: event.item_id, text: event.transcript });
    else if (event.type === 'conversation.item.input_audio_transcription.failed') send({ type: 'caption-error', id: event.item_id, message: 'Speech recognition failed for this phrase.' });
    else if (event.type === 'error') { send({ type: 'error', message: 'Speech service rejected the request. Check model access and API configuration.' }); client.close(); }
  });
  client.on('message', (data, binary) => {
    if (!ready || upstream.readyState !== WebSocket.OPEN || finished) return;
    if (binary) { if (data.length % 2) return; bytes += data.length; upstream.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: data.toString('base64') })); return; }
    let event; try { event = JSON.parse(data); } catch { return; }
    if (event.type === 'commit' || event.type === 'finish') {
      if (bytes >= 4800) { upstream.send(JSON.stringify({ type: 'input_audio_buffer.commit' })); bytes = 0; }
      if (event.type === 'finish') { finished = true; send({ type: 'finishing' }); }
    }
  });
  upstream.on('error', () => { send({ type: 'error', message: 'Could not connect to the speech service. Check the API key and connection.' }); client.close(); });
  upstream.on('close', () => { if (client.readyState === WebSocket.OPEN) { send({ type: 'error', message: 'Speech connection ended. Start again to reconnect.' }); client.close(); } });
  client.on('error', () => {});
  client.on('close', () => { clearTimeout(sessionTimeout); upstream.close(); });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) server.listen(port, '127.0.0.1', () => console.log(`Babelfish → http://localhost:${port}${local ? ' (local models)' : ''}`));
