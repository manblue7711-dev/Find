// Fails the build if the app page, manifest or service worker is broken.
// Run from the repo root:  node scripts/check-frontend.js
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const web = path.join(__dirname, '..', 'web');
let failed = false;
const fail = (m) => { console.error('FAIL ' + m); failed = true; };

const html = fs.readFileSync(path.join(web, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
if (!scripts.length) fail('index.html has no inline script');
scripts.forEach((code, i) => { try { new vm.Script(code, { filename: `index.html#script${i}` }); } catch (e) { fail('index.html script: ' + e.message); } });
for (const id of ['app', 'bar', 'gate', 'sheet', 'toast']) if (!html.includes(`id="${id}"`)) fail(`index.html is missing #${id}`);
if (!html.includes('manifest.webmanifest')) fail('index.html does not link the manifest');

try {
  const m = JSON.parse(fs.readFileSync(path.join(web, 'manifest.webmanifest'), 'utf8'));
  for (const ic of m.icons || []) if (!fs.existsSync(path.join(web, ic.src))) fail('manifest icon missing: ' + ic.src);
  if (!m.name || !m.start_url || !(m.icons || []).length) fail('manifest needs name, start_url and icons');
} catch (e) { fail('manifest.webmanifest: ' + e.message); }

try { new vm.Script(fs.readFileSync(path.join(web, 'sw.js'), 'utf8'), { filename: 'sw.js' }); } catch (e) { fail('sw.js: ' + e.message); }

if (failed) process.exit(1);
console.log('Front-end checks passed');
