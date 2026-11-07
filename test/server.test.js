import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { server } from '../server.js';
test('serves only public assets and rejects cross-origin API requests', async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  async function request(path, headers = {}) {
    return new Promise((resolve,reject) => {
      http.get({ host: '127.0.0.1', port, path, headers: { Host: 'localhost:3000', ...headers } }, res => {
        let body = ''; res.on('data', chunk => body += chunk); res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
      }).on('error', reject);
    });
  }
  try {
    const home = await request('/'); assert.equal(home.status, 200); assert.match(home.body, /Babelfish/);
    assert.match(home.headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.equal((await request('/.env')).status, 404);
    assert.equal((await request('/server.js')).status, 404);
    assert.equal((await request('/api/status', { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await request('/', { Host: 'evil.example' })).status, 403);
    assert.equal((await request('/api/status')).status, 200);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
