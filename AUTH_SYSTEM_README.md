# OneRule Venture — Authentication & Profile System

Complete production-ready user authentication, profile, and business management system added to your existing OneRule Venture website.

---

## 1. Where everything was added

Your original site was untouched. Everything new lives in two new folders:

```
OneRuleVenture/
├── index.html              ← (existing, unchanged)
├── about.html               ← (existing, unchanged)
├── pricing.html              ← (existing, unchanged)
├── ...other existing pages...
├── style.css                 ← (existing, unchanged)
├── script.js                  ← (existing, unchanged)
│
├── auth/                      ← NEW: frontend auth pages
│   ├── login.html
│   ├── register.html
│   ├── forgot-password.html
│   ├── reset-password.html
│   ├── profile.html           (the profile dashboard)
│   ├── auth.css               (shared styling for auth pages)
│   └── auth-api.js            (shared API client — talks to the backend)
│
└── server/                    ← NEW: backend API
    ├── index.js                (Express app entry point)
    ├── package.json
    ├── .env.example             (copy to .env and fill in)
    ├── .gitignore
    ├── config/
    │   ├── db.js                (SQLite connection + query helpers)
    │   └── migrate.js           (creates all database tables)
    ├── middleware/
    │   ├── auth.js              (JWT verification, role guards)
    │   ├── validate.js          (input validation rules)
    │   ├── rateLimit.js         (brute-force protection)
    │   └── upload.js            (avatar image processing)
    ├── routes/
    │   ├── auth.js               (/api/auth/* endpoints)
    │   └── users.js              (/api/users/* endpoints)
    ├── utils/
    │   ├── jwt.js                (token generation/verification)
    │   └── email.js              (password reset / verification emails)
    ├── data/                    (SQLite database file goes here — auto-created)
    └── uploads/avatars/          (uploaded profile photos go here)
```

**Why this structure:** your static frontend (HTML/CSS/JS) and the backend API are kept completely separate. The backend is a standalone Node.js server that can be deployed independently of your static site, and the `auth/` folder's pages talk to it purely over HTTP — nothing in your existing pages had to change architecturally.

### What you need to add to your *existing* pages

Your existing `index.html`, `dashboard.html`, etc. currently have:
```html
<a href="dashboard.html" class="btn btn-outline btn-sm">Login</a>
<a href="dashboard.html" class="nav-profile" aria-label="Profile"><i class="fas fa-user"></i></a>
```

Change these two links (in **all 9 existing HTML files**, in the navbar) to:
```html
<a href="auth/login.html" class="btn btn-outline btn-sm">Login</a>
<a href="auth/profile.html" class="nav-profile" aria-label="Profile"><i class="fas fa-user"></i></a>
```

This is the only edit needed in your existing files — everything else is additive. (If you'd like, ask me and I'll make this edit across all files for you automatically.)

---

## 2. Database schema

SQLite was used so you can run this with **zero external database setup** — it's a single file. The schema is relational and ready to port to PostgreSQL/MySQL later if you scale (see §7).

```
users                          profiles                       businesses
─────                          ────────                       ──────────
id (PK)                        id (PK)                        id (PK)
email (unique)                 user_id (FK → users.id)        user_id (FK → users.id)
password_hash                  full_name                      business_name
role                           display_name                   business_slug (unique)
account_type                   phone                          category, sub_category
is_verified                    avatar_url                     description, tagline
is_active                      bio                             logo_url
verify_token / exp             city, state, country, pincode  founded_year
reset_token / exp              date_of_birth, gender          employee_count
refresh_token                  linkedin/twitter/insta/fb/web  annual_revenue, business_stage
last_login_at/ip               is_public                      gstin, pan
login_count                    created_at / updated_at        address fields
failed_login_count                                            phone, email, website
locked_until                                                  social links
created_at / updated_at                                       is_public, is_verified
                                                                created_at / updated_at

login_activity                 refresh_tokens
───────────────                ──────────────
id (PK)                        id (PK)
user_id (FK)                   user_id (FK)
ip_address, user_agent         token_hash (unique, sha256)
status (success/failed/locked) expires_at
created_at                     revoked_at
```

