import { test, expect } from '@playwright/test';
test('demo is labeled, bilingual, exportable and clearable', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Try a sample conversation' }).click();
  await expect(page.locator('#notice')).toContainText('microphone is off');
  await expect(page.locator('#count')).toHaveText('3 phrases', { timeout: 20000 });
  await expect(page.locator('#ja-caption')).toContainText('歩きながら');
  await expect(page.locator('#start')).toBeEnabled({ timeout: 5000 });
  const download = page.waitForEvent('download'); await page.locator('#download').click();
  expect((await download).suggestedFilename()).toMatch(/babelfish.*txt/);
  await page.locator('#clear').click(); await expect(page.locator('#count')).toHaveText('0 phrases');
  expect(errors).toEqual([]);
});
test('missing key has an actionable message, never a fake live session', async ({ page }) => {
  await page.route('/api/status', route => route.fulfill({ json: { configured: false } }));
  await page.goto('/'); await page.locator('#start').click();
  await expect(page.locator('#notice')).toContainText('OPENAI_API_KEY');
  await expect(page.locator('#status-text')).toHaveText('Ready when you are');
});
test('mobile controls and large captions fit the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await page.locator('#size').fill('80');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#demo').click();
  await expect(page.locator('#count')).toHaveText('1 phrase', { timeout: 8000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
});
test('mocked speech and translation update the actual live caption flow', async ({ page, context }) => {
  await context.grantPermissions(['microphone']);
  await page.route('/api/status', route => route.fulfill({ json: { configured: true } }));
  await page.route('/api/translate', async route => { await route.fulfill({ json: { en: 'See you tomorrow.', ja: 'また明日。', source: 'en' } }); });
  await page.routeWebSocket('**/api/listen', socket => {
    setTimeout(() => socket.send(JSON.stringify({ type: 'ready' })), 100);
    setTimeout(() => {
      socket.send(JSON.stringify({ type: 'partial', id: 'one', delta: 'See you tomorrow.' }));
      socket.send(JSON.stringify({ type: 'committed', id: 'one', previous: null }));
      socket.send(JSON.stringify({ type: 'final', id: 'one', text: 'See you tomorrow.' }));
    }, 400);
    let turn = 0;
    socket.onMessage(message => {
      if (typeof message !== 'string') return;
      const type = JSON.parse(message).type;
      if (type === 'commit' || type === 'finish') {
        const id = `tail-${++turn}`;
        socket.send(JSON.stringify({ type: 'committed', id, previous: 'one' }));
        if (type === 'finish') socket.send(JSON.stringify({ type: 'finishing' }));
        setTimeout(() => socket.send(JSON.stringify({ type: 'final', id, text: 'See you tomorrow.' })), 150);
      }
    });
  });
  await page.goto('/'); await page.locator('#start').click();
  await expect(page.locator('#status-text')).toContainText('Listening');
  await expect(page.locator('#ja-caption')).toHaveText('また明日。');
  await expect(page.locator('#en-state')).toHaveText('Original · complete');
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
  await page.locator('#start').click();
  await expect(page.locator('#status-text')).toHaveText('Session paused', { timeout: 3000 });
  await expect(page.locator('#notice')).not.toContainText('Stopped waiting');
});
test('live translations persist across deltas, resume after idle, and finals retry when busy', async ({ page, context }) => {
  await context.grantPermissions(['microphone']);
  await page.route('/api/status', route => route.fulfill({ json: { configured: true } }));
  let busyOnce = true;
  await page.route('/api/translate', async route => {
    const { text } = route.request().postDataJSON();
    await new Promise(r => setTimeout(r, 200));
    if (text.endsWith('!') && busyOnce) { busyOnce = false; return route.fulfill({ status: 429, json: { error: 'Translation is busy. Please retry this caption.' } }); }
    await route.fulfill({ json: { en: text, ja: `[${text}]`, source: 'en' } });
  });
  await page.routeWebSocket('**/api/listen', socket => {
    const at = (ms, event) => setTimeout(() => socket.send(JSON.stringify(event)), ms);
    at(100, { type: 'ready' });
    at(400, { type: 'partial', id: 'one', delta: 'See you' });            // translated at ~1.4 s
    at(1500, { type: 'partial', id: 'one', delta: ' tomorrow' });         // arrives mid-request → reschedule
    at(2800, { type: 'partial', id: 'one', delta: ', Tanaka' });          // after an idle gap
    at(5000, { type: 'final', id: 'one', text: 'See you tomorrow, Tanaka!' }); // first attempt gets 429
    let turn = 0;
    socket.onMessage(message => {
      if (typeof message !== 'string') return;
      const type = JSON.parse(message).type;
      if (type === 'commit' || type === 'finish') {
        const id = `tail-${++turn}`;
        socket.send(JSON.stringify({ type: 'committed', id, previous: 'one' }));
        if (type === 'finish') socket.send(JSON.stringify({ type: 'finishing' }));
        setTimeout(() => socket.send(JSON.stringify({ type: 'final', id, text: 'See you tomorrow, Tanaka!' })), 150);
      }
    });
  });
  await page.goto('/'); await page.locator('#start').click();
  await expect(page.locator('#ja-caption')).toHaveText('[See you]', { timeout: 3000 });
  // A new delta must not blank the translation while the next one is in flight.
  await expect(page.locator('#en-caption')).toHaveText('See you tomorrow');
  await expect(page.locator('#ja-caption')).toHaveText(/^\[See you/);
  // After an idle gap, new deltas still trigger live translation before the phrase ends.
  await expect(page.locator('#ja-caption')).toHaveText('[See you tomorrow, Tanaka]', { timeout: 4500 });
  await expect(page.locator('#en-state')).toHaveText('Original · live');
  // The final phrase recovers from a busy server without a manual retry.
  await expect(page.locator('#ja-caption')).toHaveText('[See you tomorrow, Tanaka!]', { timeout: 5000 });
  await expect(page.getByRole('button', { name: 'Retry translation' })).toHaveCount(0);
  await page.locator('#start').click();
  await expect(page.locator('#status-text')).toHaveText('Session paused', { timeout: 3000 });
});
test('fullscreen stage shows original above translation as a scrolling, dimming history, and exits', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/'); await page.locator('#fullscreen').click();
  const stage = page.locator('#stage');
  await expect(stage).toBeVisible();
  await expect(page.locator('#stage-original .hint')).toBeVisible();
  await page.locator('#stage-exit').click(); await expect(stage).toBeHidden();
  await page.locator('#demo').click(); await page.locator('#fullscreen').click();
  const original = page.locator('#stage-original'), translation = page.locator('#stage-translation');
  // Phrase 1 (English): original on top, Japanese translation below once final.
  await expect(original.locator('.stage-line').last()).toHaveText('Shall we take a little break and get some coffee?', { timeout: 10000 });
  await expect(translation.locator('.stage-line').last()).toHaveText('少し休憩して、コーヒーでも飲みませんか？');
  // Phrase 2 (Japanese) pushes phrase 1 up as the dimmed previous line in both halves.
  await expect(original.locator('.stage-line').last()).toContainText('いいですね', { timeout: 10000 });
  await expect(original.locator('.stage-line.previous')).toHaveText('Shall we take a little break and get some coffee?');
  await expect(translation.locator('.stage-line.previous')).toHaveText('少し休憩して、コーヒーでも飲みませんか？');
  await expect(page.locator('#stage-original-lang')).toHaveText('日本語');
  const box = async l => (await l.boundingBox()).y;
  expect(await box(original.locator('.stage-line').last())).toBeLessThan(await box(translation.locator('.stage-line').last()));
  await page.waitForTimeout(400); await page.screenshot({ path: 'test-results/stage-mid.png' });
  await expect(translation.locator('.stage-line').last()).toContainText('Sounds good', { timeout: 10000 });
  // Phrase 3 scrolls the history up: all three lines stay visible while there is room.
  await expect(original.locator('.stage-line').last()).toContainText('Perfect', { timeout: 10000 });
  await expect(translation.locator('.stage-line').last()).toContainText('いいですね。続きは', { timeout: 10000 });
  await page.waitForTimeout(900);
  await expect(original.locator('.stage-line')).toHaveCount(3);
  await expect(original.locator('.stage-line.older')).toHaveText('Shall we take a little break and get some coffee?');
  await expect(original.locator('.stage-line.previous')).toContainText('いいですね');
  await page.screenshot({ path: 'test-results/stage.png' });
  await page.keyboard.press('Escape'); await expect(stage).toBeHidden();
  expect(errors).toEqual([]);
});
