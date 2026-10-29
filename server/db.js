// db.js — SQLite persistence for the EL DUNAMIS backend (uses Node's built-in node:sqlite)
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'eldunamis.db');
const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS admins (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    username             TEXT NOT NULL UNIQUE,
    password_hash        TEXT NOT NULL,
    name                 TEXT NOT NULL,
    role                 TEXT NOT NULL DEFAULT 'Administrator',
    initials             TEXT NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    status               TEXT NOT NULL DEFAULT 'Active',
    recovery_code_hash   TEXT,
    created_at           TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS appointments (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_name       TEXT NOT NULL,
    phone              TEXT NOT NULL,
    email              TEXT,
    department         TEXT NOT NULL,
    preferred_date     TEXT,
    consultation_type  TEXT,
    symptoms           TEXT,
    status             TEXT NOT NULL DEFAULT 'Pending',
    created_at         TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    email      TEXT,
    subject    TEXT,
    message    TEXT NOT NULL,
    is_read    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS cvs (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    name                   TEXT NOT NULL,
    phone                  TEXT,
    email                  TEXT,
    department_of_interest TEXT,
    degree                 TEXT,
    experience_years       INTEGER DEFAULT 0,
    cover_note             TEXT,
    resume_file            TEXT,
    resume_original_name   TEXT,
    created_at             TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS feedbacks (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT,
    rating        INTEGER,
    comment       TEXT,
    date_of_visit TEXT,
    contact       TEXT,
    would_recommend TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS doctors (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    specialty     TEXT NOT NULL,
    department    TEXT NOT NULL,
    availability  TEXT,
    qualifications TEXT,
    rating        TEXT,
    status        TEXT NOT NULL DEFAULT 'Active',
    bio           TEXT,
    image_url     TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS staff (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    role          TEXT NOT NULL,
    department    TEXT NOT NULL,             -- management | nursing | clinical-support
    photo_url     TEXT,
    status        TEXT NOT NULL DEFAULT 'Active',
    sort_order    INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS media_items (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    category      TEXT NOT NULL,                 -- announcement | news | gallery | video
    title         TEXT NOT NULL,
    body          TEXT,
    icon          TEXT,                          -- emoji fallback (used when no image is uploaded)
    image_url     TEXT,                          -- uploaded photo/thumbnail, e.g. /images/media-uploads/xyz.jpg
    video_url     TEXT,                          -- uploaded video file or external link (YouTube/Vimeo/mp4)
    style         TEXT,                          -- color variant: announcement(blue/gold/green/red), news(health/award/community/research)
    tag           TEXT,                          -- badge / tag / category label text
    tag_style     TEXT,                          -- badge style: new/notice/event/urgent
    date_label    TEXT,                          -- display date e.g. "June 1, 2025"
    duration      TEXT,                          -- video duration e.g. "4:32"
    status        TEXT NOT NULL DEFAULT 'Published',  -- Published | Draft
    sort_order    INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS departments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    icon          TEXT NOT NULL DEFAULT '🏥',   -- emoji shown on the department card
    description   TEXT,                         -- short tagline, e.g. "Heart & vascular care"
    count         INTEGER NOT NULL DEFAULT 0,    -- e.g. 8
    unit          TEXT NOT NULL DEFAULT 'Specialists', -- e.g. "Specialists" / "Doctors" / "Dentists"
    status        TEXT NOT NULL DEFAULT 'Active',      -- Active | Inactive (Inactive is hidden on the public site)
    sort_order    INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS job_openings (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    title         TEXT NOT NULL,                 -- e.g. "Resident Doctor — General Medicine"
    icon          TEXT NOT NULL DEFAULT '💼',
    status        TEXT NOT NULL DEFAULT 'Open',   -- Open | Closed (Closed is hidden on the public site)
    sort_order    INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS testimonials (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    role          TEXT,                          -- e.g. "Patient's family · Lagos"
    rating        INTEGER NOT NULL DEFAULT 5,     -- 1-5
    quote         TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'Published', -- Published | Draft (Draft is hidden on the public site)
    sort_order    INTEGER NOT NULL DEFAULT 0,     -- higher numbers show first (top 3 shown on homepage)
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS site_settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

// ── Migration: add image_url / video_url to media_items if upgrading from an older DB ───
{
  const cols = db.prepare(`PRAGMA table_info(media_items)`).all().map(c => c.name);
  if (!cols.includes('image_url')) {
    db.exec(`ALTER TABLE media_items ADD COLUMN image_url TEXT`);
  }
  if (!cols.includes('video_url')) {
    db.exec(`ALTER TABLE media_items ADD COLUMN video_url TEXT`);
  }
}

// ── Migration: add image_url to doctors if upgrading from an older DB ──────
{
  const cols = db.prepare(`PRAGMA table_info(doctors)`).all().map(c => c.name);
  if (!cols.includes('image_url')) {
    db.exec(`ALTER TABLE doctors ADD COLUMN image_url TEXT`);
  }
}

// ── Migration: keep the reviewer's contact + "would you recommend us?" answer ──
// The review form always asked for these but they were never saved.
{
  const cols = db.prepare(`PRAGMA table_info(feedbacks)`).all().map(c => c.name);
  if (!cols.includes('contact')) db.exec(`ALTER TABLE feedbacks ADD COLUMN contact TEXT`);
  if (!cols.includes('would_recommend')) db.exec(`ALTER TABLE feedbacks ADD COLUMN would_recommend TEXT`);
}

// ── Migration: track which feedback was promoted to a public testimonial ──
{
  const cols = db.prepare(`PRAGMA table_info(feedbacks)`).all().map(c => c.name);
  if (!cols.includes('promoted_testimonial_id')) {
    db.exec(`ALTER TABLE feedbacks ADD COLUMN promoted_testimonial_id INTEGER`);
  }
}

// ── Migration: add resume columns to cvs if upgrading from an older DB ─────
{
  const cols = db.prepare(`PRAGMA table_info(cvs)`).all().map(c => c.name);
  if (!cols.includes('resume_file')) {
    db.exec(`ALTER TABLE cvs ADD COLUMN resume_file TEXT`);
  }
  if (!cols.includes('resume_original_name')) {
    db.exec(`ALTER TABLE cvs ADD COLUMN resume_original_name TEXT`);
  }
}

// ── Migration: add must_change_password to admins if upgrading from an older DB ──
// Existing admins default to 0 (not forced) so nobody already using the portal gets
// unexpectedly locked out; only freshly-seeded accounts are forced (see below).
{
  const cols = db.prepare(`PRAGMA table_info(admins)`).all().map(c => c.name);
  if (!cols.includes('must_change_password')) {
    db.exec(`ALTER TABLE admins ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0`);
  }
}

// ── Migration: add status to admins if upgrading from an older DB ──────────
{
  const cols = db.prepare(`PRAGMA table_info(admins)`).all().map(c => c.name);
  if (!cols.includes('status')) {
    db.exec(`ALTER TABLE admins ADD COLUMN status TEXT NOT NULL DEFAULT 'Active'`);
  }
}

// ── Migration: add recovery_code_hash to admins if upgrading from an older DB ──
{
  const cols = db.prepare(`PRAGMA table_info(admins)`).all().map(c => c.name);
  if (!cols.includes('recovery_code_hash')) {
    db.exec(`ALTER TABLE admins ADD COLUMN recovery_code_hash TEXT`);
  }
}

// ── Migration: ensure at least one Super Admin exists ───────────────────────
// Installs that predate multi-admin support seeded a single account with role
// "Administrator". Promote the earliest admin to "Super Admin" so upgrading
// installs can immediately use the new admin-management screen instead of
// being locked out of it.
{
  const superAdminCount = db.prepare(`SELECT COUNT(*) AS n FROM admins WHERE role = 'Super Admin'`).get().n;
  if (superAdminCount === 0) {
    const earliest = db.prepare(`SELECT id FROM admins ORDER BY id ASC LIMIT 1`).get();
    if (earliest) db.prepare(`UPDATE admins SET role = 'Super Admin' WHERE id = ?`).run(earliest.id);
  }
}

// ── Seed admin account (idempotent) ─────────────────────────────────────────
const seeded = db.prepare(`SELECT COUNT(*) AS n FROM admins`).get().n;
if (seeded === 0) {
  const username = process.env.ADMIN_USER || 'admin';
  const password = process.env.ADMIN_PASS || 'admin123';
  const hash = bcrypt.hashSync(password, 10);
  db.prepare(`
    INSERT INTO admins (username, password_hash, name, role, initials, must_change_password, status)
    VALUES (?, ?, ?, ?, ?, 1, 'Active')
  `).run(username, hash, 'EL DUNAMIS Administrator', 'Super Admin', 'ELD');
  console.log(process.env.ADMIN_PASS
    ? `Seeded admin user "${username}" using the ADMIN_PASS you set. They will be required to set a new password on first login.`
    : `Seeded admin user "${username}" (default password: "${password}"). They will be required to set a new password on first login.`);
}

// Random reader-friendly recovery code, e.g. "7K4P-QRXN-2FTB" — no email is
// sent by this app, so a Super Admin who forgets their password resets it
// from the login screen using this instead. 12 chars from a 32-symbol
// alphabet (no 0/O/1/I, easy to misread) is ~60 bits of entropy — plenty
// for a secret that's also rate-limited at the API.
function randomRecoveryCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 12; i++) {
    if (i > 0 && i % 4 === 0) code += '-';
    code += chars[crypto.randomInt(chars.length)];
  }
  return code;
}

// ── Backfill recovery codes for any Super Admin who doesn't have one ───────
// Covers three cases in one idempotent pass: a fresh install's newly-seeded
// Super Admin, an upgrade whose sole admin just got promoted above, and any
// existing Super Admin from before this feature existed. Since there's
// nowhere else to deliver it (no email), it's printed to the server log —
// shown once, never stored anywhere but as a bcrypt hash.
{
  const missingRecoveryCode = db.prepare(
    `SELECT id, username FROM admins WHERE role = 'Super Admin' AND status = 'Active' AND recovery_code_hash IS NULL`
  ).all();
  const setCode = db.prepare('UPDATE admins SET recovery_code_hash = ? WHERE id = ?');
  missingRecoveryCode.forEach((a) => {
    const code = randomRecoveryCode();
    setCode.run(bcrypt.hashSync(code, 10), a.id);
    console.log('');
    console.log('════════════════════════════════════════════════════════════');
    console.log(`  RECOVERY CODE for Super Admin "${a.username}"`);
    console.log(`  ${code}`);
    console.log('  Save this somewhere safe. It lets "Forgot password?" on the');
    console.log('  login screen reset this account if the password is ever');
    console.log('  forgotten. Shown only this once — it will not be shown again');
    console.log('  (a Super Admin can generate a new one from Settings).');
    console.log('════════════════════════════════════════════════════════════');
  });
}

// ── Seed staff/doctor records so the admin & site have content on first run ────
// Matches what was previously hard-coded on the public homepage, so the switch
// to database-driven content is seamless on first deploy.
const doctorSeedCount = db.prepare(`SELECT COUNT(*) AS n FROM doctors`).get().n;
if (doctorSeedCount === 0) {
  // [name, specialty, department, availability, qualifications, rating, bio, image_url]
  const doctors = [
    ['Dr. Nwitte John',       'Head, Medical Officer', 'General Medicine', 'Mon – Fri', 'See profile', null, 'Leading the medical team at El Dunamis Medical Centre with expertise in general medicine and patient care.', null],
    ['Dr. Barisi Nwante',     'Medical Officer',       'General Medicine', 'Mon – Fri', 'See profile', null, 'Dedicated medical officer providing quality patient care and clinical support at El Dunamis Medical Centre.', '/images/staff-barisi-nwante.jpg'],
    ['Dr. Ifoegbu Fortune',   'Medical Officer',       'General Medicine', 'Mon – Fri', 'See profile', null, 'Committed to delivering compassionate and evidence-based medical care to every patient.', '/images/staff-ifoegbu-fortune.jpg'],
    ['Dr. Okoroafor Chris',   'Medical Officer',       'General Medicine', 'Mon – Fri', 'See profile', null, 'Skilled medical officer focused on patient wellness and high-quality clinical outcomes.', '/images/staff-okoroafor-chris.jpg'],
  ];
  const ins = db.prepare(`INSERT INTO doctors (name, specialty, department, availability, qualifications, rating, status, bio, image_url) VALUES (?,?,?,?,?,?, 'Active', ?, ?)`);
  for (const d of doctors) ins.run(d[0], d[1], d[2], d[3], d[4], d[5], d[6], d[7]);
  console.log(`Seeded ${doctors.length} doctors.`);
}

// ── Seed staff records (Management / Nursing / Clinical Support) ───────────
const staffSeedCount = db.prepare(`SELECT COUNT(*) AS n FROM staff`).get().n;
if (staffSeedCount === 0) {
  // [name, role, department, photo_url, sort_order]
  const staffMembers = [
    ['Mr. Temidayo Okedele',      'Manager, Head of Admin/Operations',  'management',       '/images/staff-okedele-temidayo.jpg',      11],
    ['Mr. Falegan Olasunkanmi',   'Manager, Head of Admin/Operations',  'management',       '/images/staff-falegan-olasunkanmi.jpg',   10],
    ['Mr. Adeniran Israel',       'Administrative Officer, Ayobo Branch','management',      null,                                        9],
    ['Mr. Akanji E. Stephen',     'Accounting Officer',                 'management',       '/images/staff-akanji-stephen.jpg',         8],
    ['Mrs. Ozoemena Ifeoma',      'Chief Matron',                       'nursing',          '/images/staff-ozoemena-ifeoma.jpg',        7],
    ['Mrs. Dan Nene',             'Matron',                             'nursing',          '/images/staff-dan-nene.jpg',                6],
    ['Mrs. Abdulkareem Mojisola', 'Head, HMO Department',               'clinical-support', '/images/staff-abdulkareem-mojisola.jpg',   5],
    ['Miss Akanni M. Bisola',     'Head, Dispensary Unit',              'clinical-support', '/images/staff-akanni-bisola.jpg',          4],
    ['Mr. Bangbose Jamiu',        'Sonographer',                        'clinical-support', '/images/staff-bangbose-jamiu.jpg',         3],
    ['Mr. Ilesanmi Solomon',      'Head, Laboratory',                   'clinical-support', '/images/staff-ilesanmi-solomon.jpg',       2],
    ['Mr. Olugbade Samson',       'Head, IT / Customer Service',        'clinical-support', null,                                        1],
  ];
  const insStaff = db.prepare(`INSERT INTO staff (name, role, department, photo_url, status, sort_order) VALUES (?,?,?,?, 'Active', ?)`);
  for (const s of staffMembers) insStaff.run(s[0], s[1], s[2], s[3], s[4]);
  console.log(`Seeded ${staffMembers.length} staff members.`);
}

// ── Seed departments (Clinical Divisions shown on the homepage) ─────────────
const deptSeedCount = db.prepare(`SELECT COUNT(*) AS n FROM departments`).get().n;
if (deptSeedCount === 0) {
  // [name, icon, description, count, unit, sort_order]
  const depts = [
    ['Cardiology',        '❤️', 'Heart & vascular care',            8,  'Specialists',  12],
    ['Neurology',         '🧠', 'Brain & spine',                    5,  'Specialists',  11],
    ['Paediatrics',       '👶', "Children's health",                7,  'Specialists',  10],
    ['Maternity',         '🤱', "Women's health",                   6,  'Specialists',  9],
    ['Orthopaedics',      '🦴', 'Bones & joints',                   5,  'Specialists',  8],
    ['General Medicine',  '🩺', 'Primary care',                     12, 'Doctors',      7],
    ['Ophthalmology',     '👁️', 'Eye care',                         3,  'Specialists',  6],
    ['Dental',            '🦷', 'Oral health',                      5,  'Dentists',     5],
    ['Physiotherapy',     '🏃', 'Rehabilitation',                   8,  'Therapists',   4],
    ['Radiology',         '🩻', 'Imaging & diagnostics',            4,  'Radiologists', 3],
    ['Oncology',          '🔬', 'Cancer diagnosis & treatment',     4,  'Specialists',  2],
    ['Psychiatry',        '💊', 'Mental health & wellbeing',        3,  'Specialists',  1],
  ];
  const insDept = db.prepare(`INSERT INTO departments (name, icon, description, count, unit, status, sort_order) VALUES (?,?,?,?,?, 'Active', ?)`);
  for (const d of depts) insDept.run(d[0], d[1], d[2], d[3], d[4], d[5]);
  console.log(`Seeded ${depts.length} departments.`);
}

// ── Seed job openings (Careers page "Current Openings" list) ────────────────
const openingsSeedCount = db.prepare(`SELECT COUNT(*) AS n FROM job_openings`).get().n;
if (openingsSeedCount === 0) {
  // [title, icon, sort_order]
  const openings = [
    ['Resident Doctor — General Medicine',    '🩺', 6],
    ['Registered Nurse (Maternity Ward)',     '👩‍⚕️', 5],
    ['Dental Officer',                        '🦷', 4],
    ['Medical Laboratory Scientist',          '🔬', 3],
    ['Pharmacist / Pharmacy Technician',      '💊', 2],
    ['Medical Records Officer',               '📋', 1],
  ];
  const insOpening = db.prepare(`INSERT INTO job_openings (title, icon, status, sort_order) VALUES (?,?, 'Open', ?)`);
  for (const o of openings) insOpening.run(o[0], o[1], o[2]);
  console.log(`Seeded ${openings.length} job openings.`);
}

// ── Seed media items (Announcements/News/Gallery/Videos) so Media page has content ──
const mediaSeedCount = db.prepare(`SELECT COUNT(*) AS n FROM media_items`).get().n;
if (mediaSeedCount === 0) {
  // [category, title, body, icon, style, tag, tag_style, date_label, duration, sort_order]
  const items = [
    ['announcement', 'Extended Emergency Hours — Now 24/7', 'Our Emergency & Trauma unit now operates around the clock, 365 days a year. We have expanded our on-call specialist roster to ensure immediate response for all critical cases. No referrals needed — walk in or call ahead.', '🚨', 'red', 'New', 'new', 'June 1, 2025', null, 6],
    ['announcement', 'Free Immunization Drive — Every Tuesday', "EL DUNAMIS is proud to offer free childhood immunizations every Tuesday from 9am to 2pm at both branches. Vaccines covered include BCG, OPV, Penta, PCV, and Measles as per the National Programme on Immunization schedule. Parents are encouraged to bring their child's health card.", '💉', 'gold', 'Recurring', 'event', 'May 20, 2025', null, 5],
    ['announcement', 'Antenatal Clinic — Every Thursday', 'Our dedicated antenatal clinic holds every Thursday from 8am to 1pm. Services include ultrasound scans, antenatal booking, nutritional counselling, and specialist consultations for high-risk pregnancies. Registration is open — please call ahead to secure your slot.', '🤰', 'green', 'Recurring', 'event', 'May 15, 2025', null, 4],
    ['announcement', 'New Laparoscopic Surgery Suite Now Open', 'We are pleased to announce the commissioning of our state-of-the-art laparoscopic (keyhole) surgery suite at Branch 1. This facility enables minimally invasive procedures across gynaecology, general surgery, and urology, ensuring faster recovery and reduced hospital stays for our patients.', '🏥', 'blue', 'New', 'new', 'April 30, 2025', null, 3],
    ['announcement', 'NHIA Accreditation Renewal Completed', 'EL DUNAMIS Medical Centre has successfully renewed its NHIA (National Health Insurance Authority) accreditation. Patients with valid NHIA or HMO cards can access consultations, investigations, and medications at subsidised rates across both our branches.', '📋', 'blue', 'Notice', 'notice', 'April 10, 2025', null, 2],
    ['announcement', 'Free Community Health Seminar — Hypertension & Diabetes', 'Join us for a free public health seminar on managing hypertension and diabetes in the community. The session will be held at our Branch 2 hall on the last Saturday of every month at 10am. Open to all — no appointment required. Light refreshments will be provided.', '🎓', 'gold', 'Monthly', 'event', 'March 28, 2025', null, 1],

    ['news', 'EL DUNAMIS Wins Lagos State Best Private Hospital Award 2025', 'We were honoured at the Lagos State Ministry of Health annual gala for our outstanding patient care outcomes and community health initiatives.', '🏆', 'health', 'Award', 'award', 'May 28, 2025', null, 6],
    ['news', 'Free Medical Outreach Reaches 1,200 Residents in Ayobo', 'Our mobile health team provided free consultations, blood pressure checks, blood glucose tests, and medications to over 1,200 community members across Ayobo and Ipaja.', '🤝', 'community', 'Community', 'community', 'May 10, 2025', null, 5],
    ['news', 'Our Gynaecology Team Publishes Landmark Study on High-Risk Pregnancy Outcomes', "Dr. Ifeoma Adeyemi and her team's research on managing eclampsia in low-resource settings has been accepted for publication in the West African Journal of Medicine.", '🔬', 'research', 'Research', 'research', 'April 22, 2025', null, 4],
    ['news', 'New Neonatal Intensive Care Unit Commissioned at Branch 1', 'Our new 8-bed NICU is now fully operational, equipped with modern incubators, ventilators, and round-the-clock neonatologist coverage — a first for the Ayobo corridor.', '🏥', 'health', 'Health', 'health', 'April 5, 2025', null, 3],
    ['news', 'EL DUNAMIS Marks World Kidney Day with Free Screening Camp', 'In partnership with the Nigerian Association of Nephrology, we hosted a free kidney health screening camp that saw over 400 participants receive urinalysis and blood pressure checks.', '🎗️', 'community', 'Community', 'community', 'March 14, 2025', null, 2],
    ['news', 'Celebrating 23 Years of Healing with Strength and Purpose', 'EL DUNAMIS Medical Centre marks its 23rd anniversary with a thanksgiving service, staff awards night, and a pledge to expand services into the Badagry corridor in 2026.', '🌟', 'award', 'Milestone', 'award', 'February 2, 2025', null, 1],

    ['gallery', 'Reception Area', null, '🏨', null, null, null, null, null, 8],
    ['gallery', 'Consultation Room', null, '🩺', null, null, null, null, null, 7],
    ['gallery', 'Operating Theatre', null, '⚕️', null, null, null, null, null, 6],
    ['gallery', 'Laboratory Unit', null, '🔬', null, null, null, null, null, 5],
    ['gallery', 'Community Outreach — Ayobo 2025', null, '🩺', null, null, null, null, null, 4],
    ['gallery', 'Award Ceremony 2025', null, '🏆', null, null, null, null, null, 3],
    ['gallery', 'NICU — Branch 1', null, '👶', null, null, null, null, null, 2],
    ['gallery', 'Staff Training Day', null, '🎓', null, null, null, null, null, 1],

    ['video', 'Tour of EL DUNAMIS Medical Centre', 'A walkthrough of our facilities, wards, and specialist units across both branches.', null, null, '🏥 Facility', null, 'May 2025', '4:32', 6],
    ['video', 'Understanding Your Antenatal Journey', 'Dr. Adeyemi explains what to expect at each trimester and how our team supports you.', null, null, '🤰 Maternity', null, 'April 2025', '6:14', 5],
    ['video', 'Why Childhood Immunization Matters', 'Our paediatric team breaks down the NPI vaccine schedule and answers common parent questions.', null, null, '💉 Paediatrics', null, 'March 2025', '3:55', 4],
    ['video', 'Managing Hypertension Naturally', 'A health talk from our internal medicine unit covering diet, exercise, and monitoring your blood pressure.', null, null, '❤️ Cardiology', null, 'March 2025', '8:02', 3],
    ['video', 'Highlights: Community Outreach 2025', 'Watch how our mobile team served over 1,200 residents with free screenings in Ayobo.', null, null, '🤝 Community', null, 'Feb 2025', '5:20', 2],
    ['video', 'How to Book an Appointment Online', 'A quick step-by-step guide to using our online scheduling system from any device.', null, null, '📱 Patient Guide', null, 'Jan 2025', '2:48', 1],
  ];
  const insMedia = db.prepare(`INSERT INTO media_items (category, title, body, icon, style, tag, tag_style, date_label, duration, sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  for (const m of items) insMedia.run(...m);
  console.log(`Seeded ${items.length} media items.`);
}

// ── Seed testimonials (Featured reviews shown on the homepage) ──────────────
const testimonialSeedCount = db.prepare(`SELECT COUNT(*) AS n FROM testimonials`).get().n;
if (testimonialSeedCount === 0) {
  // [name, role, rating, quote, sort_order]
  const testimonials = [
    ['Bolaji Nwosu', "Patient's family · Lagos", 5, "The cardiology team at EL DUNAMIS Medical Centre saved my father's life after a severe heart attack. The speed and professionalism were extraordinary. We are eternally grateful.", 3],
    ['Kemi Afolabi', 'Maternity patient · Abuja', 5, 'I delivered my twins here and cannot say enough about the maternity ward. Dr. Adeyemi and her team were calm, skilled, and made me feel completely at ease throughout.', 2],
    ['Tunde Okafor', 'General Medicine patient', 5, 'From the moment I walked in, every staff member treated me with dignity and kindness. The telemedicine follow-up was especially convenient. Truly a world-class institution.', 1],
  ];
  const insTest = db.prepare(`INSERT INTO testimonials (name, role, rating, quote, status, sort_order) VALUES (?,?,?,?, 'Published', ?)`);
  for (const t of testimonials) insTest.run(t[0], t[1], t[2], t[3], t[4]);
  console.log(`Seeded ${testimonials.length} testimonials.`);
}

// ── Seed homepage "Overall Rating" settings (leave-a-review sidebar) ────────
const ratingSeedCount = db.prepare(`SELECT COUNT(*) AS n FROM site_settings WHERE key LIKE 'rating_%'`).get().n;
if (ratingSeedCount === 0) {
  const ratingDefaults = {
    rating_score:      '4.9',
    rating_countLabel: 'Based on 340+ patient reviews',
    rating_pct5: '82', rating_pct4: '12', rating_pct3: '4', rating_pct2: '1', rating_pct1: '1',
  };
  const insSetting = db.prepare(`INSERT INTO site_settings (key, value) VALUES (?, ?)`);
  for (const [k, v] of Object.entries(ratingDefaults)) insSetting.run(k, v);
  console.log('Seeded homepage rating settings.');
}

module.exports = db;