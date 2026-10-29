// server.js — EL DUNAMIS Medical Centre backend API
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Refuse to boot in production with insecure defaults. db.js seeds the first
// admin on startup, so this has to run BEFORE it is required.
if (process.env.NODE_ENV === 'production') {
  const missing = ['JWT_SECRET', 'ADMIN_PASS'].filter((k) => !process.env[k]);
  if (missing.length) {
    console.error('FATAL: ' + missing.join(' and ') + ' must be set when NODE_ENV=production. Refusing to start with insecure defaults.');
    process.exit(1);
  }
  if (process.env.JWT_SECRET.length < 32) {
    console.error('FATAL: JWT_SECRET must be at least 32 characters in production.');
    process.exit(1);
  }
}

const db = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'eldunamis-dev-secret-change-me';

// Trust the first proxy hop (Render/Railway/Heroku-style deployments) so
// req.ip reflects the real client IP rather than the proxy's — needed for
// the /api/chat rate limiter below to work per-visitor instead of globally.
app.set('trust proxy', 1);

// ── Uploads (Media Center images) ───────────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, '..', 'images', 'media-uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? ext : '.jpg';
      cb(null, `media-${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPG, PNG, WEBP, or GIF images are allowed.'));
  },
});

const uploadVideo = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const safeExt = ['.mp4', '.webm', '.ogg', '.mov'].includes(ext) ? ext : '.mp4';
      cb(null, `video-${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`);
    },
  }),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB
  fileFilter: (req, file, cb) => {
    if (/^video\/(mp4|webm|ogg|quicktime)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only MP4, WEBM, OGG, or MOV videos are allowed.'));
  },
});

// Résumés (CV applications). Stored under server/uploads — deliberately NOT
// one of the PUBLIC_DIRS served as static files, since a resume is personal
// data (full name, address, phone, work history, etc.). Applicants can only
// upload one; admins can only download one through the authenticated route
// below (/api/cvs/:id/resume), never via a public URL.
const RESUME_DIR = path.join(__dirname, 'uploads', 'resumes');
fs.mkdirSync(RESUME_DIR, { recursive: true });

const uploadResume = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, RESUME_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const safeExt = ['.pdf', '.doc', '.docx'].includes(ext) ? ext : '.pdf';
      cb(null, `resume-${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const okMime = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ].includes(file.mimetype);
    if (okMime) cb(null, true);
    else cb(new Error('Only PDF or Word (.doc, .docx) files are allowed.'));
  },
});

// The site and API are served from the same origin, so cross-origin access is
// off unless CORS_ORIGIN (comma-separated list) is set.
if (process.env.CORS_ORIGIN) {
  app.use(cors({ origin: process.env.CORS_ORIGIN.split(',').map((o) => o.trim()) }));
}

// Basic security headers + keep the admin portal out of search engines.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (req.path.startsWith('/admin')) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
});
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send('User-agent: *\nDisallow: /admin/\nDisallow: /api/\n');
});

// Generic per-IP rate limiter (in-memory; fine for a single server process).
function makeRateLimiter({ windowMs, max, message }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [ip, ts] of hits) {
      const fresh = ts.filter((t) => now - t < windowMs);
      if (fresh.length) hits.set(ip, fresh); else hits.delete(ip);
    }
  }, windowMs).unref();
  return (req, res, next) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const now = Date.now();
    const ts = (hits.get(ip) || []).filter((t) => now - t < windowMs);
    ts.push(now);
    hits.set(ip, ts);
    if (ts.length > max) return res.status(429).json({ message });
    next();
  };
}
// Admin login: 10 attempts / 15 min / IP — blocks password guessing.
const loginLimiter = makeRateLimiter({ windowMs: 15 * 60 * 1000, max: 10, message: 'Too many sign-in attempts. Please try again in 15 minutes.' });
// Public forms (appointments, messages, CVs, reviews, résumé upload): 20 / hour / IP — blocks spam floods.
const publicFormLimiter = makeRateLimiter({ windowMs: 60 * 60 * 1000, max: 20, message: 'Too many submissions from this connection. Please try again later.' });

app.use(express.json({ limit: '1mb' }));

// ── Static files ─────────────────────────────────────────────────────────────
// IMPORTANT: only the public-facing folders are served. The project root is
// deliberately NOT served as static — that would expose server.js, db.js,
// the live SQLite database (patient data + password hashes), package.json,
// etc. to anyone who guesses the URL. Only add a folder here if everything
// inside it is meant to be public.
const PUBLIC_DIRS = ['home', 'careers', 'media', 'leave-a-review', 'schedule-a-visit', 'admin', 'images', 'shared'];
PUBLIC_DIRS.forEach((dir) => {
  app.use('/' + dir, express.static(path.join(__dirname, '..', dir)));
});

