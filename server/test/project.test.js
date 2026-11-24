// Checks that the project files fit together: front-end script parses, install files are valid,
// SQL covers every table the server uses. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));

test('web/index.html: the script has no syntax errors', () => {
  const html = read('web/index.html');
  const js = html.split('<script>')[1].split('</script>')[0];
  assert.doesNotThrow(() => new vm.Script(js));
});

test('web/index.html: has the three settings to fill in', () => {
  const html = read('web/index.html');
  for (const k of ['API', 'CLOUD_NAME', 'UPLOAD_PRESET']) assert.match(html, new RegExp(`const ${k} = '`), k);
});

test('web/index.html: links the manifest and registers the service worker', () => {
  const html = read('web/index.html');
  assert.match(html, /manifest\.webmanifest/);
  assert.match(html, /serviceWorker\.register/);
});

test('web app manifest: valid, and its icons exist', () => {
  const m = JSON.parse(read('web/manifest.webmanifest'));
  assert.equal(m.display, 'standalone');
  assert.ok(m.icons.length >= 2);
  for (const i of m.icons) assert.ok(exists(`web/${i.src}`), `${i.src} is missing`);
});

test('web/sw.js: parses and never touches other origins', () => {
  const sw = read('web/sw.js');
  assert.doesNotThrow(() => new vm.Script(sw));
  assert.match(sw, /u\.origin !== location\.origin/);
});

test('SQL files create every table the server uses', { skip: !exists('schema.sql') || !exists('migration.sql') }, () => {
  const sql = (read('schema.sql') + read('migration.sql')).toLowerCase();
  const known = ['users', 'items', 'verifications', 'claims', 'reports', 'password_resets', 'pending_registrations', 'item_questions', 'contact_requests'];
  for (const t of known) assert.ok(sql.includes(`create table if not exists ${t}`), `${t} is not created in the SQL files`);
});

test('API.md documents every route in server.js', { skip: !exists('docs/API.md') }, () => {
  const docs = read('docs/API.md');
  const code = read('server/server.js');
  const routes = [...code.matchAll(/^app\.(get|post|patch|delete)\('([^']+)'/gm)].map((m) => `${m[1].toUpperCase()} ${m[2]}`);
  const missing = routes.filter((r) => !docs.includes('`' + r + '`'));
  assert.deepEqual(missing, [], 'Undocumented routes: ' + missing.join(', '));
});
