require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET is required');

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || '*' }));
app.use(express.json({ limit: '100kb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 300 }));
const strict = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

// ---------- helpers ----------
const wrap = (fn) => (req, res) =>
  fn(req, res).catch((e) => { console.error(e); res.status(500).json({ error: 'Server error' }); });

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

// PS/CSC/22/1234 -> PS/CSC/22/****  (keeps prefix, hides the last segment)
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

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  try {
    req.user = jwt.verify(h.replace('Bearer ', ''), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Login required' });
  }
}

// ---------- SMS alerts (Arkesel) ----------
function ghPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('233') && d.length === 12) return d;
  if (d.startsWith('0') && d.length === 10) return '233' + d.slice(1);
  return null;
}

async function sendSms(phones, message) {
  const key = process.env.ARKESEL_API_KEY;
  const recipients = [...new Set(phones.map(ghPhone).filter(Boolean))];
  if (!key || !recipients.length) return;
  const r = await fetch('https://sms.arkesel.com/api/v2/sms/send', {
    method: 'POST',
    headers: { 'api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sender: process.env.ARKESEL_SENDER || 'CampusFind', message, recipients }),
  });
  if (!r.ok) console.error('Arkesel error', r.status, await r.text());
}

const words = (s) => new Set(norm(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 3));

// When a FOUND item is posted, text people with open LOST reports that look similar.
// The SMS never includes item details, only a nudge to open the app.
async function notifyMatches(foundId) {
  const f = (await pool.query(
    'SELECT id, category, title, masked_identifier, posted_by FROM items WHERE id=$1', [foundId])).rows[0];
  if (!f) return;
  const lost = (await pool.query(
    `SELECT i.id, i.title, i.masked_identifier, u.phone
     FROM items i JOIN users u ON u.id = i.posted_by
     WHERE i.type='LOST' AND i.status='OPEN' AND i.category=$1 AND i.posted_by<>$2
       AND i.created_at > now() - interval '30 days'`, [f.category, f.posted_by])).rows;
  const fw = words(f.title);
  const hits = lost.filter((l) =>
    (f.masked_identifier && l.masked_identifier === f.masked_identifier) ||
    [...words(l.title)].some((w) => fw.has(w)));
  if (!hits.length) return;
  const url = process.env.APP_URL || '';
  await sendSms(hits.map((h) => h.phone),
    `Campus Find: a found item may match something you reported lost. Check it here: ${url}`);
}

// ---------- auth ----------
app.post('/api/auth/register', strict, wrap(async (req, res) => {
  const { full_name, student_email, phone, password } = req.body;
  if (!full_name || !student_email || !phone || !password || password.length < 8)
    return res.status(400).json({ error: 'All fields required; password min 8 chars' });
  const hash = await bcrypt.hash(password, 10);
  try {
    const r = await pool.query(
      `INSERT INTO users (full_name, student_email, phone, password_hash)
       VALUES ($1,$2,$3,$4) RETURNING id, full_name, role`,
      [full_name.trim(), norm(student_email), phone.trim(), hash]);
    const u = r.rows[0];
    res.json({ token: jwt.sign({ id: u.id, role: u.role }, JWT_SECRET, { expiresIn: '7d' }), user: u });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Email already registered' });
    throw e;
  }
}));

app.post('/api/auth/login', strict, wrap(async (req, res) => {
  const { student_email, password } = req.body;
  const r = await pool.query('SELECT * FROM users WHERE student_email=$1', [norm(student_email)]);
  const u = r.rows[0];
  if (!u || !(await bcrypt.compare(password || '', u.password_hash)))
    return res.status(401).json({ error: 'Wrong email or password' });
  res.json({
    token: jwt.sign({ id: u.id, role: u.role }, JWT_SECRET, { expiresIn: '7d' }),
    user: { id: u.id, full_name: u.full_name, role: u.role },
  });
}));

// ---------- items ----------
// Public feed: never exposes phone, raw identifier, or the answer.
app.get('/api/items', wrap(async (req, res) => {
  const { type, category, q } = req.query;
  const where = ["i.status <> 'RETURNED'"];
  const vals = [];
  if (type) { vals.push(type); where.push(`i.type=$${vals.length}`); }
  if (category) { vals.push(category); where.push(`i.category=$${vals.length}`); }
  if (q) { vals.push(`%${q}%`); where.push(`(i.title ILIKE $${vals.length} OR i.masked_identifier ILIKE $${vals.length} OR i.location ILIKE $${vals.length})`); }
  const r = await pool.query(
    `SELECT i.id, i.type, i.category, i.title, i.description, i.masked_identifier,
            i.location, i.handoff_zone, i.image_url, i.status, i.created_at,
            v.security_question
     FROM items i LEFT JOIN verifications v ON v.item_id = i.id
     WHERE ${where.join(' AND ')} ORDER BY i.created_at DESC LIMIT 100`, vals);
  res.json(r.rows);
}));

app.post('/api/items', auth, wrap(async (req, res) => {
  const { type, category, title, description, identifier, location, handoff_zone,
          image_url, security_question, security_answer } = req.body;
  if (!type || !category || !title || !location)
    return res.status(400).json({ error: 'type, category, title, location required' });
  const cloud = process.env.CLOUDINARY_CLOUD_NAME;
  if (image_url && !String(image_url).startsWith(`https://res.cloudinary.com/${cloud}/`))
    return res.status(400).json({ error: 'Invalid image URL' });
  if (type === 'FOUND' && (!security_question || !security_answer))
    return res.status(400).json({ error: 'Found items need a security question and answer' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO items (type, category, title, description, masked_identifier, location,
                          handoff_zone, image_url, posted_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [type, category, title, description || null, maskId(identifier), location,
       handoff_zone || null, image_url || null, req.user.id]);
    const id = ins.rows[0].id;
    if (security_question && security_answer) {
      await client.query(
        'INSERT INTO verifications (item_id, security_question, expected_answer_hash) VALUES ($1,$2,$3)',
        [id, security_question.trim(), await bcrypt.hash(norm(security_answer), 10)]);
    }
    await client.query('COMMIT');
    res.status(201).json({ id });
    if (type === 'FOUND') notifyMatches(id).catch((e) => console.error('notify failed', e));
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}));

// Claimant answers the finder's question.
app.post('/api/items/:id/claim', auth, strict, wrap(async (req, res) => {
  const r = await pool.query(
    `SELECT i.id, i.status, i.posted_by, v.expected_answer_hash
     FROM items i JOIN verifications v ON v.item_id=i.id WHERE i.id=$1`, [req.params.id]);
  const item = r.rows[0];
  if (!item) return res.status(404).json({ error: 'Item not found or not claimable' });
  if (item.posted_by === req.user.id) return res.status(400).json({ error: 'You posted this item' });
  if (item.status !== 'OPEN') return res.status(409).json({ error: 'Item already has a pending claim' });

  const matched = await bcrypt.compare(norm(req.body.answer), item.expected_answer_hash);
  await pool.query(
    'INSERT INTO claims (item_id, claimant_id, answer_matched, status) VALUES ($1,$2,$3,$4)',
    [item.id, req.user.id, matched, matched ? 'PENDING' : 'REJECTED']);
  if (!matched) return res.status(403).json({ error: 'Answer did not match' });
  await pool.query("UPDATE items SET status='CLAIM_PENDING' WHERE id=$1", [item.id]);
  res.json({ message: 'Answer matched. Waiting for the finder to approve.' });
}));

// Finder sees pending claims on own items.
app.get('/api/my/claims', auth, wrap(async (req, res) => {
  const r = await pool.query(
    `SELECT c.id, c.item_id, i.title, u.full_name AS claimant, c.created_at
     FROM claims c JOIN items i ON i.id=c.item_id JOIN users u ON u.id=c.claimant_id
     WHERE i.posted_by=$1 AND c.status='PENDING' AND c.answer_matched`, [req.user.id]);
  res.json(r.rows);
}));

app.patch('/api/claims/:id/approve', auth, wrap(async (req, res) => {
  const r = await pool.query(
    `UPDATE claims c SET status='APPROVED' FROM items i
     WHERE c.id=$1 AND i.id=c.item_id AND (i.posted_by=$2 OR $3='admin') AND c.status='PENDING'
     RETURNING c.item_id`, [req.params.id, req.user.id, req.user.role]);
  if (!r.rows[0]) return res.status(404).json({ error: 'Claim not found' });
  await pool.query("UPDATE items SET status='VERIFIED' WHERE id=$1", [r.rows[0].item_id]);
  res.json({ message: 'Approved' });
}));

app.patch('/api/claims/:id/reject', auth, wrap(async (req, res) => {
  const r = await pool.query(
    `UPDATE claims c SET status='REJECTED' FROM items i
     WHERE c.id=$1 AND i.id=c.item_id AND (i.posted_by=$2 OR $3='admin') AND c.status='PENDING'
     RETURNING c.item_id`, [req.params.id, req.user.id, req.user.role]);
  if (!r.rows[0]) return res.status(404).json({ error: 'Claim not found' });
  await pool.query("UPDATE items SET status='OPEN' WHERE id=$1", [r.rows[0].item_id]);
  res.json({ message: 'Rejected' });
}));

// Contact is revealed only to the approved claimant (or the finder).
app.get('/api/items/:id/contact', auth, wrap(async (req, res) => {
  const r = await pool.query(
    `SELECT u.full_name, u.phone, i.handoff_zone, i.posted_by
     FROM items i JOIN users u ON u.id=i.posted_by
     WHERE i.id=$1 AND i.status IN ('VERIFIED','RETURNED')`, [req.params.id]);
  const row = r.rows[0];
  if (!row) return res.status(403).json({ error: 'Not verified yet' });
  const ok = await pool.query(
    "SELECT 1 FROM claims WHERE item_id=$1 AND claimant_id=$2 AND status='APPROVED'",
    [req.params.id, req.user.id]);
  if (!ok.rows[0] && row.posted_by !== req.user.id) return res.status(403).json({ error: 'Not allowed' });
  res.json({ finder: row.full_name, phone: row.phone, handoff_zone: row.handoff_zone });
}));

app.patch('/api/items/:id/resolve', auth, wrap(async (req, res) => {
  const r = await pool.query(
    "UPDATE items SET status='RETURNED' WHERE id=$1 AND (posted_by=$2 OR $3='admin') RETURNING id",
    [req.params.id, req.user.id, req.user.role]);
  if (!r.rows[0]) return res.status(404).json({ error: 'Item not found' });
  res.json({ message: 'Marked as returned' });
}));

app.get('/health', (_, res) => res.send('ok'));
app.listen(process.env.PORT || 3000, () => console.log('API running'));