// ── Startup security checks ─────────────────────────────────────────────────
if (!process.env.JWT_SECRET) {
  console.warn('⚠️  JWT_SECRET is not set — using an insecure built-in fallback. Set JWT_SECRET in your environment before deploying to production.');
}
if (!process.env.ADMIN_PASS) {
  console.warn('⚠️  ADMIN_PASS is not set — the admin account will be seeded with the default password "admin123". Set ADMIN_USER and ADMIN_PASS before deploying, or change the password immediately after first login.');
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const tokenFor = (admin) => jwt.sign({ id: admin.id, username: admin.username }, JWT_SECRET, { expiresIn: '12h' });

const publicAdmin = (a) => ({ id: a.id, username: a.username, name: a.name, role: a.role, initials: a.initials, status: a.status, mustChangePassword: !!a.must_change_password, hasRecoveryCode: !!a.recovery_code_hash });

// DB row → API object. Canonical camelCase keys, plus legacy aliases the admin UI
// also reads (dept/date/type/qual/avail/note...) so every page renders correctly.
const mappers = {
  appointment: (r) => ({
    id: r.id,
    patientName: r.patient_name,
    name: r.patient_name,
    phone: r.phone,
    email: r.email,
    department: r.department,
    dept: r.department,
    preferredDate: r.preferred_date,
    date: r.preferred_date,
    consultationType: r.consultation_type,
    type: r.consultation_type,
    symptoms: r.symptoms,
    notes: r.symptoms,
    status: r.status,
    createdAt: r.created_at,
  }),
  message: (r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    subject: r.subject,
    message: r.message,
    isRead: !!r.is_read,
    createdAt: r.created_at,
    date: r.created_at,
  }),
  cv: (r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    email: r.email,
    departmentOfInterest: r.department_of_interest,
    dept: r.department_of_interest,
    degree: r.degree,
    experienceYears: r.experience_years,
    experience: r.experience_years,
    coverNote: r.cover_note,
    note: r.cover_note,
    hasResume: !!r.resume_file,
    resumeFileName: r.resume_original_name || null,
    createdAt: r.created_at,
    date: r.created_at,
  }),
  feedback: (r) => ({
    id: r.id,
    name: r.name,
    rating: r.rating,
    comment: r.comment,
    dateOfVisit: r.date_of_visit,
    date: r.date_of_visit || r.created_at,
    contact: r.contact || null,
    wouldRecommend: r.would_recommend || null,
    createdAt: r.created_at,
    promotedTestimonialId: r.promoted_testimonial_id || null,
  }),
  doctor: (r) => ({
    id: r.id,
    name: r.name,
    specialty: r.specialty,
    department: r.department,
    dept: r.department,
    availability: r.availability,
    avail: r.availability,
    qualifications: r.qualifications,
    qual: r.qualifications,
    rating: r.rating,
    status: r.status,
    bio: r.bio,
    imageUrl: r.image_url,
    createdAt: r.created_at,
  }),
  staffMember: (r) => ({
    id: r.id,
    name: r.name,
    role: r.role,
    department: r.department,
    dept: r.department,
    photoUrl: r.photo_url,
    status: r.status,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
  }),
  department: (r) => ({
    id: r.id,
    name: r.name,
    icon: r.icon,
    description: r.description,
    count: r.count,
    unit: r.unit,
    status: r.status,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
  }),
  jobOpening: (r) => ({
    id: r.id,
    title: r.title,
    icon: r.icon,
    status: r.status,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
  }),
  testimonial: (r) => ({
    id: r.id,
    name: r.name,
    role: r.role,
    rating: r.rating,
    quote: r.quote,
    text: r.quote,
    status: r.status,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
  }),
  mediaItem: (r) => ({
    id: r.id,
    category: r.category,
    title: r.title,
    body: r.body,
    icon: r.icon,
    imageUrl: r.image_url,
    videoUrl: r.video_url,
    style: r.style,
    tag: r.tag,
    tagStyle: r.tag_style,
    dateLabel: r.date_label,
    duration: r.duration,
    status: r.status,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
  }),
};

const listParam = (req, fallback = 200) => {
  const n = parseInt(req.query.limit, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

// ── Auth middleware ─────────────────────────────────────────────────────────
// Routes an admin may still call while a forced password change is pending —
// just enough to change the password and sign out. Everything else in the
// portal (appointments, media, settings, etc.) is blocked until it's done,
// so the forced-change screen on the client can't be bypassed by calling the
// API directly.
const ALLOWED_WHILE_PASSWORD_CHANGE_PENDING = new Set(['/api/auth/change-password', '/api/auth/logout']);

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Authentication required.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const admin = db.prepare('SELECT id, username, must_change_password, status FROM admins WHERE id = ?').get(payload.id);
    if (!admin) return res.status(401).json({ message: 'Invalid or expired session. Please sign in again.' });
    if (admin.status === 'Disabled') return res.status(401).json({ message: 'This account has been disabled. Please contact a Super Admin.' });
    if (admin.must_change_password && !ALLOWED_WHILE_PASSWORD_CHANGE_PENDING.has(req.path)) {
      return res.status(403).json({ message: 'You must set a new password before continuing.', mustChangePassword: true });
    }
    req.admin = payload;
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired session. Please sign in again.' });
  }
}

// Non-rejecting check used by public list routes: is this request coming from
// a signed-in, enabled admin? Lets a public endpoint show admins extra rows
// (e.g. Draft testimonials) without forcing everyone else to authenticate.
function isAdminRequest(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return false;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const admin = db.prepare('SELECT status FROM admins WHERE id = ?').get(payload.id);
    return !!admin && admin.status !== 'Disabled';
  } catch {
    return false;
  }
}

