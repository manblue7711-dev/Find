// Pure helpers and security rules, kept free of Express and the database so they can be unit-tested.
const crypto = require('crypto');

const MAX_ATTEMPTS = 3; // wrong answers allowed per item, per person, per 24 hours

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

// PS/CSC/22/1234 -> PS/CSC/22/****  (keeps the prefix, hides the last segment)
function maskId(id) {
  if (!id) return null;
  const s = String(id).trim();
  if (s.includes('/')) {
    const parts = s.split('/');
    parts[parts.length - 1] = '*'.repeat(Math.max(4, parts[parts.length - 1].length));
    return parts.join('/');
  }
  return s.length <= 4 ? '****' : s.slice(0, 2) + '*'.repeat(s.length - 4) + s.slice(-2);
}

// 024 123 4567, 0241234567 and +233 24 123 4567 all become 233241234567. Anything else is null.
function ghPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('233') && d.length === 12) return d;
  if (d.startsWith('0') && d.length === 10) return '233' + d.slice(1);
  return null;
}

// True when two accounts share a phone number (used to stop a finder claiming their own item
// from a second account).
function phonesCollide(rows) {
  return new Set(rows.map((u) => ghPhone(u.phone) || u.phone)).size < 2;
}

const attemptsLeft = (failed) => Math.max(0, MAX_ATTEMPTS - failed);
const isLocked = (failed) => failed >= MAX_ATTEMPTS;

// Who may close (mark returned) an item:
//  - admins (porters): any item
//  - the owner of a LOST report (they found it themselves)
//  - the approved claimant of a FOUND item, confirming they received it
// The finder can NOT mark their own found item as returned.
function canResolve({ role, item, userId, hasApprovedClaim }) {
  if (role === 'admin') return true;
  if (item.type === 'LOST') return item.posted_by === userId;
  return item.type === 'FOUND' && item.status === 'VERIFIED' && !!hasApprovedClaim && item.posted_by !== userId;
}

// Secrets derived from the server's keys. The derivations must never change, or existing
// hashes and encrypted answers would stop working.
function createSecrets(jwtSecret, dataKey) {
  const CODE_ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I
  function proofCode(itemId, userId, daysAgo = 0, now = Date.now()) {
    const day = new Date(now - daysAgo * 864e5).toISOString().slice(0, 10);
    const h = crypto.createHmac('sha256', jwtSecret).update(`${itemId}:${userId}:${day}`).digest();
    return Array.from(h.subarray(0, 4), (b) => CODE_ALPHA[b % CODE_ALPHA.length]).join('');
  }
  const idHash = (id) => crypto.createHmac('sha256', jwtSecret)
    .update(String(id || '').toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex');

  const ANSWER_KEY = crypto.createHash('sha256').update('answers:' + (dataKey || jwtSecret)).digest();
  function encAns(text) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', ANSWER_KEY, iv);
    const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
  }
  function decAns(b64) {
    const b = Buffer.from(b64, 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', ANSWER_KEY, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
  }
  return { proofCode, idHash, encAns, decAns };
}

module.exports = { MAX_ATTEMPTS, norm, maskId, ghPhone, phonesCollide, attemptsLeft, isLocked, canResolve, createSecrets };
