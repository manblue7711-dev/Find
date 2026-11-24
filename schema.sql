CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  full_name TEXT NOT NULL,
  student_email TEXT UNIQUE NOT NULL,
  phone TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student','admin')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS items (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('LOST','FOUND')),
  category TEXT NOT NULL CHECK (category IN ('ID_CARD','PHONE','CARD','BAG','KEYS','OTHER')),
  title TEXT NOT NULL,
  description TEXT,
  masked_identifier TEXT,
  location TEXT NOT NULL,
  handoff_zone TEXT,
  image_url TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN','CLAIM_PENDING','VERIFIED','RETURNED')),
  posted_by INT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS items_feed_idx ON items (status, type, category);

CREATE TABLE IF NOT EXISTS verifications (
  id SERIAL PRIMARY KEY,
  item_id INT UNIQUE NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  security_question TEXT NOT NULL,
  expected_answer_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS claims (
  id SERIAL PRIMARY KEY,
  item_id INT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  claimant_id INT NOT NULL REFERENCES users(id),
  answer_matched BOOLEAN NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  created_at TIMESTAMPTZ DEFAULT now()
);