// Only a Super Admin may view or manage other admin accounts. Must run after
// requireAuth (needs req.admin.id).
function requireSuperAdmin(req, res, next) {
  const admin = db.prepare('SELECT role FROM admins WHERE id = ?').get(req.admin.id);
  if (!admin || admin.role !== 'Super Admin') {
    return res.status(403).json({ message: 'Only a Super Admin can manage admin accounts.' });
  }
  next();
}

const notFound = (res, what) => res.status(404).json({ message: `${what} not found.` });

// ── AUTH ────────────────────────────────────────────────────────────────────
app.post('/api/auth/login', loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ message: 'Username and password are required.' });
  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(String(username).trim());
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ message: 'Invalid username or password.' });
  }
  if (admin.status === 'Disabled') {
    return res.status(403).json({ message: 'This account has been disabled. Contact a Super Admin.' });
  }
  res.json({ data: { token: tokenFor(admin), user: publicAdmin(admin) } });
});

app.put('/api/auth/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ message: 'Both passwords are required.' });
  if (String(newPassword).length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters.' });
  const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.admin.id);
  if (!admin) return notFound(res, 'Account');
  if (!bcrypt.compareSync(currentPassword, admin.password_hash)) {
    return res.status(400).json({ message: 'Current password is incorrect.' });
  }
  db.prepare('UPDATE admins SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), admin.id);
  res.json({ data: { message: 'Password updated.' } });
});

// ── ADMIN USER MANAGEMENT (Super Admin only) ────────────────────────────────
// Lets a Super Admin give each staff member their own login instead of
// everyone sharing one account, and manage those accounts afterward.
function initialsFor(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'AD';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// Random 10-character temp password (letters + digits). Shown to the Super
// Admin exactly once at creation/reset time; the account must change it on
// first sign-in (must_change_password = 1).
function randomTempPassword() {
  return crypto.randomBytes(12).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 10);
}

// A Super Admin may type the one-time password themselves (e.g. to tell a
// colleague in person) or leave it blank to have one generated. Either way
// the account is forced to change it on first sign-in. Returns
// { password } or { error }.
function resolveOneTimePassword(input) {
  if (input === undefined || input === null || String(input).trim() === '') {
    return { password: randomTempPassword() };
  }
  const pw = String(input);
  if (pw.length < 8) return { error: 'The one-time password must be at least 8 characters.' };
  if (Buffer.byteLength(pw, 'utf8') > 72) return { error: 'The one-time password is too long (72 characters max).' };
  return { password: pw };
}

// Reader-friendly recovery code (see db.js for the matching backfill logic
// that seeds one for the very first Super Admin). Used by "Forgot password?"
// on the login screen, since this app doesn't send email.
function randomRecoveryCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 12; i++) {
    if (i > 0 && i % 4 === 0) code += '-';
    code += chars[crypto.randomInt(chars.length)];
  }
  return code;
}

const publicAdminFull = (a) => ({
  id: a.id,
  username: a.username,
  name: a.name,
  role: a.role,
  initials: a.initials,
  status: a.status,
  mustChangePassword: !!a.must_change_password,
  hasRecoveryCode: !!a.recovery_code_hash,
  createdAt: a.created_at,
});

app.get('/api/admins', requireAuth, requireSuperAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM admins ORDER BY id ASC').all();
  res.json({ data: rows.map(publicAdminFull) });
});

app.post('/api/admins', requireAuth, requireSuperAdmin, (req, res) => {
  const { username, name, role, tempPassword: requestedTempPassword } = req.body || {};
  if (!username || !name) return res.status(400).json({ message: 'Username and full name are required.' });
  const cleanUsername = String(username).trim();
  if (cleanUsername.length < 3) return res.status(400).json({ message: 'Username must be at least 3 characters.' });
  const existing = db.prepare('SELECT id FROM admins WHERE username = ?').get(cleanUsername);
  if (existing) return res.status(409).json({ message: 'That username is already taken.' });
  const finalRole = role === 'Super Admin' ? 'Super Admin' : 'Admin';
  const resolved = resolveOneTimePassword(requestedTempPassword);
  if (resolved.error) return res.status(400).json({ message: resolved.error });
  const tempPassword = resolved.password;
  const hash = bcrypt.hashSync(tempPassword, 10);
  // A Super Admin needs a recovery code from day one — nobody else can reset
  // their password for them if they forget it later.
  const recoveryCode = finalRole === 'Super Admin' ? randomRecoveryCode() : null;
  const recoveryHash = recoveryCode ? bcrypt.hashSync(recoveryCode, 10) : null;
  const result = db.prepare(`
    INSERT INTO admins (username, password_hash, name, role, initials, must_change_password, status, recovery_code_hash)
    VALUES (?, ?, ?, ?, ?, 1, 'Active', ?)
  `).run(cleanUsername, hash, String(name).trim(), finalRole, initialsFor(name), recoveryHash);
  const row = db.prepare('SELECT * FROM admins WHERE id = ?').get(result.lastInsertRowid);
  // tempPassword/recoveryCode are returned once, here only — never stored or logged in plain text.
  res.status(201).json({ data: { ...publicAdminFull(row), tempPassword, recoveryCode } });
});

