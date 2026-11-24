// Unit tests for the security rules. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { norm, maskId, ghPhone, phonesCollide, attemptsLeft, isLocked, canResolve, createSecrets } = require('../lib');

const secrets = createSecrets('unit-test-secret-unit-test-secret');

test('norm: trims, lower-cases and collapses spaces', () => {
  assert.equal(norm('  Navy   BLUE '), 'navy blue');
  assert.equal(norm(null), '');
});

test('maskId: hides the last segment of student IDs and the middle of other numbers', () => {
  assert.equal(maskId('PS/CSC/22/1234'), 'PS/CSC/22/****');
  assert.equal(maskId('PS/CSC/22/123456'), 'PS/CSC/22/******');
  assert.equal(maskId('GHA-123456789-0'), 'GH' + '*'.repeat(11) + '-0');
  assert.equal(maskId('1234'), '****');
  assert.equal(maskId(''), null);
  assert.ok(!maskId('PS/CSC/22/1234').includes('1234'));
});

test('ghPhone: accepts Ghana formats and rejects the rest', () => {
  assert.equal(ghPhone('024 123 4567'), '233241234567');
  assert.equal(ghPhone('0241234567'), '233241234567');
  assert.equal(ghPhone('+233 24 123 4567'), '233241234567');
  assert.equal(ghPhone('233241234567'), '233241234567');
  assert.equal(ghPhone('12345'), null);
  assert.equal(ghPhone(''), null);
});

test('phonesCollide: the same number written two ways counts as one person', () => {
  assert.equal(phonesCollide([{ phone: '0241234567' }, { phone: '+233 24 123 4567' }]), true);
  assert.equal(phonesCollide([{ phone: '0241234567' }, { phone: '0551112222' }]), false);
});

test('attempts: 3 wrong answers lock an item for that person', () => {
  assert.equal(attemptsLeft(0), 3);
  assert.equal(attemptsLeft(1), 2);
  assert.equal(attemptsLeft(3), 0);
  assert.equal(attemptsLeft(9), 0);
  assert.equal(isLocked(2), false);
  assert.equal(isLocked(3), true);
});

test('canResolve: a finder cannot mark their own found item as returned', () => {
  const found = { type: 'FOUND', posted_by: 10, status: 'VERIFIED' };
  assert.equal(canResolve({ role: 'student', item: found, userId: 10, hasApprovedClaim: false }), false, 'finder');
  assert.equal(canResolve({ role: 'student', item: found, userId: 10, hasApprovedClaim: true }), false, 'finder even with a claim row');
  assert.equal(canResolve({ role: 'student', item: found, userId: 11, hasApprovedClaim: false }), false, 'stranger');
  assert.equal(canResolve({ role: 'student', item: found, userId: 11, hasApprovedClaim: true }), true, 'approved owner');
  assert.equal(canResolve({ role: 'admin', item: found, userId: 99, hasApprovedClaim: false }), true, 'admin');
});

test('canResolve: a found item that is not yet verified cannot be closed by a claimant', () => {
  const open = { type: 'FOUND', posted_by: 10, status: 'OPEN' };
  assert.equal(canResolve({ role: 'student', item: open, userId: 11, hasApprovedClaim: true }), false);
});

test('canResolve: only the owner closes a lost report', () => {
  const lost = { type: 'LOST', posted_by: 20, status: 'OPEN' };
  assert.equal(canResolve({ role: 'student', item: lost, userId: 20, hasApprovedClaim: false }), true);
  assert.equal(canResolve({ role: 'student', item: lost, userId: 21, hasApprovedClaim: true }), false);
});

test('proofCode: 4 safe characters, stable for a person and item, different for others', () => {
  const now = Date.UTC(2026, 10, 23, 12);
  const c = secrets.proofCode(5, 7, 0, now);
  assert.match(c, /^[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(secrets.proofCode(5, 7, 0, now), c);
  assert.notEqual(secrets.proofCode(5, 8, 0, now), c);
  assert.notEqual(secrets.proofCode(6, 7, 0, now), c);
});

test('proofCode: yesterday\'s code is still accepted after midnight', () => {
  const day1 = Date.UTC(2026, 10, 23, 12);
  const day2 = Date.UTC(2026, 10, 24, 1);
  assert.equal(secrets.proofCode(5, 7, 1, day2), secrets.proofCode(5, 7, 0, day1));
  assert.notEqual(secrets.proofCode(5, 7, 0, day2), secrets.proofCode(5, 7, 0, day1));
});

test('idHash: ignores spaces, slashes and case, but not different numbers', () => {
  assert.equal(secrets.idHash('PS/CSC/22/1234'), secrets.idHash('ps csc 22 1234'));
  assert.notEqual(secrets.idHash('PS/CSC/22/1234'), secrets.idHash('PS/CSC/22/1235'));
  assert.match(secrets.idHash('x'), /^[0-9a-f]{64}$/);
  assert.notEqual(createSecrets('another-secret-another-secret').idHash('PS/CSC/22/1234'), secrets.idHash('PS/CSC/22/1234'));
});

test('encAns / decAns: round-trip, random each time, tamper-proof', () => {
  const a = secrets.encAns('Gold star sticker');
  const b = secrets.encAns('Gold star sticker');
  assert.notEqual(a, b);
  assert.ok(!Buffer.from(a, 'base64').toString('utf8').includes('star'));
  assert.equal(secrets.decAns(a), 'Gold star sticker');
  const t = Buffer.from(a, 'base64'); t[t.length - 1] ^= 1;
  assert.throws(() => secrets.decAns(t.toString('base64')));
  assert.throws(() => createSecrets('another-secret-another-secret').decAns(a));
});

test('encAns: DATA_KEY keeps answers readable if JWT_SECRET changes', () => {
  const x = createSecrets('first-secret-first-secret-1', 'stable-data-key');
  const y = createSecrets('second-secret-second-secret', 'stable-data-key');
  assert.equal(y.decAns(x.encAns('red strap')), 'red strap');
});
