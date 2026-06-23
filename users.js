// ============================================================
//  OneRule Venture — routes/users.js
//  GET    /api/users/:userId/profile        (public/owner)
//  PUT    /api/users/:userId/profile        (owner only)
//  POST   /api/users/:userId/avatar         (owner only)
//  DELETE /api/users/:userId/avatar         (owner only)
//  GET    /api/users/:userId/business       (public/owner)
//  PUT    /api/users/:userId/business       (owner only)
//  GET    /api/users/:userId/activity       (owner only)
//  DELETE /api/users/:userId                (owner/admin)
// ============================================================

'use strict';

const express = require('express');
const xss     = require('xss');
const router  = express.Router();

const db       = require('../config/db');
const { requireAuth, requireOwner } = require('../middleware/auth');
const { rules, validate }           = require('../middleware/validate');
const { upload, processAvatar, deleteOldAvatar } = require('../middleware/upload');

// ── Sanitise an object's string values ───────────────────────
function sanitizeStrings(obj) {
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k] = typeof v === 'string' ? xss(v.trim()) : v;
  }
  return result;
}

// ── Build SET clause for UPDATE dynamically ──────────────────
function buildUpdate(fields, allowed) {
  const setClauses = [];
  const values     = [];
  for (const field of allowed) {
    if (fields[field] !== undefined) {
      setClauses.push(`${field} = ?`);
      values.push(fields[field] === '' ? null : fields[field]);
    }
  }
  return { setClauses, values };
}

// ═══════════════════════════════════════════════════════════════
//  PROFILE ROUTES
// ═══════════════════════════════════════════════════════════════

// GET /api/users/:userId/profile
router.get('/:userId/profile', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const isOwner    = req.user?.id === userId;
    const isAdmin    = req.user?.role === 'admin';

    const profile = await db.get('SELECT * FROM profiles WHERE user_id = ?', [userId]);
    if (!profile) return res.status(404).json({ success: false, message: 'Profile not found.' });

    // If not public and not owner/admin — hide sensitive fields
    if (!profile.is_public && !isOwner && !isAdmin) {
      const { full_name, display_name, avatar_url, bio, city, state, country } = profile;
      return res.json({ success: true, data: { full_name, display_name, avatar_url, bio, city, state, country } });
    }

    // Include account metadata for owner
    if (isOwner || isAdmin) {
      const user = await db.get(
        'SELECT id, email, role, account_type, is_verified, is_active, last_login_at, login_count, created_at FROM users WHERE id = ?',
        [userId]
      );
      return res.json({ success: true, data: { ...profile, account: user } });
    }

    res.json({ success: true, data: profile });
  } catch (err) {
    console.error('[Users] Get profile error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch profile.' });
  }
});

// PUT /api/users/:userId/profile
router.put('/:userId/profile', requireAuth, requireOwner, rules.updateProfile, validate, async (req, res) => {
  try {
    const { userId } = req.params;
    const safe = sanitizeStrings(req.body);

    const ALLOWED = [
      'full_name','display_name','phone','bio',
      'city','state','country','pincode','date_of_birth','gender',
      'linkedin_url','twitter_url','instagram_url','facebook_url','website_url',
      'is_public',
    ];

    const { setClauses, values } = buildUpdate(safe, ALLOWED);
    if (setClauses.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid fields to update.' });
    }

    values.push(userId);
    await db.run(
      `UPDATE profiles SET ${setClauses.join(', ')} WHERE user_id = ?`,
      values
    );

    // Also update display name in any cache — sync full_name to users if needed
    if (safe.full_name) {
      // Update display_name if not separately set
      if (!safe.display_name) {
        await db.run('UPDATE profiles SET display_name = ? WHERE user_id = ? AND (display_name IS NULL OR display_name = ?)',
          [safe.full_name, userId, '']);
      }
    }

    const updated = await db.get('SELECT * FROM profiles WHERE user_id = ?', [userId]);
    res.json({ success: true, message: 'Profile updated.', data: updated });
  } catch (err) {
    console.error('[Users] Update profile error:', err);
    res.status(500).json({ success: false, message: 'Profile update failed.' });
  }
});

// POST /api/users/:userId/avatar
router.post('/:userId/avatar', requireAuth, requireOwner,
  upload.single('avatar'),
  async (req, res) => {
    try {
      const { userId } = req.params;
      if (!req.file) return res.status(400).json({ success: false, message: 'No image file provided.' });

      // Get old avatar to delete
      const profile = await db.get('SELECT avatar_url FROM profiles WHERE user_id = ?', [userId]);

      const avatarUrl = await processAvatar(req.file.buffer, userId);
      await db.run('UPDATE profiles SET avatar_url = ? WHERE user_id = ?', [avatarUrl, userId]);

      // Delete old file from disk (async, non-blocking)
      if (profile?.avatar_url) deleteOldAvatar(profile.avatar_url);

      res.json({ success: true, message: 'Avatar updated.', data: { avatar_url: avatarUrl } });
    } catch (err) {
      console.error('[Users] Avatar upload error:', err);
      const msg = err.message.includes('allowed') ? err.message : 'Avatar upload failed.';
      res.status(400).json({ success: false, message: msg });
    }
  }
);