app.put('/api/admins/:id', requireAuth, requireSuperAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(id);
  if (!admin) return notFound(res, 'Admin');
  const { name, role, status } = req.body || {};
  const nextRole = role === 'Super Admin' || role === 'Admin' ? role : admin.role;
  const nextStatus = status === 'Disabled' || status === 'Active' ? status : admin.status;

  // Safety net: never leave the portal with zero active Super Admins.
  if (admin.role === 'Super Admin' && (nextRole !== 'Super Admin' || nextStatus !== 'Active')) {
    const otherActiveSuperAdmins = db.prepare(
      `SELECT COUNT(*) AS n FROM admins WHERE role = 'Super Admin' AND status = 'Active' AND id != ?`
    ).get(id).n;
    if (otherActiveSuperAdmins === 0) {
      return res.status(400).json({ message: 'At least one active Super Admin must remain.' });
    }
  }
  if (id === req.admin.id && nextStatus === 'Disabled') {
    return res.status(400).json({ message: "You can't disable your own account." });
  }

  db.prepare('UPDATE admins SET name = ?, role = ?, status = ? WHERE id = ?')
    .run(name ? String(name).trim() : admin.name, nextRole, nextStatus, id);

  // Promoted to Super Admin and has no recovery code yet (e.g. was created
  // as a plain Admin, or predates this feature) — give them one now so
  // "Forgot password?" works for them too. Returned once, here only.
  let recoveryCode = null;
  if (nextRole === 'Super Admin' && !admin.recovery_code_hash) {
    recoveryCode = randomRecoveryCode();
    db.prepare('UPDATE admins SET recovery_code_hash = ? WHERE id = ?').run(bcrypt.hashSync(recoveryCode, 10), id);
  }

  const row = db.prepare('SELECT * FROM admins WHERE id = ?').get(id);
  res.json({ data: { ...publicAdminFull(row), recoveryCode } });
});

app.put('/api/admins/:id/reset-password', requireAuth, requireSuperAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(id);
  if (!admin) return notFound(res, 'Admin');
  const resolved = resolveOneTimePassword((req.body || {}).tempPassword);
  if (resolved.error) return res.status(400).json({ message: resolved.error });
  const tempPassword = resolved.password;
  db.prepare('UPDATE admins SET password_hash = ?, must_change_password = 1 WHERE id = ?')
    .run(bcrypt.hashSync(tempPassword, 10), id);
  res.json({ data: { tempPassword } });
});

app.delete('/api/admins/:id', requireAuth, requireSuperAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === req.admin.id) return res.status(400).json({ message: "You can't delete your own account." });
  const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(id);
  if (!admin) return notFound(res, 'Admin');
  if (admin.role === 'Super Admin') {
    const otherActiveSuperAdmins = db.prepare(
      `SELECT COUNT(*) AS n FROM admins WHERE role = 'Super Admin' AND status = 'Active' AND id != ?`
    ).get(id).n;
    if (otherActiveSuperAdmins === 0) {
      return res.status(400).json({ message: 'At least one active Super Admin must remain.' });
    }
  }
  db.prepare('DELETE FROM admins WHERE id = ?').run(id);
  res.json({ data: { message: 'Admin removed.' } });
});

// Self-service: a Super Admin can view/regenerate their own recovery code
// any time while signed in (e.g. the original one was lost, or they just
// want a fresh one). Regenerating immediately invalidates the old code.
app.put('/api/admins/me/recovery-code', requireAuth, requireSuperAdmin, (req, res) => {
  const recoveryCode = randomRecoveryCode();
  db.prepare('UPDATE admins SET recovery_code_hash = ? WHERE id = ?')
    .run(bcrypt.hashSync(recoveryCode, 10), req.admin.id);
  res.json({ data: { recoveryCode } });
});

// ── "Forgot password?" (Super Admin only, via recovery code) ───────────────
// This app sends no email, so a lost Super Admin password is recovered with
// the one-time code shown at account creation (or last regenerated from
// Settings) instead of a reset link. Rate-limited per IP since it's public
// and unauthenticated, same pattern as the /api/chat limiter above.
const RECOVERY_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RECOVERY_RATE_LIMIT_MAX = 5; // attempts per IP per window
const recoveryRateLimitLog = new Map();

function recoveryRateLimited(ip) {
  const now = Date.now();
  const timestamps = (recoveryRateLimitLog.get(ip) || []).filter((t) => now - t < RECOVERY_RATE_LIMIT_WINDOW_MS);
  timestamps.push(now);
  recoveryRateLimitLog.set(ip, timestamps);
  return timestamps.length > RECOVERY_RATE_LIMIT_MAX;
}

