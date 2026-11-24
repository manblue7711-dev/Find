-- ALL database updates in one file. Safe to run on your existing database,
-- and safe to run more than once. Supabase -> SQL Editor -> New query -> paste -> Run.

-- Moderation (hide reported posts)
ALTER TABLE items ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS reports (
  id SERIAL PRIMARY KEY,
  item_id INT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  reporter_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (item_id, reporter_id)
);

-- Password reset codes
CREATE TABLE IF NOT EXISTS password_resets (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INT NOT NULL DEFAULT 0
);

-- Sign out of all devices
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 0;

-- SMS-verified sign-up
CREATE TABLE IF NOT EXISTS pending_registrations (
  student_email TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Lost-item proof (ID number check + proof photo)
ALTER TABLE items  ADD COLUMN IF NOT EXISTS identifier_hash TEXT;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS proof_url  TEXT;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS proof_code TEXT;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS id_matched BOOLEAN;

-- Make yourself an admin (replace the email, remove the leading dashes, run):
-- UPDATE users SET role='admin' WHERE student_email='you@school.edu.gh';

-- AI-written ownership questions for FOUND items (answers are stored encrypted)
CREATE TABLE IF NOT EXISTS item_questions (
  id SERIAL PRIMARY KEY,
  item_id INT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  position INT NOT NULL,
  question TEXT NOT NULL,
  answer_enc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS item_questions_item_idx ON item_questions(item_id);

-- "Share my number" requests after a claimant runs out of attempts
CREATE TABLE IF NOT EXISTS contact_requests (
  id SERIAL PRIMARY KEY,
  item_id INT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  requester_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','DISMISSED')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (item_id, requester_id)
);