**Relationships:** `profiles` and `businesses` are 1-to-1 with `users` (one row each, auto-created via a database trigger the moment a user registers). `login_activity` and `refresh_tokens` are 1-to-many.

**Indexes** are placed on every foreign key, every lookup field (email, tokens, slugs), and status/category filters — so queries stay fast as your user base grows.

**Data isolation:** every query in `routes/users.js` filters by `user_id`, and the `requireOwner` middleware blocks any request where the JWT's user ID doesn't match the `:userId` in the URL (unless the requester is an admin). Public fields are only exposed when `is_public = 1`.

---

## 3. Security features implemented

| Protection | How |
|---|---|
| **Password storage** | bcrypt with 12 salt rounds — plaintext passwords are never stored or logged |
| **SQL injection** | 100% parameterized queries (`?` placeholders) — no string concatenation anywhere |
| **XSS** | All free-text input sanitized server-side with the `xss` library before storage; CSP headers via Helmet |
| **Brute-force login** | Account locks for 15 minutes after 5 failed attempts; rate limiting (10 attempts/15 min) on auth routes |
| **JWT auth** | Short-lived access tokens (7d) + rotating refresh tokens (30d, hashed in DB, single-use rotation) |
| **CSRF-adjacent** | `httpOnly`, `sameSite` cookies; tokens also usable via `Authorization: Bearer` header for API clients |
| **Email enumeration** | `/forgot-password` always returns the same generic response whether or not the email exists |
| **Password reset** | Single-use, sha256-hashed token, expires in 15 minutes, invalidated after use |
| **Mass assignment** | Every PUT endpoint uses an explicit `ALLOWED` field whitelist — extra fields in the request body are silently ignored |
| **File upload** | MIME-type allowlist, 2MB size cap, re-encoded through Sharp (strips EXIF/malicious payloads), stored outside the public root with a random filename |
| **Rate limiting** | Global API limiter + stricter auth-specific limiter + very strict password-reset limiter |
| **Headers** | Helmet sets CSP, X-Frame-Options, X-Content-Type-Options, etc. |
| **CORS** | Explicit origin allowlist via `CLIENT_ORIGIN` env var — no wildcard `*` |
| **Account deletion** | Soft-delete (deactivation) by default, password-confirmed, rather than irreversible hard delete |

---

## 4. Setup instructions

