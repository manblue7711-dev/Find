// Starts the real server (no database needed) and checks the basics. Skipped when dependencies
// are not installed; in GitHub Actions they always are.
const test = require('node:test');
const assert = require('node:assert/strict');

let installed = true;
try { require.resolve('express'); } catch { installed = false; }

test('server smoke test', { skip: !installed && 'run npm install first' }, async (t) => {
  process.env.JWT_SECRET = 'smoke-test-secret-smoke-test-secret';
  process.env.DATABASE_URL = 'postgres://nobody:nothing@127.0.0.1:1/none';
  const { app } = require('../server');
  const srv = app.listen(0);
  t.after(() => srv.close());
  const base = `http://127.0.0.1:${srv.address().port}`;

  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);
  assert.equal(await health.text(), 'ok');
  assert.equal(health.headers.get('x-powered-by'), null, 'Express fingerprint should be hidden');
  assert.ok(health.headers.get('x-content-type-options'), 'security headers missing');

  // Every protected route must refuse a request with no login, without touching the database.
  const protectedRoutes = [
    ['GET', '/api/items'], ['POST', '/api/items'], ['POST', '/api/items/1/claim'], ['POST', '/api/items/1/found-it'],
    ['PATCH', '/api/items/1/resolve'], ['GET', '/api/items/1/contact'], ['GET', '/api/account'], ['DELETE', '/api/account'],
    ['GET', '/api/my/claims'], ['GET', '/api/admin/items'], ['GET', '/api/admin/stats'], ['DELETE', '/api/admin/items/1'],
  ];
  for (const [method, p] of protectedRoutes) {
    const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' });
    assert.equal(r.status, 401, `${method} ${p} should need a login`);
  }
});
