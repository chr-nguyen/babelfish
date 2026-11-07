// End-to-end demo of local mode: Chrome's microphone is replaced by a WAV file, which plays
// once in real time through the real UI, AudioWorklet, server, NeMo-Speech and llama-server.
// Usage: node scripts/demo-local.mjs path/to/sample.wav   (with `npm run local` running)
import { chromium } from '@playwright/test';
const wav = process.argv[2];
if (!wav) { console.error('Usage: node scripts/demo-local.mjs sample.wav'); process.exit(1); }
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: [
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}%noloop`] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', e => console.log('PAGE ERROR', e.message));
await page.goto(process.env.APP_URL || 'http://localhost:3000/');
await page.waitForFunction(() => document.getElementById('session-note').textContent.includes('Local'));
const t0 = Date.now(), seen = new Set(), at = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(5);
// Show what the speech server finalized, so recognition and translation issues can be told apart.
page.on('websocket', ws => ws.on('framereceived', ({ payload }) => {
  try { const e = JSON.parse(payload); if (['final', 'finished', 'error'].includes(e.type) || (process.env.DEBUG && e.type === 'partial')) console.log(`${at()}s  [speech ${e.type}] ${e.text ?? e.delta ?? e.message ?? ''}`); } catch {}
}));
await page.locator('#start').click();
await page.waitForFunction(() => document.getElementById('status-text').textContent.includes('Listening'), null, { timeout: 30000 });
console.log(`${at()}s listening`);
const poll = async () => {
  const rows = await page.$$eval('.history-row', rs => rs.map(r => [...r.querySelectorAll('p')].map(p => p.textContent)));
  for (const [en, ja] of rows.reverse()) {
    const key = en + '|' + ja; if (seen.has(key) || /Translating…/.test(key)) continue;
    seen.add(key); console.log(`${at()}s  ${en}\n          ${ja}`);
  }
};
let shot = false;
while (Date.now() - t0 < Number(process.env.SECONDS_TO_PLAY || 46) * 1000) {
  await poll(); await page.waitForTimeout(250);
  if (!shot && Date.now() - t0 > 15000) { await page.screenshot({ path: 'test-results/local-live.png' }); shot = true; }
}
await page.locator('#start').click(); console.log(`${at()}s stop pressed`);
await page.waitForFunction(() => document.getElementById('status-text').textContent === 'Session paused', null, { timeout: 20000 });
await page.waitForFunction(() => !document.getElementById('history').textContent.includes('Translating…'), null, { timeout: 30000 }).catch(() => {});
await poll(); console.log(`${at()}s finished: ${await page.locator('#count').textContent()}`);
await page.screenshot({ path: 'test-results/local-final.png', fullPage: true });
await browser.close();