app.post('/api/auth/reset-with-recovery-code', (req, res) => {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  if (recoveryRateLimited(ip)) {
    return res.status(429).json({ message: 'Too many attempts. Please try again later.' });
  }

  const { username, recoveryCode, newPassword } = req.body || {};
  if (!username || !recoveryCode || !newPassword) {
    return res.status(400).json({ message: 'Username, recovery code, and new password are all required.' });
  }
  if (String(newPassword).length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters.' });
  }

  // One generic error for every failure case below (unknown username, not a
  // Super Admin, disabled account, no code set, wrong code) — this avoids
  // telling a guesser which part they got right.
  const fail = () => res.status(400).json({ message: 'Invalid username or recovery code.' });

  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(String(username).trim());
  if (!admin || admin.role !== 'Super Admin' || admin.status !== 'Active' || !admin.recovery_code_hash) return fail();
  if (!bcrypt.compareSync(String(recoveryCode).trim(), admin.recovery_code_hash)) return fail();

  // The code is single-use: set the new password, then immediately rotate to
  // a fresh code (same idea as backup codes for 2FA) and hand it back once.
  const newRecoveryCode = randomRecoveryCode();
  db.prepare('UPDATE admins SET password_hash = ?, must_change_password = 0, recovery_code_hash = ? WHERE id = ?')
    .run(bcrypt.hashSync(newPassword, 10), bcrypt.hashSync(newRecoveryCode, 10), admin.id);

  res.json({ data: { message: 'Password reset. Please save your new recovery code.', recoveryCode: newRecoveryCode } });
});

// ── Generic CRUD factory ────────────────────────────────────────────────────
const apiToColumn = {
  appointment: { patientName:'patient_name', phone:'phone', email:'email', department:'department', preferredDate:'preferred_date', consultationType:'consultation_type', symptoms:'symptoms', status:'status' },
  message:     { name:'name', email:'email', subject:'subject', message:'message', isRead:'is_read' },
  cv:          { name:'name', phone:'phone', email:'email', departmentOfInterest:'department_of_interest', degree:'degree', experienceYears:'experience_years', coverNote:'cover_note', resumeFile:'resume_file', resumeOriginalName:'resume_original_name' },
  feedback:    { name:'name', rating:'rating', comment:'comment', dateOfVisit:'date_of_visit', contact:'contact', wouldRecommend:'would_recommend' },
  doctor:      { name:'name', specialty:'specialty', department:'department', availability:'availability', qualifications:'qualifications', rating:'rating', status:'status', bio:'bio', imageUrl:'image_url' },
  media:       { category:'category', title:'title', body:'body', icon:'icon', imageUrl:'image_url', videoUrl:'video_url', style:'style', tag:'tag', tagStyle:'tag_style', dateLabel:'date_label', duration:'duration', status:'status', sortOrder:'sort_order' },
  staff:       { name:'name', role:'role', department:'department', photoUrl:'photo_url', status:'status', sortOrder:'sort_order' },
  department:  { name:'name', icon:'icon', description:'description', count:'count', unit:'unit', status:'status', sortOrder:'sort_order' },
  opening:     { title:'title', icon:'icon', status:'status', sortOrder:'sort_order' },
  testimonial: { name:'name', role:'role', rating:'rating', quote:'quote', status:'status', sortOrder:'sort_order' },
};

