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
