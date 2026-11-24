// Guards the delivery files: if someone breaks the Docker or CI setup, the tests fail.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('Dockerfile runs the API as a non-root user with a health check', () => {
  const d = read('server/Dockerfile');
  assert.match(d, /FROM node:/);
  assert.match(d, /USER node/);
  assert.match(d, /HEALTHCHECK/);
  assert.match(d, /CMD \["node", "server\.js"\]/);
});

test('docker-compose wires the database, API and web services', () => {
  const c = read('docker-compose.yml');
  for (const k of ['db:', 'api:', 'web:', 'JWT_SECRET', 'DATABASE_SSL', '01-schema.sql', '02-migration.sql']) assert.ok(c.includes(k), `compose is missing ${k}`);
});

test('the SQL files the database container loads exist', () => {
  for (const f of ['schema.sql', 'migration.sql']) assert.ok(fs.existsSync(path.join(root, f)), `${f} missing`);
});

test('CI runs the API tests and the front-end check', () => {
  const w = read('.github/workflows/ci.yml');
  assert.match(w, /npm test/);
  assert.match(w, /check-frontend\.js/);
});

test('.env.example lists every variable the API reads', () => {
  const env = read('.env.example');
  for (const k of ['JWT_SECRET', 'ANTHROPIC_API_KEY', 'ARKESEL_API_KEY', 'CLOUDINARY_CLOUD_NAME', 'REQUIRE_PHONE_VERIFY']) assert.ok(env.includes(k), `${k} missing from .env.example`);
});
