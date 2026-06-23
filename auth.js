// ============================================================
//  OneRule Venture — routes/auth.js
//  POST /api/auth/register
//  POST /api/auth/login
//  POST /api/auth/logout
//  POST /api/auth/refresh
//  GET  /api/auth/verify-email
//  POST /api/auth/forgot-password
//  POST /api/auth/reset-password
//  POST /api/auth/change-password
//  GET  /api/auth/me
// ============================================================

'use strict';

const express  = require('express');
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');
const xss      = require('xss');
const router   = express.Router();

const db      = require('../config/db');
const jwtUtil = require('../utils/jwt');
const email   = require('../utils/email');
const { requireAuth }           = require('../middleware/auth');
const { authLimiter, resetLimiter } = require('../middleware/rateLimit');
const { rules, validate }       = require('../middleware/validate');

const BCRYPT_ROUNDS       = parseInt(process.env.BCRYPT_ROUNDS)          || 12;
const RESET_EXPIRES_MIN   = parseInt(process.env.RESET_TOKEN_EXPIRES_MINUTES) || 15;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MIN   = 15;

// ── Helper: record login activity ─────────────────────────────
async function recordLogin(userId, req, status) {
  await db.run(
    'INSERT INTO login_activity (user_id, ip_address, user_agent, status) VALUES (?,?,?,?)',
    [userId, req.ip, req.headers['user-agent'] || '', status]
  );
}

// ── POST /api/auth/register ───────────────────────────────────
router.post('/register', authLimiter, rules.register, validate, async (req, res) => {
  try {
    const { email: rawEmail, password, full_name, account_type } = req.body;
    const userEmail  = rawEmail.toLowerCase().trim();
    const safeName   = xss(full_name.trim());

    // Check duplicate
    const existing = await db.get('SELECT id FROM users WHERE email = ?', [userEmail]);
    if (existing) {
      return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
    }

    const passwordHash  = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const verifyToken   = jwtUtil.generateSecureToken();
    const verifyTokenExp = Math.floor(Date.now() / 1000) + 24 * 60 * 60; // 24h

    await db.transaction(async (tx) => {
      await tx.run(
        `INSERT INTO users (email, password_hash, account_type, verify_token, verify_token_exp)
         VALUES (?,?,?,?,?)`,
        [userEmail, passwordHash, account_type, verifyToken, verifyTokenExp]
      );

      // Get the newly created user
      const newUser = await tx.get('SELECT id FROM users WHERE email = ?', [userEmail]);

      // Update profile with name (trigger already created the profile row)
      await tx.run(
        'UPDATE profiles SET full_name = ?, display_name = ? WHERE user_id = ?',
        [safeName, safeName, newUser.id]
      );
    });

    const user = await db.get('SELECT id, email, account_type FROM users WHERE email = ?', [userEmail]);

    // Send verification email (non-blocking)
    email.sendVerificationEmail(userEmail, { name: safeName, token: verifyToken })
      .catch(err => console.error('[Email] Verification send failed:', err.message));

    res.status(201).json({
      success: true,
      message: 'Account created. Please check your email to verify your account.',
      data: { userId: user.id },
    });
  } catch (err) {
    console.error('[Auth] Register error:', err);
    res.status(500).json({ success: false, message: 'Registration failed. Please try again.' });
  }
});

// ── GET /api/auth/verify-email ────────────────────────────────
router.get('/verify-email', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ success: false, message: 'Token missing.' });

    const user = await db.get(
      'SELECT id, email, verify_token_exp, is_verified FROM users WHERE verify_token = ?',
      [token]
    );

    if (!user) return res.status(400).json({ success: false, message: 'Invalid or expired verification link.' });
    if (user.is_verified) return res.redirect('/auth/login.html?verified=already');

    if (user.verify_token_exp < Math.floor(Date.now() / 1000)) {
      return res.status(400).json({ success: false, message: 'Verification link has expired. Please register again.' });
    }

    await db.run(
      'UPDATE users SET is_verified = 1, verify_token = NULL, verify_token_exp = NULL WHERE id = ?',
      [user.id]
    );

    const profile = await db.get('SELECT full_name FROM profiles WHERE user_id = ?', [user.id]);
    email.sendWelcomeEmail(user.email, { name: profile?.full_name || 'there' }).catch(() => {});

    res.redirect('/auth/login.html?verified=true');
  } catch (err) {
    console.error('[Auth] Verify email error:', err);
    res.status(500).json({ success: false, message: 'Verification failed.' });
  }
});

