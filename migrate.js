// ============================================================
//  OneRule Venture — config/migrate.js
//  Runs the full database schema: tables, indexes, triggers.
//  Usage: node config/migrate.js
// ============================================================

'use strict';

require('dotenv').config();
const path   = require('path');
const fs     = require('fs');
const sqlite = require('sqlite3').verbose();

const DB_PATH = process.env.DB_PATH || './data/onerule.db';
const dir     = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new sqlite.Database(DB_PATH, err => {
  if (err) { console.error('DB connect error:', err.message); process.exit(1); }
  console.log('Connected to SQLite at', DB_PATH);
});

const schema = `
/* ── PRAGMA ── */
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;

/* ════════════════════════════════════════════════════════════
   TABLE: users
   Core account record. One row per registered user.
════════════════════════════════════════════════════════════ */
CREATE TABLE IF NOT EXISTS users (
  id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  email               TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash       TEXT NOT NULL,
  role                TEXT NOT NULL DEFAULT 'user'
                        CHECK(role IN ('user','admin','moderator')),
  account_type        TEXT NOT NULL DEFAULT 'budding_entrepreneur'
                        CHECK(account_type IN ('existing_owner','budding_entrepreneur')),
  is_verified         INTEGER NOT NULL DEFAULT 0,
  is_active           INTEGER NOT NULL DEFAULT 1,
  verify_token        TEXT,
  verify_token_exp    INTEGER,
  reset_token         TEXT,
  reset_token_exp     INTEGER,
  refresh_token       TEXT,
  last_login_at       INTEGER,
  last_login_ip       TEXT,
  login_count         INTEGER NOT NULL DEFAULT 0,
  failed_login_count  INTEGER NOT NULL DEFAULT 0,
  locked_until        INTEGER,
  created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at          INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_users_email         ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_reset_token   ON users(reset_token);
CREATE INDEX IF NOT EXISTS idx_users_verify_token  ON users(verify_token);
CREATE INDEX IF NOT EXISTS idx_users_is_active     ON users(is_active);

/* ════════════════════════════════════════════════════════════
   TABLE: profiles
   Personal & contact details. 1-to-1 with users.
════════════════════════════════════════════════════════════ */
CREATE TABLE IF NOT EXISTS profiles (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id         TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  full_name       TEXT,
  display_name    TEXT,
  phone           TEXT,
  avatar_url      TEXT,
  bio             TEXT,
  city            TEXT,
  state           TEXT,
  country         TEXT DEFAULT 'India',
  pincode         TEXT,
  date_of_birth   TEXT,
  gender          TEXT CHECK(gender IN ('male','female','other','prefer_not_to_say',NULL)),
  linkedin_url    TEXT,
  twitter_url     TEXT,
  instagram_url   TEXT,
  facebook_url    TEXT,
  website_url     TEXT,
  is_public       INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_profiles_user_id   ON profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_is_public ON profiles(is_public);

/* ════════════════════════════════════════════════════════════
   TABLE: businesses
   Business/company details. One user can have one business.
════════════════════════════════════════════════════════════ */
CREATE TABLE IF NOT EXISTS businesses (
  id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id           TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  business_name     TEXT,
  business_slug     TEXT UNIQUE,
  category          TEXT,
  sub_category      TEXT,
  description       TEXT,
  tagline           TEXT,
  logo_url          TEXT,
  founded_year      INTEGER,
  employee_count    TEXT CHECK(employee_count IN
                      ('1','2-10','11-50','51-200','200+',NULL)),
  annual_revenue    TEXT CHECK(annual_revenue IN
                      ('pre-revenue','<10L','10L-50L','50L-1Cr','1Cr-10Cr','10Cr+',NULL)),
  business_stage    TEXT CHECK(business_stage IN
                      ('idea','mvp','early','growth','scale','mature',NULL)),
  gstin             TEXT,
  pan               TEXT,
  address_line1     TEXT,
  address_line2     TEXT,
  city              TEXT,
  state             TEXT,
  pincode           TEXT,
  country           TEXT DEFAULT 'India',
  phone             TEXT,
  email             TEXT,
  website           TEXT,
  linkedin_url      TEXT,
  twitter_url       TEXT,
  instagram_url     TEXT,
  is_public         INTEGER NOT NULL DEFAULT 1,
  is_verified       INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at        INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_businesses_user_id  ON businesses(user_id);
CREATE INDEX IF NOT EXISTS idx_businesses_slug     ON businesses(business_slug);
CREATE INDEX IF NOT EXISTS idx_businesses_category ON businesses(category);

/* ════════════════════════════════════════════════════════════
   TABLE: sessions / login_activity
   Audit log of every login event.
════════════════════════════════════════════════════════════ */
CREATE TABLE IF NOT EXISTS login_activity (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip_address  TEXT,
  user_agent  TEXT,
  status      TEXT NOT NULL CHECK(status IN ('success','failed','locked')),
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_login_activity_user_id   ON login_activity(user_id);
CREATE INDEX IF NOT EXISTS idx_login_activity_created   ON login_activity(created_at);

/* ════════════════════════════════════════════════════════════
   TABLE: refresh_tokens
   Stored refresh tokens for token rotation.
════════════════════════════════════════════════════════════ */
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  revoked_at  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id    ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);

/* ════════════════════════════════════════════════════════════
   TRIGGERS — auto-update updated_at
════════════════════════════════════════════════════════════ */
CREATE TRIGGER IF NOT EXISTS trg_users_updated_at
  AFTER UPDATE ON users
  BEGIN UPDATE users SET updated_at = unixepoch() WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS trg_profiles_updated_at
  AFTER UPDATE ON profiles
  BEGIN UPDATE profiles SET updated_at = unixepoch() WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS trg_businesses_updated_at
  AFTER UPDATE ON businesses
  BEGIN UPDATE businesses SET updated_at = unixepoch() WHERE id = NEW.id; END;

/* ════════════════════════════════════════════════════════════
   TRIGGER — auto-create profile + business row on user insert
════════════════════════════════════════════════════════════ */
CREATE TRIGGER IF NOT EXISTS trg_create_profile_on_register
  AFTER INSERT ON users
  BEGIN
    INSERT OR IGNORE INTO profiles(user_id) VALUES (NEW.id);
    INSERT OR IGNORE INTO businesses(user_id) VALUES (NEW.id);
  END;
`;

db.serialize(() => {
  const statements = schema
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('/*') && !s.startsWith('--'));

  let ok = 0;
  const run = (stmts, i) => {
    if (i >= stmts.length) {
      console.log(`✅ Migration complete. ${ok} statements executed.`);
      db.close();
      return;
    }
    const stmt = stmts[i];
    if (!stmt) { run(stmts, i + 1); return; }
    db.run(stmt, err => {
      if (err && !err.message.includes('already exists')) {
        console.error(`❌ Error at statement ${i}:`, err.message, '\n', stmt.slice(0,80));
      } else {
        ok++;
      }
      run(stmts, i + 1);
    });
  };
  run(statements, 0);
});