### Prerequisites
- [Node.js](https://nodejs.org) v18 or higher
- npm (comes with Node.js)

### Step 1 — Install dependencies
```bash
cd OneRuleVenture/server
npm install
```

### Step 2 — Configure environment variables
```bash
cp .env.example .env
```
Open `.env` and set, at minimum:
```bash
# Generate two different secrets:
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```
Paste the output into `JWT_SECRET`, run it again for `JWT_REFRESH_SECRET`, and again for `COOKIE_SECRET`.

For email sending in development, you can leave the `EMAIL_*` fields as-is — emails will just be printed to your terminal instead of actually sent. For production, see §6.

### Step 3 — Run database migrations
```bash
npm run migrate
```
This creates `server/data/onerule.db` with all tables, indexes, and triggers. Safe to re-run — it won't duplicate tables.

### Step 4 — Start the server
```bash
npm run dev      # with auto-restart (nodemon)
# or
npm start        # plain node
```
You should see:
```
╔══════════════════════════════════════════════╗
║  ⚡ OneRule Venture API Server               ║
║  Env  : development
║  Port : 5000
╚══════════════════════════════════════════════╝
```

### Step 5 — Serve your frontend
Your HTML/CSS/JS files are static, so use any static server. Easiest: the VS Code **Live Server** extension, right-click `index.html` → "Open with Live Server" (defaults to port 5500, which matches `CLIENT_ORIGIN` in `.env.example`).

Or with Python:
```bash
cd OneRuleVenture
python3 -m http.server 5500
```

### Step 6 — Test it
1. Open `http://127.0.0.1:5500/auth/register.html`
2. Create an account
3. Check your terminal (server window) for the verification email — copy the link and open it in your browser
4. Log in at `http://127.0.0.1:5500/auth/login.html`
5. You'll land on `auth/profile.html` — your dashboard

---

## 5. API documentation

Base URL: `http://localhost:5000/api`

All authenticated routes accept the token either as an `httpOnly` cookie (set automatically on login) **or** an `Authorization: Bearer <token>` header.

### Auth endpoints

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | — | Create account. Body: `email, password, full_name, account_type` |
| GET  | `/auth/verify-email?token=` | — | Verify email from link sent on registration |
| POST | `/auth/login` | — | Body: `email, password, remember_me`. Returns JWT + sets cookies |
| POST | `/auth/refresh` | refresh cookie | Rotates and returns a new access token |
| POST | `/auth/logout` | required | Revokes refresh tokens, clears cookies |
| POST | `/auth/forgot-password` | — | Body: `email`. Always returns generic success message |
| POST | `/auth/reset-password` | — | Body: `token, password`. Sets new password |
| POST | `/auth/change-password` | required | Body: `current_password, new_password` |
| GET  | `/auth/me` | required | Returns current user + profile + business |

### User / Profile / Business endpoints

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET    | `/users/:userId/profile`  | required (public fields only if not owner) | Get profile |
| PUT    | `/users/:userId/profile`  | owner only | Update profile fields |
| POST   | `/users/:userId/avatar`   | owner only | Upload avatar (`multipart/form-data`, field name `avatar`) |
| DELETE | `/users/:userId/avatar`   | owner only | Remove avatar |
| GET    | `/users/:userId/business` | required (public fields only if not owner) | Get business info |
| PUT    | `/users/:userId/business` | owner only | Update business fields |
| GET    | `/users/:userId/activity` | owner only | Recent login activity log |
| DELETE | `/users/:userId`          | owner only | Soft-delete account (requires password in body) |

### Example requests

**Register:**
```bash
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "rajesh@example.com",
    "password": "SecurePass123!",
    "full_name": "Rajesh Kumar",
    "account_type": "existing_owner"
  }'
```

**Login:**
```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{ "email": "rajesh@example.com", "password": "SecurePass123!" }'
```

**Update profile (authenticated):**
```bash
curl -X PUT http://localhost:5000/api/users/<userId>/profile \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{ "bio": "Founder of a logistics startup", "city": "Mumbai" }'
```

### Response format
All endpoints return:
```json
{
  "success": true,
  "message": "Human-readable message",
  "data": { }
}
```
Validation failures return HTTP 422 with field-level errors:
```json
{
  "success": false,
  "message": "Validation failed.",
  "errors": { "email": "Valid email required." }
}
```

---

## 6. Production deployment guidance

### Database
SQLite works for moderate traffic, but for production at scale, swap to PostgreSQL:
- The schema in `config/migrate.js` is standard SQL — translate `unixepoch()` → `EXTRACT(EPOCH FROM NOW())`, and swap the `sqlite3` package for `pg`. The query helper interface in `config/db.js` (`.get`, `.all`, `.run`) was written so the rest of the codebase (routes, middleware) wouldn't need to change — just the implementation inside `db.js`.

### Hosting the backend
Recommended options (all have free/cheap tiers):
- **Railway.app** — easiest; connect your GitHub repo, set env vars in their dashboard, auto-deploys
- **Render.com** — similar, free tier available
- **A VPS (DigitalOcean/Hetzner)** — run with `pm2 start index.js --name onerule-api` behind Nginx as a reverse proxy with HTTPS via Let's Encrypt/Certbot

### Hosting the frontend
Your static files (`index.html`, `auth/*.html`, etc.) can go to:
- **Netlify** — drag-and-drop the whole `OneRuleVenture` folder (excluding `/server`) to [netlify.com/drop](https://netlify.com/drop)
- **Vercel** or **GitHub Pages** — similar static hosting

### Before going live — checklist
- [ ] Set `NODE_ENV=production` in your server's environment
- [ ] Generate fresh, unique secrets for `JWT_SECRET`, `JWT_REFRESH_SECRET`, `COOKIE_SECRET` (never reuse dev values)
- [ ] Set `CLIENT_ORIGIN` to your real frontend domain (e.g. `https://oneruleventure.in`)
- [ ] Set `APP_URL` to your real backend domain (e.g. `https://api.oneruleventure.in`)
- [ ] Configure real SMTP credentials (`EMAIL_*`) — recommended: SendGrid, Mailgun, AWS SES, or Brevo (all have free tiers)
- [ ] Update `API_BASE` in `auth/auth-api.js` from `http://localhost:5000/api` to your real API domain
- [ ] Put the backend behind HTTPS (required for secure cookies to work — `secure: true` is auto-enabled when `NODE_ENV=production`)
- [ ] Back up the `server/data/onerule.db` file regularly (or migrate to managed PostgreSQL)
- [ ] Consider a CDN for the `uploads/avatars` folder if you expect heavy traffic

### Environment variables summary for production
```bash
NODE_ENV=production
CLIENT_ORIGIN=https://oneruleventure.in
APP_URL=https://api.oneruleventure.in
JWT_SECRET=<64+ char random string, unique to prod>
JWT_REFRESH_SECRET=<different 64+ char random string>
COOKIE_SECRET=<another random string>
EMAIL_HOST=smtp.sendgrid.net
EMAIL_USER=apikey
EMAIL_PASS=<your sendgrid api key>
EMAIL_FROM="OneRule Venture <no-reply@oneruleventure.in>"
```

---

## 7. Scaling notes (when you outgrow SQLite)

The schema was designed relationally from day one specifically so this migration is mechanical, not a redesign:
1. Stand up a managed Postgres instance (Supabase, Neon, RDS, etc.)
2. Run the equivalent `CREATE TABLE` statements (swap SQLite-specific syntax: `lower(hex(randomblob(16)))` → `gen_random_uuid()`, `unixepoch()` → `extract(epoch from now())`)
3. Swap `sqlite3` for `pg` in `package.json` and rewrite `config/db.js`'s internals — the `.get/.all/.run/.transaction` interface stays identical, so **zero changes needed in any route or middleware file**
4. Add a connection pool (`pg.Pool`) instead of a single connection

---

## 8. Quick reference: file → purpose

| File | What it does |
|---|---|
| `server/index.js` | Starts the Express server, wires up security middleware and routes |
| `server/config/db.js` | Database connection + promise-based query helpers |
| `server/config/migrate.js` | Creates all tables/indexes/triggers — run once |
| `server/middleware/auth.js` | Verifies JWTs, enforces ownership and role checks |
| `server/middleware/validate.js` | Input validation rules for every form |
| `server/middleware/rateLimit.js` | Brute-force / spam protection |
| `server/middleware/upload.js` | Avatar image upload, resize, and storage |
| `server/routes/auth.js` | Register, login, logout, password reset, email verify |
| `server/routes/users.js` | Profile + business CRUD, avatar, activity log, account deletion |
| `server/utils/jwt.js` | Token signing, verification, refresh-token rotation |
| `server/utils/email.js` | Sends verification, password-reset, and welcome emails |
| `auth/login.html` | Login form |
| `auth/register.html` | Sign-up form with account-type selector and password strength meter |
| `auth/forgot-password.html` | Request a reset link |
| `auth/reset-password.html` | Set a new password from the emailed link |
| `auth/profile.html` | Full profile dashboard: edit profile, business info, security, privacy, activity log, delete account |
| `auth/auth-api.js` | Shared JS client used by every auth page to talk to the backend |
| `auth/auth.css` | Shared styling for login/register/forgot/reset pages |

---

## 9. Troubleshooting

**"Failed to fetch" / CORS errors in browser console**
→ Make sure the server is running (`npm run dev` in `/server`) and `CLIENT_ORIGIN` in `.env` matches the URL your frontend is actually served from (check the address bar).

**Emails aren't arriving**
→ In development, emails are printed to your server terminal, not actually sent — this is intentional so you don't need SMTP credentials to test. Look for the `📧 [DEV EMAIL]` block in your terminal and copy the link manually.

**"Invalid or expired verification link"**
→ Verification links expire after 24 hours; reset links after 15 minutes. Register or request a new link.

**Avatar upload fails**
→ Check the file is under 2MB and is JPEG/PNG/WebP/GIF. Confirm the `server/uploads/avatars` folder exists and is writable.

**Database errors on first run**
→ Make sure you ran `npm run migrate` before `npm run dev`/`npm start`.