function resource({ path, table, plural, mapper, required, defaults, allowedPatch, colMap, publicPost = false, publicGet = false, publicVisible, publicCreateFields = [], sanitizeCreate }) {
  const toCol = (k) => colMap[k] || k;
  // Which body keys a POST is allowed to use, ever: must be a real mapped
  // column (colMap), never an arbitrary attacker-supplied string — that
  // string used to be interpolated straight into the SQL column list.
  // For a public (unauthenticated) resource this is further narrowed to
  // `required` + `publicCreateFields`, so a visitor can only set the fields
  // their own form legitimately collects (e.g. not `status`, not `createdAt`,
  // nothing admin-only) — everything else is silently dropped, not erased or
  // errored on, since an unrecognized field is most often a stray extra the
  // client sent, not an attack, and failing loudly on it would just break
  // the form for real visitors.
  const colMapKeys = new Set(Object.keys(colMap));
  const publicSafeKeys = publicPost ? new Set([...required, ...publicCreateFields]) : colMapKeys;
  const sqlVal = (v) => (typeof v === 'boolean' ? (v ? 1 : 0) : (v ?? null));
  const getAll = db.prepare(`SELECT * FROM ${table} ORDER BY id DESC LIMIT ?`);

  const getMw = publicGet ? (req, res, next) => next() : requireAuth;
  const postMw = publicPost ? publicFormLimiter : requireAuth;

  // GET /api/<path>?limit=200  →  { <plural>: [...] }
  app.get(`/api/${path}`, getMw, (req, res) => {
    let rows = getAll.all(listParam(req));
    // Public callers only see rows the resource marks as publicly visible
    // (e.g. Published testimonials); signed-in admins see everything.
    if (publicGet && publicVisible && !isAdminRequest(req)) rows = rows.filter(publicVisible);
    res.json({ data: { [plural]: rows.map(mapper) } });
  });

  // POST /api/<path>  →  created row
  app.post(`/api/${path}`, postMw, (req, res) => {
    const body = req.body || {};
    for (const key of required) {
      const val = body[key];
      if (val === undefined || val === null || String(val).trim() === '') {
        return res.status(400).json({ message: `${key} is required.` });
      }
    }
    const safeBody = {};
    for (const k of Object.keys(body)) {
      if (colMapKeys.has(k) && publicSafeKeys.has(k)) safeBody[k] = body[k];
    }
    // Per-resource tidy-up of what a visitor typed (trim, length caps, allowed values).
    if (sanitizeCreate) sanitizeCreate(safeBody);
    const values = { ...defaults, ...safeBody };
    const apiKeys = Object.keys(values);
    const cols = apiKeys.map(toCol);
    const placeholders = cols.map(() => '?').join(', ');
    const stmt = db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`);
    const result = stmt.run(...apiKeys.map((k) => sqlVal(values[k])));
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(result.lastInsertRowid);
    res.status(201).json({ data: mapper(row) });
  });

  // PUT /api/<path>/:id  →  partially update, return updated row
  app.put(`/api/${path}/:id`, requireAuth, async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      const body = req.body || {};
      const fields = Object.keys(body).filter((k) => allowedPatch.includes(k));
      if (fields.length === 0) return res.status(400).json({ message: 'Nothing to update.' });
      const before = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
      if (!before) return notFound(res, table.slice(0, -1).replace(/_/g, ' '));
      const sets = fields.map((f) => `${toCol(f)} = ?`).join(', ');
      db.prepare(`UPDATE ${table} SET ${sets} WHERE id = ?`).run(...fields.map((f) => sqlVal(body[f])), id);
      const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
      res.json({ data: mapper(row) });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/<path>/:id
  app.delete(`/api/${path}/:id`, requireAuth, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const result = db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    if (result.changes === 0) return notFound(res, table.slice(0, -1).replace(/_/g, ' '));
    res.json({ data: { id, deleted: true } });
  });
}

// ── Appointments ────────────────────────────────────────────────────────────
resource({
  path: 'appointments',
  table: 'appointments',
  plural: 'appointments',
  mapper: mappers.appointment,
  required: ['patientName', 'phone', 'department'],
  defaults: { status: 'Pending', consultationType: 'In-Person' },
  colMap: apiToColumn.appointment,
  publicPost: true,
  publicCreateFields: ['email', 'preferredDate', 'consultationType', 'symptoms'],
  allowedPatch: ['status', 'patientName', 'phone', 'email', 'department', 'preferredDate', 'consultationType', 'symptoms'],
});

// ── Messages ────────────────────────────────────────────────────────────────
resource({
  path: 'messages',
  table: 'messages',
  plural: 'messages',
  mapper: mappers.message,
  required: ['name', 'message'],
  defaults: { subject: 'General Inquiry', email: null, is_read: 0 },
  colMap: apiToColumn.message,
  publicPost: true,
  publicCreateFields: ['email', 'subject'],
  allowedPatch: ['isRead'],
});

// ── CV applications ─────────────────────────────────────────────────────────
resource({
  path: 'cvs',
  table: 'cvs',
  plural: 'cvs',
  mapper: mappers.cv,
  required: ['name'],
  defaults: { experienceYears: 0, phone: null, email: null },
  colMap: apiToColumn.cv,
  publicPost: true,
  publicCreateFields: ['phone','email','departmentOfInterest','degree','experienceYears','coverNote','resumeFile','resumeOriginalName'],
  allowedPatch: [],
});

// Resume upload for a CV application. Public (applicants aren't logged in),
// so it gets its own tight limits (5MB, PDF/Word only — see uploadResume
// above) rather than requireAuth. Returns a reference to attach to the
// /api/cvs POST body as resumeFile/resumeOriginalName; it does NOT return a
// public URL, since the file lives outside the static-served folders and can
// only be fetched back via the authenticated route below.
app.post('/api/cvs/upload-resume', publicFormLimiter, (req, res) => {
  uploadResume.single('resume')(req, res, (err) => {
    if (err) return res.status(400).json({ message: err.message || 'Upload failed.' });
    if (!req.file) return res.status(400).json({ message: 'No resume file received.' });
    res.status(201).json({
      data: {
        resumeFile: req.file.filename,
        resumeOriginalName: req.file.originalname,
      },
    });
  });
});

// Admin-only resume download. Streams the file with its original filename
// rather than exposing a public URL, since a resume contains personal data.
app.get('/api/cvs/:id/resume', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const cv = db.prepare('SELECT resume_file, resume_original_name, name FROM cvs WHERE id = ?').get(id);
  if (!cv) return notFound(res, 'CV application');
  if (!cv.resume_file) return res.status(404).json({ message: 'No resume was attached to this application.' });
  const filePath = path.join(RESUME_DIR, cv.resume_file);
  if (!fs.existsSync(filePath)) return res.status(404).json({ message: 'Resume file is missing on the server.' });
  const downloadName = cv.resume_original_name || `${cv.name || 'resume'}${path.extname(cv.resume_file)}`;
  res.download(filePath, downloadName);
});

// ── Feedbacks ───────────────────────────────────────────────────────────────
resource({
  path: 'feedbacks',
  table: 'feedbacks',
  plural: 'feedbacks',
  mapper: mappers.feedback,
  required: ['name', 'rating', 'comment'],
  defaults: { dateOfVisit: null },
  colMap: apiToColumn.feedback,
  publicPost: true,
  publicCreateFields: ['dateOfVisit', 'contact', 'wouldRecommend'],
  sanitizeCreate: (body) => {
    // Phone/email is free text and optional: trim it, cap it, drop it if blank.
    if (body.contact !== undefined) {
      const c = String(body.contact).trim().slice(0, 150);
      if (c) body.contact = c; else delete body.contact;
    }
    // Only the three answers the form offers are meaningful; ignore anything else.
    if (body.wouldRecommend !== undefined && !['yes', 'maybe', 'no'].includes(body.wouldRecommend)) {
      delete body.wouldRecommend;
    }
  },
  allowedPatch: [],
});

// Promote a patient's submitted feedback straight into the public
// testimonials list, instead of an admin retyping it by hand. Optional
// `role` in the body lets the admin add context (e.g. "Patient's family ·
// Lagos") the original feedback form never asked for; it defaults to
// "Patient". The new testimonial starts as a Draft so an admin can glance
// it over before it goes live on the homepage.
app.post('/api/feedbacks/:id/promote', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const feedback = db.prepare('SELECT * FROM feedbacks WHERE id = ?').get(id);
  if (!feedback) return notFound(res, 'Feedback');
  if (!feedback.comment || !feedback.comment.trim()) {
    return res.status(400).json({ message: 'This feedback has no comment to promote.' });
  }
  const { role } = req.body || {};
  const result = db.prepare(`
    INSERT INTO testimonials (name, role, rating, quote, status, sort_order)
    VALUES (?, ?, ?, ?, 'Draft', 0)
  `).run(feedback.name || 'Patient', (role && String(role).trim()) || 'Patient', feedback.rating || 5, feedback.comment.trim());
  db.prepare('UPDATE feedbacks SET promoted_testimonial_id = ? WHERE id = ?').run(result.lastInsertRowid, id);
  const testimonialRow = db.prepare('SELECT * FROM testimonials WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({
    data: {
      testimonial: mappers.testimonial(testimonialRow),
      feedbackId: id,
      promotedTestimonialId: result.lastInsertRowid,
    },
  });
});

// ── Doctors ─────────────────────────────────────────────────────────────────
resource({
  path: 'doctors',
  table: 'doctors',
  plural: 'doctors',
  mapper: mappers.doctor,
  required: ['name', 'specialty', 'department'],
  defaults: { status: 'Active', rating: null, bio: '', availability: 'Mon-Fri', qualifications: 'See profile', imageUrl: null },
  colMap: apiToColumn.doctor,
  publicGet: true,
  allowedPatch: ['status', 'name', 'specialty', 'department', 'availability', 'qualifications', 'rating', 'bio', 'imageUrl'],
});

// ── Staff (Management / Nursing / Clinical Support) ─────────────────────────
resource({
  path: 'staff',
  table: 'staff',
  plural: 'staff',
  mapper: mappers.staffMember,
  required: ['name', 'role', 'department'],
  defaults: { status: 'Active', sortOrder: 0, photoUrl: null },
  colMap: apiToColumn.staff,
  publicGet: true,
  allowedPatch: ['status', 'name', 'role', 'department', 'photoUrl', 'sortOrder'],
});

// ── Departments (Clinical Divisions shown on the homepage) ─────────────────
resource({
  path: 'departments',
  table: 'departments',
  plural: 'departments',
  mapper: mappers.department,
  required: ['name'],
  defaults: { icon: '🏥', description: '', count: 0, unit: 'Specialists', status: 'Active', sortOrder: 0 },
  colMap: apiToColumn.department,
  publicGet: true,
  allowedPatch: ['name', 'icon', 'description', 'count', 'unit', 'status', 'sortOrder'],
});

// ── Job Openings (Careers page "Current Openings" list) ────────────────────
resource({
  path: 'openings',
  table: 'job_openings',
  plural: 'openings',
  mapper: mappers.jobOpening,
  required: ['title'],
  defaults: { icon: '💼', status: 'Open', sortOrder: 0 },
  colMap: apiToColumn.opening,
  publicGet: true,
  allowedPatch: ['title', 'icon', 'status', 'sortOrder'],
});

// ── Testimonials (Featured reviews shown on the homepage) ──────────────────
resource({
  path: 'testimonials',
  table: 'testimonials',
  plural: 'testimonials',
  mapper: mappers.testimonial,
  required: ['name', 'quote'],
  defaults: { role: '', rating: 5, status: 'Published', sortOrder: 0 },
  colMap: apiToColumn.testimonial,
  publicGet: true,
  publicVisible: (r) => r.status === 'Published', // Drafts stay admin-only
  allowedPatch: ['name', 'role', 'rating', 'quote', 'status', 'sortOrder'],
});

// ── Site settings: homepage "Overall Rating" (leave-a-review sidebar) ──────
const RATING_KEYS = ['score', 'countLabel', 'pct5', 'pct4', 'pct3', 'pct2', 'pct1'];
const RATING_DEFAULTS = { score: '4.9', countLabel: 'Based on 340+ patient reviews', pct5: '82', pct4: '12', pct3: '4', pct2: '1', pct1: '1' };

function readRatingSettings() {
  const rows = db.prepare(`SELECT key, value FROM site_settings WHERE key LIKE 'rating_%'`).all();
  const map = {};
  rows.forEach((r) => { map[r.key.replace('rating_', '')] = r.value; });
  const data = {};
  RATING_KEYS.forEach((k) => { data[k] = map[k] ?? RATING_DEFAULTS[k]; });
  return data;
}

app.get('/api/settings/rating', (req, res) => {
  res.json({ data: readRatingSettings() });
});

app.put('/api/settings/rating', requireAuth, (req, res) => {
  const body = req.body || {};
  const upsert = db.prepare(`INSERT INTO site_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
  RATING_KEYS.forEach((k) => {
    if (body[k] !== undefined && String(body[k]).trim() !== '') upsert.run('rating_' + k, String(body[k]).trim());
  });
  res.json({ data: readRatingSettings() });
});

// ── Media items (News / Announcements / Gallery / Videos) ─────────────────
resource({
  path: 'media',
  table: 'media_items',
  plural: 'items',
  mapper: mappers.mediaItem,
  required: ['category', 'title'],
  defaults: { body: '', icon: '', imageUrl: '', videoUrl: '', style: '', tag: '', tagStyle: '', dateLabel: '', duration: '', status: 'Published', sortOrder: 0 },
  colMap: apiToColumn.media,
  publicGet: true,
  allowedPatch: ['category', 'title', 'body', 'icon', 'imageUrl', 'videoUrl', 'style', 'tag', 'tagStyle', 'dateLabel', 'duration', 'status', 'sortOrder'],
});

// ── Media image upload (admin only) ─────────────────────────────────────────
app.post('/api/media/upload', requireAuth, (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ message: err.message || 'Upload failed.' });
    if (!req.file) return res.status(400).json({ message: 'No image file received.' });
    res.status(201).json({ data: { url: `/images/media-uploads/${req.file.filename}` } });
  });
});