// DELETE /api/users/:userId/avatar
router.delete('/:userId/avatar', requireAuth, requireOwner, async (req, res) => {
  try {
    const { userId } = req.params;
    const profile = await db.get('SELECT avatar_url FROM profiles WHERE user_id = ?', [userId]);
    if (profile?.avatar_url) deleteOldAvatar(profile.avatar_url);
    await db.run('UPDATE profiles SET avatar_url = NULL WHERE user_id = ?', [userId]);
    res.json({ success: true, message: 'Avatar removed.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to remove avatar.' });
  }
});

// ═══════════════════════════════════════════════════════════════
//  BUSINESS ROUTES
// ═══════════════════════════════════════════════════════════════

// GET /api/users/:userId/business
router.get('/:userId/business', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const isOwner    = req.user?.id === userId;
    const isAdmin    = req.user?.role === 'admin';

    const biz = await db.get('SELECT * FROM businesses WHERE user_id = ?', [userId]);
    if (!biz) return res.status(404).json({ success: false, message: 'Business not found.' });

    // Hide private info for non-owners
    if (!biz.is_public && !isOwner && !isAdmin) {
      const { business_name, category, description, tagline, logo_url, city, state, country } = biz;
      return res.json({ success: true, data: { business_name, category, description, tagline, logo_url, city, state, country } });
    }

    // Hide PAN/GSTIN from non-owners
    if (!isOwner && !isAdmin) {
      const { gstin, pan, ...safe } = biz;
      return res.json({ success: true, data: safe });
    }

    res.json({ success: true, data: biz });
  } catch (err) {
    console.error('[Users] Get business error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch business.' });
  }
});

// PUT /api/users/:userId/business
router.put('/:userId/business', requireAuth, requireOwner, rules.updateBusiness, validate, async (req, res) => {
  try {
    const { userId } = req.params;
    const safe = sanitizeStrings(req.body);

    // Auto-generate slug if business_name is being set
    if (safe.business_name && !safe.business_slug) {
      let slug = safe.business_name
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .slice(0, 60);

      // Ensure uniqueness
      const existing = await db.get(
        'SELECT id FROM businesses WHERE business_slug = ? AND user_id != ?',
        [slug, userId]
      );
      if (existing) slug = `${slug}-${Date.now().toString(36)}`;
      safe.business_slug = slug;
    }

    const ALLOWED = [
      'business_name','business_slug','category','sub_category','description','tagline',
      'founded_year','employee_count','annual_revenue','business_stage',
      'gstin','pan',
      'address_line1','address_line2','city','state','pincode','country',
      'phone','email','website',
      'linkedin_url','twitter_url','instagram_url',
      'is_public',
    ];

    const { setClauses, values } = buildUpdate(safe, ALLOWED);
    if (setClauses.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid fields to update.' });
    }

    values.push(userId);
    await db.run(
      `UPDATE businesses SET ${setClauses.join(', ')} WHERE user_id = ?`,
      values
    );

    const updated = await db.get('SELECT * FROM businesses WHERE user_id = ?', [userId]);
    res.json({ success: true, message: 'Business updated.', data: updated });
  } catch (err) {
    console.error('[Users] Update business error:', err);
    if (err.message?.includes('UNIQUE constraint failed: businesses.business_slug')) {
      return res.status(409).json({ success: false, message: 'Business name/slug already taken.' });
    }
    res.status(500).json({ success: false, message: 'Business update failed.' });
  }
});

// ═══════════════════════════════════════════════════════════════
//  ACCOUNT ACTIVITY
// ═══════════════════════════════════════════════════════════════

// GET /api/users/:userId/activity
router.get('/:userId/activity', requireAuth, requireOwner, async (req, res) => {
  try {
    const { userId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    const activity = await db.all(
      `SELECT id, ip_address, user_agent, status, created_at
       FROM login_activity WHERE user_id = ?
       ORDER BY created_at DESC LIMIT ?`,
      [userId, limit]
    );
    res.json({ success: true, data: activity });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch activity.' });
  }
});

// ═══════════════════════════════════════════════════════════════
//  DELETE ACCOUNT
// ═══════════════════════════════════════════════════════════════

// DELETE /api/users/:userId
router.delete('/:userId', requireAuth, requireOwner, async (req, res) => {
  try {
    const { userId }   = req.params;
    const { password } = req.body;
    if (!password) return res.status(400).json({ success: false, message: 'Password required to delete account.' });

    const user = await db.get('SELECT id, password_hash FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    const bcrypt = require('bcryptjs');
    const match  = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ success: false, message: 'Incorrect password.' });

    // Soft-delete: mark inactive rather than hard delete
    await db.run(
      'UPDATE users SET is_active = 0, email = ? WHERE id = ?',
      [`deleted_${Date.now()}@deleted.invalid`, userId]
    );
    const jwtUtil = require('../utils/jwt');
    await jwtUtil.revokeAllRefreshTokens(userId);
    jwtUtil.clearAuthCookies(res);

    res.json({ success: true, message: 'Account deactivated successfully.' });
  } catch (err) {
    console.error('[Users] Delete account error:', err);
    res.status(500).json({ success: false, message: 'Account deletion failed.' });
  }
});

module.exports = router;
