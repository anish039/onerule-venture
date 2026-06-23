// ============================================================
//  OneRule Venture — index.js  (Server Entry Point)
//  Express API server with security middleware
// ============================================================

'use strict';

require('dotenv').config();

const express      = require('express');
const helmet       = require('helmet');
const cors         = require('cors');
const compression  = require('compression');
const cookieParser = require('cookie-parser');
const morgan       = require('morgan');
const path         = require('path');

const { apiLimiter }  = require('./middleware/rateLimit');
const authRoutes       = require('./routes/auth');
const userRoutes       = require('./routes/users');

const app  = express();
const PORT = process.env.PORT || 5000;
const ENV  = process.env.NODE_ENV || 'development';
const IS_PROD = ENV === 'production';

// ── Security Headers (Helmet) ─────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", "'unsafe-inline'", 'cdnjs.cloudflare.com', 'fonts.googleapis.com'],
      styleSrc:    ["'self'", "'unsafe-inline'", 'fonts.googleapis.com', 'cdnjs.cloudflare.com'],
      fontSrc:     ["'self'", 'fonts.gstatic.com'],
      imgSrc:      ["'self'", 'data:', 'blob:'],
      connectSrc:  ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// ── CORS ──────────────────────────────────────────────────────
const allowedOrigins = [
  process.env.CLIENT_ORIGIN || 'http://127.0.0.1:5500',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  ...(IS_PROD ? [] : ['http://localhost:3000']),
];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: Origin ${origin} not allowed.`));
  },
  credentials: true,
  methods:      ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','X-Requested-With'],
}));

// ── Body Parsing ──────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser(process.env.COOKIE_SECRET));
app.use(compression());

// ── Logging ───────────────────────────────────────────────────
if (!IS_PROD) app.use(morgan('dev'));
else          app.use(morgan('combined'));

// ── Trust Proxy (needed behind Nginx / Heroku / Railway) ─────
if (IS_PROD) app.set('trust proxy', 1);

// ── Static: serve uploaded avatars ───────────────────────────
const uploadsDir = path.resolve(process.env.UPLOAD_DIR || './uploads/avatars');
app.use('/uploads/avatars', express.static(uploadsDir, {
  maxAge:    IS_PROD ? '7d' : 0,
  etag:      true,
  lastModified: true,
}));

// ── API Routes ────────────────────────────────────────────────
app.use('/api',         apiLimiter);
app.use('/api/auth',    authRoutes);
app.use('/api/users',   userRoutes);

// ── Health Check ──────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status:  'ok',
    version: '1.0.0',
    env:     ENV,
    time:    new Date().toISOString(),
  });
});

// ── 404 for unknown API routes ────────────────────────────────
app.use('/api/*', (req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} not found.` });
});

// ── Global Error Handler ──────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[Server Error]', err.stack || err.message);

  if (err.message?.startsWith('CORS')) {
    return res.status(403).json({ success: false, message: err.message });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ success: false, message: 'Request body too large.' });
  }
  res.status(err.status || 500).json({
    success: false,
    message: IS_PROD ? 'An unexpected error occurred.' : err.message,
  });
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║  ⚡ OneRule Venture API Server               ║
║  ──────────────────────────────────────────  ║
║  Env  : ${ENV.padEnd(35)} ║
║  Port : ${String(PORT).padEnd(35)} ║
╚══════════════════════════════════════════════╝
  `);
});

// ── Graceful Shutdown ─────────────────────────────────────────
process.on('SIGTERM', async () => {
  console.log('[Server] SIGTERM received — shutting down gracefully.');
  const db = require('./config/db');
  await db.close();
  process.exit(0);
});

module.exports = app;