// ── Media video upload (admin only) ─────────────────────────────────────────
app.post('/api/media/upload-video', requireAuth, (req, res) => {
  uploadVideo.single('video')(req, res, (err) => {
    if (err) return res.status(400).json({ message: err.message || 'Upload failed.' });
    if (!req.file) return res.status(400).json({ message: 'No video file received.' });
    res.status(201).json({ data: { url: `/images/media-uploads/${req.file.filename}` } });
  });
});

// ── AI Chat proxy (keeps ANTHROPIC_API_KEY server-side only) ───────────────
// Public-facing (called from the Careers page for unauthenticated applicants),
// so it needs its own guardrails rather than requireAuth: a hard token cap and
// a simple per-IP rate limit, so it can't be used as a free, unlimited chat
// endpoint against the hospital's Anthropic API key.
const CHAT_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const CHAT_RATE_LIMIT_MAX = 8; // requests per IP per window
const chatRateLimitLog = new Map(); // ip -> array of request timestamps

function chatRateLimited(ip) {
  const now = Date.now();
  const timestamps = (chatRateLimitLog.get(ip) || []).filter((t) => now - t < CHAT_RATE_LIMIT_WINDOW_MS);
  timestamps.push(now);
  chatRateLimitLog.set(ip, timestamps);
  return timestamps.length > CHAT_RATE_LIMIT_MAX;
}