// ── POST /api/auth/login ──────────────────────────────────────
router.post('/login', authLimiter, rules.login, validate, async (req, res) => {
  try {
    const { email: rawEmail, password, remember_me } = req.body;
    const userEmail = rawEmail.toLowerCase().trim();

    const user = await db.get('SELECT * FROM users WHERE email = ?', [userEmail]);

    // Generic error for security (don't reveal if email exists)
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    // Check account lock
    if (user.locked_until && user.locked_until > Math.floor(Date.now() / 1000)) {
      const minutesLeft = Math.ceil((user.locked_until - Math.floor(Date.now() / 1000)) / 60);
      await recordLogin(user.id, req, 'locked');
      return res.status(423).json({
        success: false,
        message: `Account locked due to too many failed attempts. Try again in ${minutesLeft} minutes.`,
      });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      const failedCount = user.failed_login_count + 1;
      let lockedUntil   = null;
      if (failedCount >= MAX_FAILED_ATTEMPTS) {
        lockedUntil = Math.floor(Date.now() / 1000) + LOCK_DURATION_MIN * 60;
      }
      await db.run(
        'UPDATE users SET failed_login_count = ?, locked_until = ? WHERE id = ?',
        [failedCount, lockedUntil, user.id]
      );
      await recordLogin(user.id, req, 'failed');
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    if (!user.is_active) {
      return res.status(403).json({ success: false, message: 'This account has been disabled.' });
    }

    // Reset failed attempts, update last login
    await db.run(
      `UPDATE users SET failed_login_count = 0, locked_until = NULL,
       last_login_at = unixepoch(), last_login_ip = ?, login_count = login_count + 1
       WHERE id = ?`,
      [req.ip, user.id]
    );
    await recordLogin(user.id, req, 'success');

    // Issue tokens
    const accessToken = jwtUtil.signAccessToken(user);
    const { raw: refreshRaw, hash: refreshHash } = jwtUtil.signRefreshToken(user.id);
    await jwtUtil.storeRefreshToken(user.id, refreshHash);
    jwtUtil.setAuthCookies(res, accessToken, refreshRaw);

    const profile = await db.get(
      'SELECT full_name, display_name, avatar_url FROM profiles WHERE user_id = ?',
      [user.id]
    );

    res.json({
      success: true,
      message: 'Logged in successfully.',
      data: {
        token:   accessToken,
        refresh: refreshRaw,
        user: {
          id:           user.id,
          email:        user.email,
          role:         user.role,
          account_type: user.account_type,
          is_verified:  Boolean(user.is_verified),
          full_name:    profile?.full_name    || null,
          display_name: profile?.display_name || null,
          avatar_url:   profile?.avatar_url   || null,
        },
      },
    });
  } catch (err) {
    console.error('[Auth] Login error:', err);
    res.status(500).json({ success: false, message: 'Login failed. Please try again.' });
  }
});

// ── POST /api/auth/refresh ────────────────────────────────────
router.post('/refresh', async (req, res) => {
  try {
    const rawToken = req.cookies?.orv_refresh || req.body?.refresh_token;
    if (!rawToken) return res.status(401).json({ success: false, message: 'Refresh token missing.' });

    const { valid, record, hash } = await jwtUtil.validateRefreshToken(rawToken);
    if (!valid) return res.status(401).json({ success: false, message: 'Invalid or expired refresh token.', code: 'REFRESH_INVALID' });

    const user = await db.get(
      'SELECT id, email, role, is_active FROM users WHERE id = ?',
      [record.user_id]
    );
    if (!user || !user.is_active) return res.status(401).json({ success: false, message: 'Account not found.' });

    // Rotate refresh token
    const { raw: newRefreshRaw } = await jwtUtil.rotateRefreshToken(hash, user.id);
    const newAccessToken         = jwtUtil.signAccessToken(user);
    jwtUtil.setAuthCookies(res, newAccessToken, newRefreshRaw);

    res.json({
      success: true,
      data: { token: newAccessToken, refresh: newRefreshRaw },
    });
  } catch (err) {
    console.error('[Auth] Refresh error:', err);
    res.status(500).json({ success: false, message: 'Token refresh failed.' });
  }
});

// ── POST /api/auth/logout ─────────────────────────────────────
router.post('/logout', requireAuth, async (req, res) => {
  try {
    await jwtUtil.revokeAllRefreshTokens(req.user.id);
    jwtUtil.clearAuthCookies(res);
    res.json({ success: true, message: 'Logged out successfully.' });
  } catch (err) {
    console.error('[Auth] Logout error:', err);
    res.status(500).json({ success: false, message: 'Logout failed.' });
  }
});

// ── POST /api/auth/forgot-password ───────────────────────────
router.post('/forgot-password', resetLimiter, rules.forgotPassword, validate, async (req, res) => {
  // Always respond 200 to prevent email enumeration
  const genericResponse = { success: true, message: 'If that email is registered, a reset link has been sent.' };
  try {
    const userEmail = req.body.email.toLowerCase().trim();
    const user      = await db.get('SELECT id, email FROM users WHERE email = ? AND is_active = 1', [userEmail]);
    if (!user) return res.json(genericResponse);

    const token      = jwtUtil.generateSecureToken();
    const tokenHash  = crypto.createHash('sha256').update(token).digest('hex');
    const expireAt   = Math.floor(Date.now() / 1000) + RESET_EXPIRES_MIN * 60;

    await db.run(
      'UPDATE users SET reset_token = ?, reset_token_exp = ? WHERE id = ?',
      [tokenHash, expireAt, user.id]
    );

    const profile = await db.get('SELECT full_name FROM profiles WHERE user_id = ?', [user.id]);
    email.sendPasswordResetEmail(userEmail, { name: profile?.full_name || 'there', token })
      .catch(err => console.error('[Email] Reset send failed:', err.message));

    res.json(genericResponse);
  } catch (err) {
    console.error('[Auth] Forgot password error:', err);
    res.json(genericResponse); // still generic
  }
});

// ── POST /api/auth/reset-password ────────────────────────────
router.post('/reset-password', resetLimiter, rules.resetPassword, validate, async (req, res) => {
  try {
    const { token, password } = req.body;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const user = await db.get(
      'SELECT id, email, reset_token_exp FROM users WHERE reset_token = ? AND is_active = 1',
      [tokenHash]
    );

    if (!user) return res.status(400).json({ success: false, message: 'Invalid or expired reset link.' });
    if (user.reset_token_exp < Math.floor(Date.now() / 1000)) {
      await db.run('UPDATE users SET reset_token = NULL, reset_token_exp = NULL WHERE id = ?', [user.id]);
      return res.status(400).json({ success: false, message: 'Reset link has expired. Please request a new one.' });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await db.run(
      'UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_exp = NULL WHERE id = ?',
      [passwordHash, user.id]
    );
    await jwtUtil.revokeAllRefreshTokens(user.id);

    const profile = await db.get('SELECT full_name FROM profiles WHERE user_id = ?', [user.id]);
    email.sendPasswordChangedEmail(user.email, { name: profile?.full_name || 'there' }).catch(() => {});

    res.json({ success: true, message: 'Password reset successfully. You can now log in.' });
  } catch (err) {
    console.error('[Auth] Reset password error:', err);
    res.status(500).json({ success: false, message: 'Password reset failed.' });
  }
});

// ── POST /api/auth/change-password ───────────────────────────
router.post('/change-password', requireAuth, rules.changePassword, validate, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    const user = await db.get('SELECT id, email, password_hash FROM users WHERE id = ?', [req.user.id]);

    const match = await bcrypt.compare(current_password, user.password_hash);
    if (!match) return res.status(400).json({ success: false, message: 'Current password is incorrect.' });

    if (current_password === new_password) {
      return res.status(400).json({ success: false, message: 'New password must be different from current password.' });
    }

    const newHash = await bcrypt.hash(new_password, BCRYPT_ROUNDS);
    await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, user.id]);
    await jwtUtil.revokeAllRefreshTokens(user.id);

    const profile = await db.get('SELECT full_name FROM profiles WHERE user_id = ?', [user.id]);
    email.sendPasswordChangedEmail(user.email, { name: profile?.full_name || 'there' }).catch(() => {});

    jwtUtil.clearAuthCookies(res);
    res.json({ success: true, message: 'Password changed. Please log in again.' });
  } catch (err) {
    console.error('[Auth] Change password error:', err);
    res.status(500).json({ success: false, message: 'Password change failed.' });
  }
});

// ── GET /api/auth/me ──────────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await db.get(
      'SELECT id, email, role, account_type, is_verified, is_active, last_login_at, login_count, created_at FROM users WHERE id = ?',
      [req.user.id]
    );
    const profile  = await db.get('SELECT * FROM profiles  WHERE user_id = ?', [req.user.id]);
    const business = await db.get('SELECT * FROM businesses WHERE user_id = ?', [req.user.id]);

    res.json({ success: true, data: { user, profile, business } });
  } catch (err) {
    console.error('[Auth] Me error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch user data.' });
  }
});

module.exports = router;