app.post('/api/chat', async (req, res) => {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  if (chatRateLimited(ip)) {
    return res.status(429).json({ message: 'Too many requests. Please try again later.' });
  }

  const { system, messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 4) {
    return res.status(400).json({ message: 'messages is required.' });
  }
  for (const m of messages) {
    if (typeof m?.content !== 'string' || m.content.length > 2000) {
      return res.status(400).json({ message: 'Message content is invalid or too long.' });
    }
  }
  if (typeof system === 'string' && system.length > 1000) {
    return res.status(400).json({ message: 'System prompt is too long.' });
  }
  const max_tokens = 200; // hard server-side cap; client-supplied max_tokens is ignored

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY is not set in the environment.');
    return res.status(500).json({ message: 'AI chat is not configured on the server.' });
  }
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens,
        system: system || undefined,
        messages,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      console.error('Anthropic API error:', data);
      return res.status(502).json({ message: data.error?.message || 'AI service error.' });
    }
    const reply = data.content?.[0]?.text || '';
    res.json({ data: { reply } });
  } catch (err) {
    console.error('Chat proxy error:', err);
    res.status(502).json({ message: 'Could not reach AI service.' });
  }
});

// ── Health / root ───────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ data: { status: 'ok', time: new Date().toISOString() } }));
app.get('/', (req, res) => res.redirect('/home/index.html'));

// ── 404 + error handler ─────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ message: `Route not found: ${req.method} ${req.path}` }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: 'Internal server error.' });
});

app.listen(PORT, () => {
  console.log(`EL DUNAMIS API running at http://localhost:${PORT}`);
  console.log(`Base path: http://localhost:${PORT}/api`);
});
