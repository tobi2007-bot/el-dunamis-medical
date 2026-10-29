// ══════════════════════════════════════════════
//  DATA LAYER — fetches from backend API
// ══════════════════════════════════════════════
// In-memory cache populated from the API
const store = {
  appointments: [],
  cvs: [],
  feedbacks: [],
  messages: [],
  doctors: [],
  staff: [],
  media: [],
  departments: [],
  openings: [],
  testimonials: [],
  ratingSettings: {},
  admins: [],
};

// Escapes untrusted, publicly-submitted content (appointments, CVs, feedbacks,
// contact messages) before it is dropped into innerHTML, so a malicious
// visitor can't inject a script that runs in the logged-in admin's browser.
function escapeHtml(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

const STAFF_DEPT_LABELS = {
  'management': 'Management',
  'nursing': 'Nursing',
  'clinical-support': 'Clinical Support',
};

const MEDIA_STYLE_OPTIONS = {
  announcement: ['blue', 'gold', 'green', 'red'],
  news: ['health', 'award', 'community', 'research'],
  gallery: [],
  video: [],
};

const DEFAULT_DOCTORS = [
  {id:1, name:'Dr. Adebola Okonkwo', specialty:'Senior Consultant Cardiologist', dept:'Cardiology', avail:'Mon – Fri', qual:'MBBS, FWCP', rating:'4.9', status:'Active', bio:'Over 20 years in interventional cardiology.'},
  {id:2, name:'Dr. Fatima Musa',     specialty:'Head of Paediatrics',             dept:'Paediatrics',  avail:'Mon – Sat', qual:'MBBS, FMCP (Paed)', rating:'5.0', status:'Active', bio:'Specialist in neonatal intensive care.'},
  {id:3, name:'Dr. Chukwuemeka Eze', specialty:'Consultant Neurosurgeon',          dept:'Neurology',    avail:'Tue – Thu', qual:'MBBS, FWACS', rating:'4.8', status:'Active', bio:'Spinal surgery sub-specialty.'},
  {id:4, name:'Dr. Ifeoma Adeyemi',  specialty:'Consultant Obs & Gynaecologist',   dept:'Maternity & Gynaecology', avail:'Mon – Fri', qual:'MBBS, FMCOG', rating:'4.9', status:'Active', bio:'High-risk pregnancy expert.'},
];

const DEPT_ICONS = {
  'General Medicine':'🩺','Cardiology':'❤️','Neurology':'🧠','Paediatrics':'👶',
  'Maternity & Gynaecology':'🤱','Orthopaedics':'🦴','Oncology':'🔬','Ophthalmology':'👁️',
  'Dental':'🦷','Physiotherapy':'🏃','Radiology':'🩻','Psychiatry':'💊','Other':'🏥'
};

// ══════════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════════
// currentUser is set from the API JWT response
let currentUser = null;
let viewingApptId = null;
// Held only in memory for the length of a forced first-login password change,
// so the admin doesn't have to retype the temporary password they just used
// to sign in. Never written to storage, and cleared as soon as it's used.
let pendingLoginPassword = null;

function togglePass(inputId){
  const inp = document.getElementById(inputId || 'login-pass');
  inp.type = inp.type === 'password' ? 'text' : 'password';
}

async function doLogin(){
  const username = document.getElementById('login-user').value.trim();
  const password = document.getElementById('login-pass').value;
  const err  = document.getElementById('login-error');
  const btn  = document.getElementById('login-btn');

  if (!username || !password) {
    err.style.display = 'block';
    setTimeout(() => err.style.display = 'none', 3000);
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Signing in…';

  try {
    const data = await api.post('/auth/login', { username, password });
    // Save token for all subsequent API calls
    sessionStorage.setItem('eld_token', data.token);
    currentUser = data.user;
    document.getElementById('login-screen').style.display = 'none';

    if (currentUser.mustChangePassword) {
      // Block access to the dashboard entirely until a new password is set.
      pendingLoginPassword = password;
      document.getElementById('force-pass-screen').style.display = 'flex';
      document.getElementById('force-new-pass').focus();
    } else {
      document.getElementById('dashboard').style.display = 'flex';
      await initDashboard();
      toast('Welcome back, ' + currentUser.name + '!', 'success');
    }
  } catch (e) {
    err.style.display = 'block';
    setTimeout(() => err.style.display = 'none', 3000);
  }

  btn.disabled = false;
  btn.innerHTML = 'Sign In to Dashboard';
}

// ══════════════════════════════════════════════
//  FORGOT PASSWORD (Super Admin, via recovery code)
// ══════════════════════════════════════════════
function openForgotPassword(){
  document.getElementById('fp-username').value = document.getElementById('login-user').value.trim();
  document.getElementById('fp-code').value = '';
  document.getElementById('fp-new-pass').value = '';
  document.getElementById('fp-confirm-pass').value = '';
  document.getElementById('fp-error').style.display = 'none';
  document.getElementById('forgot-pw-form-view').style.display = 'block';
  document.getElementById('forgot-pw-done-view').style.display = 'none';
  openModal('forgot-pw-modal');
}

function closeForgotPassword(){
  closeModal('forgot-pw-modal');
  // If a reset just succeeded, carry the username over to the login form.
  const u = document.getElementById('fp-username').value.trim();
  if (u) document.getElementById('login-user').value = u;
}

async function submitForgotPassword(){
  const username = document.getElementById('fp-username').value.trim();
  const recoveryCode = document.getElementById('fp-code').value.trim();
  const newPassword = document.getElementById('fp-new-pass').value;
  const confirmPassword = document.getElementById('fp-confirm-pass').value;
  const errEl = document.getElementById('fp-error');
  errEl.style.display = 'none';

  if (!username || !recoveryCode || !newPassword) {
    errEl.textContent = 'Please fill in every field.';
    errEl.style.display = 'block';
    return;
  }
  if (newPassword.length < 8) {
    errEl.textContent = 'Password must be at least 8 characters.';
    errEl.style.display = 'block';
    return;
  }
  if (newPassword !== confirmPassword) {
    errEl.textContent = 'Passwords do not match.';
    errEl.style.display = 'block';
    return;
  }

  const btn = document.getElementById('fp-submit-btn');
  btn.disabled = true;
  try {
    const result = await api.post('/auth/reset-with-recovery-code', { username, recoveryCode, newPassword });
    document.getElementById('fp-new-code').value = result.recoveryCode;
    document.getElementById('forgot-pw-form-view').style.display = 'none';
    document.getElementById('forgot-pw-done-view').style.display = 'block';
  } catch (e) {
    errEl.textContent = e.message;
    errEl.style.display = 'block';
  }
  btn.disabled = false;
}

function copyForgotPwCode(){
  const inp = document.getElementById('fp-new-code');
  inp.select();
  if (navigator.clipboard) {
    navigator.clipboard.writeText(inp.value).then(()=>toast('Copied to clipboard.','success')).catch(()=>{});
  }
}

async function doForcePasswordChange(){
  const nw   = document.getElementById('force-new-pass').value;
  const conf = document.getElementById('force-conf-pass').value;
  const err  = document.getElementById('force-pass-error');
  const btn  = document.getElementById('force-pass-btn');
  const showErr = (msg) => {
    err.textContent = '❌ ' + msg;
    err.style.display = 'block';
    setTimeout(() => err.style.display = 'none', 3500);
  };

  if (!nw || !conf) return showErr('Please fill in both fields.');
  if (nw !== conf) return showErr('Passwords do not match.');
  if (nw.length < 8) return showErr('Password must be at least 8 characters.');

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Saving…';
  try {
    await api.put('/auth/change-password', { currentPassword: pendingLoginPassword, newPassword: nw });
    pendingLoginPassword = null;
    currentUser.mustChangePassword = false;
    document.getElementById('force-pass-screen').style.display = 'none';
    document.getElementById('force-new-pass').value = '';
    document.getElementById('force-conf-pass').value = '';
    document.getElementById('dashboard').style.display = 'flex';
    await initDashboard();
    toast('Password set. Welcome, ' + currentUser.name + '!', 'success');
  } catch (e) {
    showErr(e.message || 'Could not update password.');
  }
  btn.disabled = false;
  btn.innerHTML = 'Set Password &amp; Continue';
}

function doLogout(){
  if (!confirm('Sign out of the admin portal?')) return;
  sessionStorage.removeItem('eld_token');
  currentUser = null;
  pendingLoginPassword = null;
  document.getElementById('dashboard').style.display = 'none';
  document.getElementById('force-pass-screen').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';
  closeMobileSidebar();
  toast('Signed out successfully.', 'info');
}

// Called by shared/api.js whenever any request comes back 401 with a token
// attached — i.e. the session expired, or the account was disabled while
// signed in. Bounces back to the login screen instead of leaving the person
// stuck on a dashboard where every button just fails silently.
let sessionExpiredHandled = false;
function onSessionExpired(){
  if (sessionExpiredHandled) return; // a batch of parallel requests can all 401 at once
  sessionExpiredHandled = true;
  currentUser = null;
  pendingLoginPassword = null;
  document.getElementById('dashboard').style.display = 'none';
  document.getElementById('force-pass-screen').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('login-pass').value = '';
  closeMobileSidebar();
  toast('Your session has ended. Please sign in again.', 'error');
  setTimeout(() => { sessionExpiredHandled = false; }, 2000);
}

// ══════════════════════════════════════════════
//  DASHBOARD INIT
// ══════════════════════════════════════════════
async function initDashboard(){
  // Set user info in sidebar & topbar
  document.getElementById('sb-avatar').textContent = currentUser.initials;
  document.getElementById('sb-username').textContent = currentUser.name;
  document.getElementById('sb-role').textContent = currentUser.role;
  document.getElementById('tb-avatar').textContent = currentUser.initials;
  document.getElementById('tb-username').textContent = currentUser.name;
  document.getElementById('set-avatar').textContent = currentUser.initials;
  document.getElementById('set-name').textContent = currentUser.name;
  document.getElementById('set-role').textContent = currentUser.role;
  document.getElementById('set-display-name').value = currentUser.name;

  // Only a Super Admin can see/manage other admin accounts, or has a
  // recovery code to view/regenerate in the first place.
  const navAdmins = document.getElementById('nav-admins');
  if (navAdmins) navAdmins.style.display = currentUser.role === 'Super Admin' ? '' : 'none';
  const recoveryCard = document.getElementById('recovery-code-card');
  if (recoveryCard) recoveryCard.style.display = currentUser.role === 'Super Admin' ? 'block' : 'none';

  // Date
  document.getElementById('topbar-date').textContent = new Date().toLocaleDateString('en-NG',{weekday:'long',day:'numeric',month:'long',year:'numeric'});

  // Fetch all data from the backend in parallel
  try {
    const [apptRes, cvRes, fbRes, msgRes, docRes, staffRes, medRes, deptRes, openRes, testRes, ratingRes] = await Promise.all([
      api.get('/appointments?limit=200'),
      api.get('/cvs?limit=200'),
      api.get('/feedbacks?limit=200'),
      api.get('/messages?limit=200'),
      api.get('/doctors?limit=200'),
      api.get('/staff?limit=200'),
      api.get('/media?limit=300'),
      api.get('/departments?limit=200'),
      api.get('/openings?limit=200'),
      api.get('/testimonials?limit=200'),
      api.get('/settings/rating'),
    ]);
    store.appointments = apptRes.appointments || [];
    store.cvs          = cvRes.cvs           || [];
    store.feedbacks    = fbRes.feedbacks     || [];
    store.messages      = msgRes.messages    || [];
    store.doctors      = docRes.doctors      || [];
    store.staff         = staffRes.staff     || [];
    store.media         = medRes.items       || [];
    store.departments    = deptRes.departments || [];
    store.openings       = openRes.openings    || [];
    store.testimonials   = testRes.testimonials || [];
    store.ratingSettings = ratingRes || {};
  } catch(e) {
    toast('Failed to load data from server: ' + e.message, 'error');
  }

  // Login screen stats
  document.getElementById('ls-appts').textContent = store.appointments.length;
  document.getElementById('ls-cvs').textContent   = store.cvs.length;

  updateBadges();
  loadOverview();
  renderDoctors();
  renderStaff();
  renderDepartments();
  renderOpenings();
  renderMedia('announcement');
  renderTestimonials();
  loadRatingSettingsForm();

  // Admin accounts — only fetched/rendered for a Super Admin; a regular
  // Admin's token would get a 403 from the API for this endpoint anyway.
  if (currentUser.role === 'Super Admin') {
    try {
      store.admins = await api.get('/admins');
      renderAdmins();
    } catch (e) {
      toast('Failed to load admin accounts: ' + e.message, 'error');
    }
  }
}

function updateBadges(){
  const appts = store.appointments;
  const pending = appts.filter(a => a.status === 'Pending').length;
  document.getElementById('nb-appts').textContent = pending || '';
  document.getElementById('nb-appts').style.display = pending ? '' : 'none';
  document.getElementById('nb-cvs').textContent  = store.cvs.length || '';
  document.getElementById('nb-cvs').style.display = store.cvs.length ? '' : 'none';
  document.getElementById('nb-fbs').textContent  = store.feedbacks.length || '';
  document.getElementById('nb-fbs').style.display = store.feedbacks.length ? '' : 'none';
  const unreadMsgs = store.messages.filter(m => !m.isRead).length;
  document.getElementById('nb-msgs').textContent  = unreadMsgs || '';
  document.getElementById('nb-msgs').style.display = unreadMsgs ? '' : 'none';
}

// ══════════════════════════════════════════════
//  OVERVIEW
// ══════════════════════════════════════════════
function loadOverview(){
  const appts = store.appointments;
  const cvs   = store.cvs;
  const fbs   = store.feedbacks;

  document.getElementById('ov-appts').textContent = appts.length;
  document.getElementById('ov-cvs').textContent   = cvs.length;
  document.getElementById('ov-fbs').textContent   = fbs.length;

  // Activity feed
  // NOTE: patientName/department/name/departmentOfInterest/rating all come from
  // public, unauthenticated submission forms, so they're escaped before being
  // dropped into innerHTML — same rule as everywhere else in this file.
  const allActivity = [
    ...appts.map(a => ({type:'appt', text:`New appointment: <strong>${escapeHtml(a.patientName||a.name)}</strong> — ${escapeHtml(a.department||a.dept)}`, time:a.createdAt||a.created||a.id, icon:'appt'})),
    ...cvs.map(c =>   ({type:'cv',   text:`CV received: <strong>${escapeHtml(c.name)}</strong> for ${escapeHtml(c.departmentOfInterest||c.dept)}`, time:c.createdAt||c.date||c.id, icon:'cv'})),
    ...fbs.map(f =>   ({type:'fb',   text:`Feedback from <strong>${escapeHtml(f.name)||'Anonymous'}</strong> — ★${escapeHtml(f.rating)}`, time:f.createdAt||f.date||f.id, icon:'fb'})),
  ].sort((a,b) => new Date(b.time) - new Date(a.time)).slice(0,10);

  const feed = document.getElementById('activity-feed');
  if (allActivity.length === 0){
    feed.innerHTML = '<div class="empty-state"><div class="ei">📭</div><p>No activity yet.</p></div>';
  } else {
    feed.innerHTML = allActivity.map(a => `
      <div class="activity-item">
        <div class="act-icon ${a.icon}">${{appt:'📅',cv:'📋',fb:'💬'}[a.icon]}</div>
        <div class="act-text"><strong>${a.text}</strong><span>${fmtDate(a.time)}</span></div>
        <div class="act-time">${timeAgo(a.time)}</div>
      </div>`).join('');
  }

  // Dept chart
  const deptCount = {};
  appts.forEach(a => { const d=a.department||a.dept; deptCount[d] = (deptCount[d]||0)+1; });
  const sorted = Object.entries(deptCount).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const max = sorted[0]?.[1] || 1;
  const chart = document.getElementById('dept-chart');
  if (sorted.length === 0){
    chart.innerHTML = '<div class="empty-state" style="width:100%;padding:20px 0"><div class="ei">📊</div><p>No data yet</p></div>';
  } else {
    // dept comes from publicly-submitted appointments — escape before use in both
    // the title attribute and the label text.
    chart.innerHTML = sorted.map(([dept,count]) => `
      <div class="chart-bar-col">
        <div class="chart-bar-val">${count}</div>
        <div class="chart-bar" style="height:${Math.round((count/max)*120)}px" title="${escapeHtml(dept)}: ${count}"></div>
        <div class="chart-bar-label">${escapeHtml(dept.split(' ')[0])}</div>
      </div>`).join('');
  }

  // Quick stats grid
  const todayStr = new Date().toISOString().split('T')[0];
  const todayAppts = appts.filter(a => (a.preferredDate||a.date||'').slice(0,10) === todayStr).length;
  const pending = appts.filter(a => a.status === 'Pending').length;
  document.getElementById('quick-stats-grid').innerHTML = `
    <div style="background:var(--blue-light);border-radius:8px;padding:12px;text-align:center">
      <div style="font-family:var(--ff-display);font-size:24px;font-weight:700;color:#000">${todayAppts}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:2px">Today's Appts</div>
    </div>
    <div style="background:var(--orange-light);border-radius:8px;padding:12px;text-align:center">
      <div style="font-family:var(--ff-display);font-size:24px;font-weight:700;color:var(--orange)">${pending}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:2px">Pending</div>
    </div>`;

  // Latest appts table — patientName/department are public input, so escape them.
  const tbody = document.getElementById('ov-appt-table');
  const latest = appts.slice(-6).reverse();
  tbody.innerHTML = latest.length === 0
    ? '<tr><td colspan="6" style="text-align:center;padding:28px;color:var(--muted)">No appointments yet</td></tr>'
    : latest.map(a => `<tr>
        <td style="font-weight:600;color:var(--gold)">#ELD-${String(a.id).toString().slice(-4).padStart(4,'0')}</td>
        <td>${escapeHtml(a.patientName||a.name)}</td><td>${escapeHtml(a.department||a.dept)}</td><td>${(a.preferredDate||a.date||'—').slice(0,10)}</td>
        <td><span style="font-size:11px;color:var(--muted)">${escapeHtml(a.consultationType||a.type)||'—'}</span></td>
        <td>${statusBadge(a.status||'Pending')}</td>
      </tr>`).join('');
}

// ══════════════════════════════════════════════
//  APPOINTMENTS
// ══════════════════════════════════════════════
function renderAppts(list){
  const tbody = document.getElementById('appt-table-body');
  if (list.length === 0){
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:36px;color:var(--muted)"><div style="font-size:28px;margin-bottom:8px">📭</div>No appointments found.</td></tr>';
    return;
  }
  tbody.innerHTML = list.slice().reverse().map(a => `
    <tr>
      <td style="font-weight:700;color:var(--gold);font-size:12px">#ELD-${String(a.id).slice(-4).padStart(4,'0')}</td>
      <td><strong>${escapeHtml(a.patientName||a.name)}</strong></td>
      <td>${escapeHtml(a.phone)||'—'}</td>
      <td style="font-size:12px">${contactHtml(a.email)}</td>
      <td>${escapeHtml(a.department||a.dept)}</td>
      <td>${(a.preferredDate||a.date||'—').slice(0,10)}</td>
      <td><span style="font-size:11px;color:var(--muted)">${escapeHtml((a.consultationType||a.type||'').replace(' Consultation','').replace(' Appointment',''))}</span></td>
      <td>${statusBadge(a.status||'Pending')}</td>
      <td>
        <div style="display:flex;gap:6px">
          <button class="btn-sm btn-outline" onclick="viewAppt(${a.id})">View</button>
          <button class="btn-sm btn-danger" onclick="deleteAppt(${a.id})">✕</button>
        </div>
      </td>
    </tr>`).join('');
}

function filterAppts(){
  const q    = document.getElementById('appt-search').value.toLowerCase();
  const stat = document.getElementById('appt-status-filter').value;
  const type = document.getElementById('appt-type-filter').value;
  let list = store.appointments.filter(a => {
    const matchQ = !q || (a.patientName||a.name||'').toLowerCase().includes(q) || (a.department||a.dept||'').toLowerCase().includes(q) || (a.phone||'').includes(q) || (a.email||'').toLowerCase().includes(q);
    const matchS = !stat || a.status === stat;
    const matchT = !type || (a.consultationType||a.type) === type;
    return matchQ && matchS && matchT;
  });
  renderAppts(list);
}

// Building blocks for the "View" popups, so all four line up the same way:
// a label above its value, short details first, long free text last in a
// tinted box whose left edge matches the labels.
function vf(label, valueHtml){
  return `<div><span class="view-label">${label}</span><div class="view-value">${valueHtml}</div></div>`;
}
function vnote(label, text, emptyText){
  const body = text ? escapeHtml(text) : `<em style="color:var(--muted)">${emptyText}</em>`;
  return `<div class="vf-full"><span class="view-label">${label}</span><div class="view-note">${body}</div></div>`;
}

function viewAppt(id){
  const appts = store.appointments;
  const a = appts.find(x => x.id === id);
  if (!a) return;
  viewingApptId = id;
  document.getElementById('view-appt-ref').textContent = `Reference: #ELD-${String(a.id).toString().slice(-4).padStart(4,'0')}`;
  document.getElementById('view-appt-body').innerHTML = `
    <div class="view-grid">
      ${vf('Patient', `<span style="font-weight:600">${escapeHtml(a.patientName||a.name)}</span>`)}
      ${vf('Phone', escapeHtml(a.phone)||'—')}
      ${vf('Email', contactHtml(a.email))}
      ${vf('Department', escapeHtml(a.department||a.dept)||'—')}
      ${vf('Date', escapeHtml((a.preferredDate||a.date||'—').slice(0,10)))}
      ${vf('Type', escapeHtml(a.consultationType||a.type)||'—')}
      ${vf('Status', statusBadge(a.status||'Pending'))}
      ${vf('Submitted', fmtDate(a.createdAt||a.created||a.id))}
      ${vnote('Symptoms / Notes', a.symptoms||a.notes, 'None provided')}
    </div>`;
  openModal('view-appt-modal');
}

async function updateStatus(status){
  if (viewingApptId === null) return;
  try {
    await api.put('/appointments/' + viewingApptId, { status });
    const idx = store.appointments.findIndex(a => a.id === viewingApptId);
    if (idx !== -1) store.appointments[idx].status = status;
    closeModal('view-appt-modal');
    filterAppts(); loadOverview(); updateBadges();
    toast('Appointment marked as ' + status + '.', 'success');
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

async function deleteAppt(id){
  if (!confirm('Delete this appointment record?')) return;
  try {
    await api.delete('/appointments/' + id);
    store.appointments = store.appointments.filter(a => a.id !== id);
    filterAppts(); loadOverview(); updateBadges();
    toast('Appointment deleted.', 'info');
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

function openAddAppt(){
  document.getElementById('ma-date').min = new Date().toISOString().split('T')[0];
  openModal('add-appt-modal');
}

async function saveManualAppt(){
  const name  = document.getElementById('ma-name').value.trim();
  const phone = document.getElementById('ma-phone').value.trim();
  const dept  = document.getElementById('ma-dept').value;
  const date  = document.getElementById('ma-date').value;
  const type  = document.getElementById('ma-type').value;
  const stat  = document.getElementById('ma-status').value;
  const notes = document.getElementById('ma-notes').value.trim();
  if (!name || !phone || !dept || !date){ toast('Please fill all required fields.','error'); return; }
  // Matches the mapping used on the public booking form (schedule-a-visit.js)
  // so an appointment created here is tagged the same way one from the
  // website would be.
  const typeMap = {'In-Person Consultation':'In-Person','Telemedicine Consultation':'Teleconsult','Home Visit':'In-Person','Follow-Up Appointment':'In-Person'};
  try {
    const newAppt = await api.post('/appointments', {
      patientName: name, phone, department: dept,
      preferredDate: new Date(date + 'T00:00:00').toISOString(),
      consultationType: typeMap[type] || 'In-Person',
      symptoms: notes || undefined,
    });
    // Then update the status if not Pending
    if (stat !== 'Pending') await api.put('/appointments/' + newAppt.id, { status: stat });
    newAppt.status = stat;
    store.appointments.push(newAppt);
    closeModal('add-appt-modal');
    filterAppts(); loadOverview(); updateBadges();
    ['ma-name','ma-phone','ma-notes'].forEach(id=>document.getElementById(id).value='');
    document.getElementById('ma-dept').value='';
    document.getElementById('ma-date').value='';
    toast('Appointment added successfully.','success');
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

// ══════════════════════════════════════════════
//  CV APPLICATIONS
// ══════════════════════════════════════════════
function renderCVs(list){
  const tbody = document.getElementById('cv-table-body');
  if (list.length === 0){
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:36px;color:var(--muted)"><div style="font-size:28px;margin-bottom:8px">📭</div>No applications yet.</td></tr>';
    return;
  }
  tbody.innerHTML = list.slice().reverse().map((c,i) => `
    <tr>
      <td style="color:var(--muted);font-size:12px">${list.length - i}</td>
      <td><strong>${escapeHtml(c.name)}</strong></td>
      <td>${escapeHtml(c.phone)||'—'}</td>
      <td>${escapeHtml(c.email)||'—'}</td>
      <td>${escapeHtml(c.departmentOfInterest||c.dept)||'—'}</td>
      <td><span style="font-size:12px">${escapeHtml(c.degree)||'—'}</span></td>
      <td><span class="badge badge-new">${escapeHtml(c.experienceYears||c.experience)||'—'} yrs</span></td>
      <td style="font-size:12px;color:var(--muted)">${fmtDate(c.createdAt||c.date||c.id)}</td>
      <td>
        <div style="display:flex;gap:6px">
          <button class="btn-sm btn-outline" onclick="viewCV(${c.id})">View</button>
          ${c.hasResume ? `<button class="btn-sm btn-outline" onclick="downloadResume(${c.id},'${escapeHtml((c.resumeFileName||c.name)).replace(/'/g,"\\'")}')" title="Download résumé">📎</button>` : ''}
          <button class="btn-sm btn-danger" onclick="deleteCV(${c.id})">✕</button>
        </div>
      </td>
    </tr>`).join('');
}

function filterCVs(){
  const q    = document.getElementById('cv-search').value.toLowerCase();
  const dept = document.getElementById('cv-dept-filter').value;
  let list = store.cvs.filter(c => {
    const matchQ = !q || c.name.toLowerCase().includes(q) || (c.departmentOfInterest||c.dept||'').toLowerCase().includes(q);
    const matchD = !dept || (c.departmentOfInterest||c.dept) === dept;
    return matchQ && matchD;
  });
  renderCVs(list);
}

function buildCVDeptFilter(){
  // departmentOfInterest is public input (submitted with no login required),
  // so escape it before it goes into the <option> markup below.
  const depts = [...new Set(store.cvs.map(c=>c.departmentOfInterest||c.dept).filter(Boolean))].sort();
  const sel = document.getElementById('cv-dept-filter');
  sel.innerHTML = '<option value="">All Departments</option>' +
    depts.map(d=>`<option>${escapeHtml(d)}</option>`).join('');
}

function viewCV(id){
  const c = store.cvs.find(x=>x.id===id); if (!c) return;
  const resumeHtml = c.hasResume
    ? `📎 ${escapeHtml(c.resumeFileName||'resume file')} <button class="btn-sm btn-outline" style="margin-left:6px" onclick="downloadResume(${c.id},'${escapeHtml(c.resumeFileName||c.name).replace(/'/g,"\\'")}')">Download</button>`
    : `<em style="color:var(--muted)">No résumé attached.</em>`;
  const yrs = c.experienceYears ?? c.experience;
  const expHtml = (yrs === null || yrs === undefined || yrs === '') ? '—' : `${escapeHtml(yrs)} year${Number(yrs) === 1 ? '' : 's'}`;
  document.getElementById('view-cv-body').innerHTML = `
    <div class="view-grid">
      ${vf('Full Name', `<span style="font-weight:600">${escapeHtml(c.name)}</span>`)}
      ${vf('Phone', escapeHtml(c.phone)||'—')}
      ${vf('Email', contactHtml(c.email))}
      ${vf('Department', escapeHtml(c.departmentOfInterest||c.dept)||'—')}
      ${vf('Degree', escapeHtml(c.degree)||'—')}
      ${vf('Experience', expHtml)}
      ${vf('Résumé', resumeHtml)}
      ${vf('Applied On', fmtDate(c.date||c.id))}
      ${vnote('Cover Note', c.note, 'No cover note provided.')}
    </div>`;
  document.getElementById('view-cv-actions').innerHTML =
    `<a href="mailto:${encodeURIComponent(c.email||'')}" class="btn-sm btn-primary" style="display:inline-block;text-decoration:none">✉ Reply via Email</a>`;
  openModal('view-cv-modal');
}

// Downloads a CV's résumé. The route requires admin auth, so a plain <a href>
// won't carry the token — fetch it with the Authorization header and save
// the resulting blob under the applicant's original filename instead.
async function downloadResume(id, suggestedName){
  try {
    const token = sessionStorage.getItem('eld_token');
    const res = await fetch(API_BASE + '/cvs/' + id + '/resume', {
      headers: token ? { 'Authorization': 'Bearer ' + token } : {},
    });
    if (!res.ok) {
      const j = await res.json().catch(()=>({}));
      throw new Error(j.message || 'Could not download résumé.');
    }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition') || '';
    const match = /filename="?([^"]+)"?/.exec(cd);
    const filename = match ? match[1] : (suggestedName || 'resume');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  }
}

async function deleteCV(id){
  if (!confirm('Delete this CV application?')) return;
  try {
    await api.delete('/cvs/' + id);
    store.cvs = store.cvs.filter(c=>c.id!==id);
    filterCVs(); updateBadges();
    toast('Application deleted.','info');
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

// ══════════════════════════════════════════════
//  FEEDBACKS
// ══════════════════════════════════════════════
// A reviewer's "Phone / Email" is free text. Make it clickable when it is
// clearly an email address or a phone number, otherwise show it as plain text.
function contactHtml(c){
  const v = String(c || '').trim();
  if (!v) return '—';
  const safe = escapeHtml(v);
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return `<a href="mailto:${safe}" style="color:#1D4ED8">${safe}</a>`;
  if (/^[\d\s+()\-]{7,}$/.test(v)) return `<a href="tel:${escapeHtml(v.replace(/[^\d+]/g,''))}" style="color:#1D4ED8">${safe}</a>`;
  return safe;
}
function recommendLabel(v){
  return ({ yes:'Yes, definitely', maybe:'Maybe', no:'Not at this time' })[v] || '—';
}

function feedbackIsPromoted(f){
  return !!(f.promotedTestimonialId && store.testimonials.some(t => t.id === f.promotedTestimonialId));
}

function renderFeedbacks(){
  const fbs = store.feedbacks;
  const tbody = document.getElementById('fb-table-body');
  if (fbs.length === 0){
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:36px;color:var(--muted)"><div style="font-size:28px;margin-bottom:8px">📭</div>No feedbacks yet.</td></tr>';
    return;
  }
  tbody.innerHTML = fbs.slice().reverse().map((f,i) => `
    <tr>
      <td style="color:var(--muted);font-size:12px">${fbs.length-i}</td>
      <td><strong>${escapeHtml(f.name)||'Anonymous'}</strong></td>
      <td style="font-size:12px">${contactHtml(f.contact)}</td>
      <td><span style="color:var(--gold);letter-spacing:1px">${'★'.repeat(parseInt(f.rating)||0)}</span><span style="color:#ddd">${'★'.repeat(5-(parseInt(f.rating)||0))}</span> <span style="font-size:11px;color:var(--muted)">(${f.rating||'?'}/5)</span></td>
      <td style="font-size:12px">${recommendLabel(f.wouldRecommend)}</td>
      <td style="max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px;color:var(--muted)">${escapeHtml(f.comment)||'—'}</td>
      <td style="font-size:12px;color:var(--muted)">${fmtDate(f.date||f.id)}</td>
      <td style="white-space:nowrap">
        <button class="btn-sm btn-outline" onclick="viewFeedback(${f.id})">View</button>
        ${feedbackIsPromoted(f)
          ? `<span class="badge badge-confirmed" title="Already added as a testimonial">✓ Promoted</span>`
          : `<button class="btn-sm btn-outline" onclick="openPromoteFeedback(${f.id})">★ Promote</button>`}
        <button class="btn-sm btn-danger" onclick="deleteFb(${f.id})">✕</button>
      </td>
    </tr>`).join('');
}

function viewFeedback(id){
  const f = store.feedbacks.find(x=>x.id===id); if (!f) return;
  const stars = `<span style="color:var(--gold);letter-spacing:1px">${'★'.repeat(parseInt(f.rating)||0)}</span><span style="color:#ddd">${'★'.repeat(5-(parseInt(f.rating)||0))}</span> <span style="font-size:11px;color:var(--muted)">(${f.rating||'?'}/5)</span>`;
  document.getElementById('view-fb-body').innerHTML = `
    <div class="view-grid">
      ${vf('Name', `<span style="font-weight:600">${escapeHtml(f.name)||'Anonymous'}</span>`)}
      ${vf('Rating', stars)}
      ${vf('Phone / Email', contactHtml(f.contact))}
      ${vf('Would recommend us?', recommendLabel(f.wouldRecommend))}
      ${vf('Submitted', fmtDate(f.date||f.id))}
      ${vnote('Comment', f.comment, 'No comment provided.')}
    </div>`;
  document.getElementById('view-fb-actions').innerHTML = feedbackIsPromoted(f)
    ? `<span class="badge badge-confirmed">✓ Added as a testimonial</span> <span style="font-size:12px;color:var(--muted)">— saved as a Draft; publish it from the Testimonials tab.</span>`
    : `<button class="btn-sm btn-primary" onclick="closeModal('view-fb-modal');openPromoteFeedback(${f.id})">★ Promote to Testimonial</button>`;
  openModal('view-fb-modal');
}

function openPromoteFeedback(id){
  const f = store.feedbacks.find(x=>x.id===id); if (!f) return;
  if (!f.comment || !f.comment.trim()){ toast('This feedback has no comment to promote.','error'); return; }
  document.getElementById('pf-feedback-id').value = id;
  document.getElementById('pf-name').textContent = f.name || 'Anonymous';
  document.getElementById('pf-role').value = '';
  openModal('promote-fb-modal');
}

async function confirmPromoteFeedback(){
  const id = document.getElementById('pf-feedback-id').value;
  const role = document.getElementById('pf-role').value.trim();
  const btn = document.getElementById('pf-confirm-btn');
  btn.disabled = true;
  try {
    const result = await api.post('/feedbacks/' + id + '/promote', { role: role || undefined });
    const idx = store.feedbacks.findIndex(f=>f.id===Number(id));
    if (idx!==-1) store.feedbacks[idx].promotedTestimonialId = result.promotedTestimonialId;
    store.testimonials.push(result.testimonial);
    closeModal('promote-fb-modal');
    renderFeedbacks();
    renderTestimonials();
    toast('Testimonial created as a Draft — publish it from the Testimonials tab when ready.','success');
  } catch(e) {
    toast('Error: ' + e.message, 'error');
  }
  btn.disabled = false;
}

async function deleteFb(id){
  if (!confirm('Delete this feedback?')) return;
  try {
    await api.delete('/feedbacks/' + id);
    store.feedbacks = store.feedbacks.filter(f=>f.id!==id);
    renderFeedbacks(); updateBadges();
    toast('Feedback deleted.','info');
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

// ══════════════════════════════════════════════
//  DOCTORS
// ══════════════════════════════════════════════
function initialsOf(name){
  return String(name||'').replace(/^(Dr\.|Mr\.|Mrs\.|Miss|Ms\.)\s*/i,'').trim().split(/\s+/).map(w=>w[0]||'').slice(0,2).join('').toUpperCase() || '?';
}

const DOCTOR_STATUS_LABEL = { Active:'Active', On_Leave:'On Leave', Inactive:'Inactive' };
const DOCTOR_STATUS_BADGE = { Active:'badge-confirmed', On_Leave:'badge-pending', Inactive:'badge-cancelled' };

function renderDoctors(){
  const docs = store.doctors;
  const tbody = document.getElementById('doctors-table-body');
  tbody.innerHTML = docs.map(d => {
    const thumb = d.imageUrl
      ? `<img src="${d.imageUrl}" alt="" style="width:34px;height:34px;object-fit:cover;border-radius:50%;flex-shrink:0"/>`
      : `<div style="width:34px;height:34px;border-radius:50%;background:var(--navy);display:flex;align-items:center;justify-content:center;font-family:var(--ff-display);font-size:12px;font-weight:700;color:#fff;flex-shrink:0">${initialsOf(d.name)}</div>`;
    return `
    <tr>
      <td>
        <div style="display:flex;align-items:center;gap:10px">
          ${thumb}
          <div><strong style="font-size:13px">${d.name}</strong><div style="font-size:11px;color:var(--muted)">${d.qual||''}</div></div>
        </div>
      </td>
      <td style="font-size:12px">${d.specialty}</td>
      <td>${(DEPT_ICONS[d.dept]||'🏥')} ${d.dept}</td>
      <td style="font-size:12px;color:var(--muted)">${d.avail||'—'}</td>
      <td><span style="color:var(--gold)">★</span> ${d.rating||'N/A'}</td>
      <td><span class="badge ${DOCTOR_STATUS_BADGE[d.status] || 'badge-confirmed'}">${DOCTOR_STATUS_LABEL[d.status] || d.status || 'Active'}</span></td>
      <td>
        <div style="display:flex;gap:6px">
          <button class="btn-sm btn-outline" onclick="openEditDoctor(${d.id})">Edit</button>
          <button class="btn-sm btn-outline" onclick="toggleDoctorStatus(${d.id})">Toggle</button>
          <button class="btn-sm btn-danger" onclick="deleteDoctor(${d.id})">✕</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function setDoctorImagePreview(url){
  const img = document.getElementById('doc-image-preview');
  const placeholder = document.getElementById('doc-image-placeholder');
  const removeBtn = document.getElementById('doc-image-remove-btn');
  document.getElementById('doc-image-url').value = url || '';
  if (url){
    img.src = url; img.style.display = 'block';
    placeholder.style.display = 'none'; removeBtn.style.display = '';
  } else {
    img.src = ''; img.style.display = 'none';
    placeholder.style.display = ''; removeBtn.style.display = 'none';
  }
}

function removeDoctorImage(){
  setDoctorImagePreview('');
  document.getElementById('doc-image-file').value = '';
  document.getElementById('doc-image-status').textContent = '';
}

async function onDoctorImagePicked(e){
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const statusEl = document.getElementById('doc-image-status');
  statusEl.textContent = 'Uploading…';
  try {
    const token = sessionStorage.getItem('eld_token');
    const formData = new FormData();
    formData.append('image', file);
    const res = await fetch(API_BASE + '/media/upload', {
      method: 'POST',
      headers: token ? { 'Authorization': 'Bearer ' + token } : {},
      body: formData,
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || 'Upload failed.');
    setDoctorImagePreview(json.data.url);
    statusEl.textContent = 'Uploaded ✓';
    setTimeout(()=>{ statusEl.textContent=''; }, 2000);
  } catch(err){
    statusEl.textContent = '';
    toast('Image upload failed: ' + err.message, 'error');
    e.target.value = '';
  }
}

function resetDoctorForm(){
  document.getElementById('doc-id').value = '';
  ['doc-name','doc-specialty','doc-avail','doc-qual','doc-bio','doc-rating'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('doc-dept').value = '';
  document.getElementById('doc-status').value = 'Active';
  document.getElementById('doc-image-file').value = '';
  setDoctorImagePreview('');
}

function openAddDoctor(){
  resetDoctorForm();
  document.getElementById('doctor-modal-title').textContent = 'Add New Doctor';
  document.getElementById('doc-save-btn').textContent = 'Add Doctor';
  openModal('add-doctor-modal');
}

function openEditDoctor(id){
  const d = store.doctors.find(x=>x.id===id);
  if (!d) return;
  resetDoctorForm();
  document.getElementById('doc-id').value = d.id;
  document.getElementById('doc-name').value = d.name || '';
  document.getElementById('doc-specialty').value = d.specialty || '';
  document.getElementById('doc-dept').value = d.department || d.dept || '';
  document.getElementById('doc-avail').value = d.availability || d.avail || '';
  document.getElementById('doc-qual').value = d.qualifications || d.qual || '';
  document.getElementById('doc-bio').value = d.bio || '';
  document.getElementById('doc-rating').value = d.rating || '';
  document.getElementById('doc-status').value = d.status || 'Active';
  setDoctorImagePreview(d.imageUrl || '');
  document.getElementById('doctor-modal-title').textContent = 'Edit Doctor';
  document.getElementById('doc-save-btn').textContent = 'Save Changes';
  openModal('add-doctor-modal');
}

async function saveDoctor(){
  const id    = document.getElementById('doc-id').value;
  const name  = document.getElementById('doc-name').value.trim();
  const spec  = document.getElementById('doc-specialty').value.trim();
  const dept  = document.getElementById('doc-dept').value;
  const avail = document.getElementById('doc-avail').value.trim();
  const qual  = document.getElementById('doc-qual').value.trim();
  const bio   = document.getElementById('doc-bio').value.trim();
  const rating = document.getElementById('doc-rating').value.trim();
  const status = document.getElementById('doc-status').value;
  const imageUrl = document.getElementById('doc-image-url').value;
  if (!name||!spec||!dept){ toast('Name, specialty, and department are required.','error'); return; }
  const payload = {
    name, specialty: spec, department: dept,
    availability: avail || 'Mon-Fri',
    qualifications: qual || 'See profile',
    bio: bio || '',
    rating: rating || null,
    status,
    imageUrl: imageUrl || null,
  };
  try {
    if (id){
      const updated = await api.put('/doctors/' + id, payload);
      const idx = store.doctors.findIndex(d=>d.id===Number(id));
      if (idx!==-1) store.doctors[idx] = updated;
      toast('Doctor updated successfully.','success');
    } else {
      const newDoc = await api.post('/doctors', payload);
      store.doctors.push(newDoc);
      toast('Doctor added successfully.','success');
    }
    closeModal('add-doctor-modal');
    renderDoctors();
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

async function toggleDoctorStatus(id){
  const idx = store.doctors.findIndex(d=>d.id===id);
  if (idx===-1) return;
  const newStatus = store.doctors[idx].status==='Active'?'On_Leave':'Active';
  try {
    await api.put('/doctors/' + id, { status: newStatus });
    store.doctors[idx].status = newStatus;
    renderDoctors();
    toast('Status updated to ' + newStatus.replace('_',' ') + '.','info');
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

async function deleteDoctor(id){
  if (!confirm('Remove this doctor from the system?')) return;
  try {
    await api.delete('/doctors/' + id);
    store.doctors = store.doctors.filter(d=>d.id!==id);
    renderDoctors();
    toast('Doctor removed.','info');
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

// ══════════════════════════════════════════════
//  STAFF
// ══════════════════════════════════════════════
function renderStaff(){
  const members = store.staff;
  const tbody = document.getElementById('staff-table-body');
  if (!members.length){
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:28px">No staff members yet. Click "+ Add Staff" to create one.</td></tr>`;
    return;
  }
  tbody.innerHTML = [...members].sort((a,b)=>(b.sortOrder||0)-(a.sortOrder||0)).map(s => {
    const thumb = s.photoUrl
      ? `<img src="${s.photoUrl}" alt="" style="width:34px;height:34px;object-fit:cover;border-radius:50%;flex-shrink:0"/>`
      : `<div style="width:34px;height:34px;border-radius:50%;background:var(--navy);display:flex;align-items:center;justify-content:center;font-family:var(--ff-display);font-size:12px;font-weight:700;color:#fff;flex-shrink:0">${initialsOf(s.name)}</div>`;
    return `
    <tr>
      <td>
        <div style="display:flex;align-items:center;gap:10px">
          ${thumb}
          <strong style="font-size:13px">${s.name}</strong>
        </div>
      </td>
      <td style="font-size:12px">${s.role}</td>
      <td style="font-size:12px">${STAFF_DEPT_LABELS[s.dept] || s.dept}</td>
      <td><span class="badge ${s.status==='Active'?'badge-confirmed':'badge-cancelled'}">${s.status||'Active'}</span></td>
      <td>
        <div style="display:flex;gap:6px">
          <button class="btn-sm btn-outline" onclick="openEditStaff(${s.id})">Edit</button>
          <button class="btn-sm btn-outline" onclick="toggleStaffStatus(${s.id})">Toggle</button>
          <button class="btn-sm btn-danger" onclick="deleteStaff(${s.id})">✕</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function setStaffImagePreview(url){
  const img = document.getElementById('staff-image-preview');
  const placeholder = document.getElementById('staff-image-placeholder');
  const removeBtn = document.getElementById('staff-image-remove-btn');
  document.getElementById('staff-image-url').value = url || '';
  if (url){
    img.src = url; img.style.display = 'block';
    placeholder.style.display = 'none'; removeBtn.style.display = '';
  } else {
    img.src = ''; img.style.display = 'none';
    placeholder.style.display = ''; removeBtn.style.display = 'none';
  }
}

function removeStaffImage(){
  setStaffImagePreview('');
  document.getElementById('staff-image-file').value = '';
  document.getElementById('staff-image-status').textContent = '';
}

async function onStaffImagePicked(e){
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const statusEl = document.getElementById('staff-image-status');
  statusEl.textContent = 'Uploading…';
  try {
    const token = sessionStorage.getItem('eld_token');
    const formData = new FormData();
    formData.append('image', file);
    const res = await fetch(API_BASE + '/media/upload', {
      method: 'POST',
      headers: token ? { 'Authorization': 'Bearer ' + token } : {},
      body: formData,
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || 'Upload failed.');
    setStaffImagePreview(json.data.url);
    statusEl.textContent = 'Uploaded ✓';
    setTimeout(()=>{ statusEl.textContent=''; }, 2000);
  } catch(err){
    statusEl.textContent = '';
    toast('Image upload failed: ' + err.message, 'error');
    e.target.value = '';
  }
}

function resetStaffForm(){
  document.getElementById('staff-id').value = '';
  document.getElementById('staff-name').value = '';
  document.getElementById('staff-role').value = '';
  document.getElementById('staff-dept').value = 'management';
  document.getElementById('staff-status').value = 'Active';
  document.getElementById('staff-order').value = '0';
  document.getElementById('staff-image-file').value = '';
  setStaffImagePreview('');
}

function openAddStaff(){
  resetStaffForm();
  document.getElementById('staff-modal-title').textContent = 'Add Staff Member';
  document.getElementById('staff-save-btn').textContent = 'Add Staff';
  openModal('add-staff-modal');
}

function openEditStaff(id){
  const s = store.staff.find(x=>x.id===id);
  if (!s) return;
  resetStaffForm();
  document.getElementById('staff-id').value = s.id;
  document.getElementById('staff-name').value = s.name || '';
  document.getElementById('staff-role').value = s.role || '';
  document.getElementById('staff-dept').value = s.department || s.dept || 'management';
  document.getElementById('staff-status').value = s.status || 'Active';
  document.getElementById('staff-order').value = s.sortOrder || 0;
  setStaffImagePreview(s.photoUrl || '');
  document.getElementById('staff-modal-title').textContent = 'Edit Staff Member';
  document.getElementById('staff-save-btn').textContent = 'Save Changes';
  openModal('add-staff-modal');
}

async function saveStaff(){
  const id     = document.getElementById('staff-id').value;
  const name   = document.getElementById('staff-name').value.trim();
  const role   = document.getElementById('staff-role').value.trim();
  const dept   = document.getElementById('staff-dept').value;
  const status = document.getElementById('staff-status').value;
  const order  = parseInt(document.getElementById('staff-order').value, 10) || 0;
  const photoUrl = document.getElementById('staff-image-url').value;
  if (!name||!role||!dept){ toast('Name, role, and department are required.','error'); return; }
  const payload = { name, role, department: dept, status, sortOrder: order, photoUrl: photoUrl || null };
  try {
    if (id){
      const updated = await api.put('/staff/' + id, payload);
      const idx = store.staff.findIndex(s=>s.id===Number(id));
      if (idx!==-1) store.staff[idx] = updated;
      toast('Staff member updated successfully.','success');
    } else {
      const newStaff = await api.post('/staff', payload);
      store.staff.push(newStaff);
      toast('Staff member added successfully.','success');
    }
    closeModal('add-staff-modal');
    renderStaff();
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

async function toggleStaffStatus(id){
  const idx = store.staff.findIndex(s=>s.id===id);
  if (idx===-1) return;
  const newStatus = store.staff[idx].status==='Active'?'Inactive':'Active';
  try {
    await api.put('/staff/' + id, { status: newStatus });
    store.staff[idx].status = newStatus;
    renderStaff();
    toast('Status updated to ' + newStatus + '.','info');
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

async function deleteStaff(id){
  if (!confirm('Remove this staff member from the system?')) return;
  try {
    await api.delete('/staff/' + id);
    store.staff = store.staff.filter(s=>s.id!==id);
    renderStaff();
    toast('Staff member removed.','info');
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

// ══════════════════════════════════════════════
//  ADMIN ACCOUNTS (Super Admin only)
// ══════════════════════════════════════════════
function renderAdmins(){
  const tbody = document.getElementById('admins-table-body');
  if (!tbody) return;
  const admins = store.admins || [];
  if (!admins.length){
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:28px">No admin accounts found.</td></tr>`;
    return;
  }
  tbody.innerHTML = admins.map(a => `
    <tr>
      <td><strong style="font-size:13px">${escapeHtml(a.name)}</strong>${a.id===currentUser.id?' <span style="color:var(--muted);font-size:11px">(you)</span>':''}</td>
      <td style="font-size:12px">${escapeHtml(a.username)}</td>
      <td style="font-size:12px">${escapeHtml(a.role)}</td>
      <td>
        <span class="badge ${a.status==='Active'?'badge-confirmed':'badge-cancelled'}">${a.status}</span>
        ${a.mustChangePassword?' <span style="font-size:11px;color:var(--muted)">· pending first sign-in</span>':''}
      </td>
      <td>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn-sm btn-outline" onclick="openEditAdmin(${a.id})">Edit</button>
          <button class="btn-sm btn-outline" onclick="resetAdminPassword(${a.id})">Reset Password</button>
          ${a.id===currentUser.id ? '' : `<button class="btn-sm btn-danger" onclick="deleteAdmin(${a.id})">✕</button>`}
        </div>
      </td>
    </tr>`).join('');
}

function resetAdminForm(){
  document.getElementById('admin-id').value = '';
  document.getElementById('admin-name').value = '';
  document.getElementById('admin-username').value = '';
  document.getElementById('admin-username').disabled = false;
  document.getElementById('admin-role').value = 'Admin';
  document.getElementById('admin-status').value = 'Active';
  document.getElementById('admin-status-row').style.display = 'none';
  document.getElementById('admin-otp').value = '';
  document.getElementById('admin-otp-row').style.display = '';
}

// Random 10-character letters+digits password for the "Generate" buttons.
// Skips look-alike characters (0/O, 1/l/I) so it's easy to read out or retype.
function generateOneTimePassword(){
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = new Uint32Array(10);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}

function openAddAdmin(){
  resetAdminForm();
  document.getElementById('admin-modal-title').textContent = 'Add Admin Account';
  document.getElementById('admin-modal-sub').textContent = "Set a one-time password for them (or leave it blank to generate one) and share it securely. They'll be asked to set their own password on first sign-in.";
  document.getElementById('admin-save-btn').textContent = 'Add Admin';
  openModal('add-admin-modal');
}

function openEditAdmin(id){
  const a = (store.admins||[]).find(x=>x.id===id);
  if (!a) return;
  resetAdminForm();
  document.getElementById('admin-id').value = a.id;
  document.getElementById('admin-name').value = a.name || '';
  document.getElementById('admin-username').value = a.username || '';
  document.getElementById('admin-username').disabled = true; // username is fixed after creation
  document.getElementById('admin-role').value = a.role || 'Admin';
  document.getElementById('admin-status').value = a.status || 'Active';
  document.getElementById('admin-status-row').style.display = '';
  document.getElementById('admin-otp-row').style.display = 'none'; // passwords are changed via "Reset Password"
  document.getElementById('admin-modal-title').textContent = 'Edit Admin Account';
  document.getElementById('admin-modal-sub').textContent = "Update this account's name, role, or access.";
  document.getElementById('admin-save-btn').textContent = 'Save Changes';
  openModal('add-admin-modal');
}

async function saveAdmin(){
  const id       = document.getElementById('admin-id').value;
  const name     = document.getElementById('admin-name').value.trim();
  const username = document.getElementById('admin-username').value.trim();
  const role     = document.getElementById('admin-role').value;
  const status   = document.getElementById('admin-status').value;
  if (!name){ toast('Full name is required.','error'); return; }
  try {
    if (id){
      const updated = await api.put('/admins/' + id, { name, role, status });
      const idx = (store.admins||[]).findIndex(a=>a.id===Number(id));
      if (idx!==-1) store.admins[idx] = updated;
      if (Number(id) === currentUser.id){ currentUser.name = updated.name; currentUser.role = updated.role; initDashboard(); }
      toast('Admin account updated.','success');
      closeModal('add-admin-modal');
      renderAdmins();
      // Promoted to Super Admin just now and had no recovery code yet.
      if (updated.recoveryCode) showTempPassword(updated.name, null, updated.recoveryCode);
    } else {
      if (!username){ toast('Username is required.','error'); return; }
      const tempPassword = document.getElementById('admin-otp').value.trim();
      if (tempPassword && tempPassword.length < 8){ toast('The one-time password must be at least 8 characters.','error'); return; }
      const created = await api.post('/admins', { name, username, role, tempPassword: tempPassword || undefined });
      store.admins.push(created);
      toast('Admin account created.','success');
      closeModal('add-admin-modal');
      renderAdmins();
      showTempPassword(created.name, created.tempPassword, created.recoveryCode);
    }
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

function resetAdminPassword(id){
  const a = (store.admins||[]).find(x=>x.id===id);
  if (!a) return;
  document.getElementById('rp-admin-id').value = id;
  document.getElementById('rp-admin-name').textContent = a.name;
  document.getElementById('rp-otp').value = '';
  openModal('reset-admin-pw-modal');
}

async function confirmResetAdminPassword(){
  const id = Number(document.getElementById('rp-admin-id').value);
  const a = (store.admins||[]).find(x=>x.id===id);
  if (!a) return;
  const tempPassword = document.getElementById('rp-otp').value.trim();
  if (tempPassword && tempPassword.length < 8){ toast('The one-time password must be at least 8 characters.','error'); return; }
  const btn = document.getElementById('rp-confirm-btn');
  btn.disabled = true;
  try {
    const result = await api.put('/admins/' + id + '/reset-password', { tempPassword: tempPassword || undefined });
    a.mustChangePassword = true;
    closeModal('reset-admin-pw-modal');
    renderAdmins();
    showTempPassword(a.name, result.tempPassword);
  } catch(e) { toast('Error: ' + e.message, 'error'); }
  btn.disabled = false;
}

async function deleteAdmin(id){
  const a = (store.admins||[]).find(x=>x.id===id);
  if (!a) return;
  if (!confirm(`Remove ${a.name}'s admin account? They will no longer be able to sign in.`)) return;
  try {
    await api.delete('/admins/' + id);
    store.admins = store.admins.filter(x=>x.id!==id);
    renderAdmins();
    toast('Admin account removed.','info');
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

function showTempPassword(name, pass, recoveryCode){
  document.getElementById('tp-value').value = pass || '';
  document.getElementById('tp-value').closest('div').style.display = pass ? 'flex' : 'none';

  const block = document.getElementById('tp-recovery-block');
  if (recoveryCode) {
    document.getElementById('tp-recovery-value').value = recoveryCode;
    block.style.display = 'block';
  } else {
    block.style.display = 'none';
  }

  const safeName = escapeHtml(name);
  if (pass) {
    document.getElementById('tp-modal-title').textContent = 'Temporary Password';
    document.getElementById('tp-modal-sub').innerHTML = `Share this with <strong>${safeName}</strong> securely — it's shown only once. They'll be asked to set their own password the first time they sign in.`;
  } else {
    document.getElementById('tp-modal-title').textContent = 'Recovery Code';
    document.getElementById('tp-modal-sub').innerHTML = `<strong>${safeName}</strong> is now a Super Admin — no password change needed, but save their recovery code below. It's shown only once.`;
  }
  openModal('admin-temp-pass-modal');
}

function copyTempPassword(){
  const inp = document.getElementById('tp-value');
  inp.select();
  if (navigator.clipboard) {
    navigator.clipboard.writeText(inp.value).then(()=>toast('Copied to clipboard.','success')).catch(()=>{});
  }
}

function copyTempRecoveryCode(){
  const inp = document.getElementById('tp-recovery-value');
  inp.select();
  if (navigator.clipboard) {
    navigator.clipboard.writeText(inp.value).then(()=>toast('Copied to clipboard.','success')).catch(()=>{});
  }
}

async function regenerateRecoveryCode(){
  if (!confirm('Generate a new recovery code? Your current code will stop working immediately.')) return;
  try {
    const result = await api.put('/admins/me/recovery-code', {});
    showTempPassword(currentUser.name, null, result.recoveryCode);
  } catch(e) {
    toast('Error: ' + e.message, 'error');
  }
}

// ══════════════════════════════════════════════
//  MEDIA CENTER (News / Announcements / Gallery / Videos)
// ══════════════════════════════════════════════
let currentMediaCat = 'announcement';

function filterMedia(cat, btn){
  currentMediaCat = cat;
  document.querySelectorAll('.media-cat-tab').forEach(b=>b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderMedia(cat);
}

function renderMedia(cat){
  currentMediaCat = cat || currentMediaCat;
  const items = store.media.filter(m=>m.category===currentMediaCat)
    .sort((a,b)=> (b.sortOrder||0)-(a.sortOrder||0) || (b.id-a.id));
  const tbody = document.getElementById('media-table-body');
  if (!items.length){
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:28px">No items in this category yet. Click "+ Add Item" to create one.</td></tr>`;
    return;
  }
  tbody.innerHTML = items.map(m=>{
    const detail = currentMediaCat==='video' ? (m.duration||'—') : (currentMediaCat==='gallery' ? '' : (m.dateLabel||'—'));
    const statusBadgeClass = m.status==='Draft' ? 'badge-cancelled' : 'badge-confirmed';
    const thumb = m.imageUrl
      ? `<img src="${m.imageUrl}" alt="" style="width:38px;height:38px;object-fit:cover;border-radius:6px;flex-shrink:0"/>`
      : `<div style="width:38px;height:38px;border-radius:6px;background:var(--gold-pale,#f3ecd8);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">${m.icon||'—'}</div>`;
    return `
    <tr>
      <td>
        <div style="display:flex;align-items:center;gap:10px">
          ${thumb}
          <div><strong style="font-size:13px">${m.title}</strong>${m.tag?`<div style="font-size:11px;color:var(--muted)">${m.tag}</div>`:''}</div>
        </div>
      </td>
      <td style="font-size:12px;color:var(--muted)">${detail}</td>
      <td style="font-size:12px;color:var(--muted)">${m.sortOrder||0}</td>
      <td><span class="badge ${statusBadgeClass}">${m.status||'Published'}</span></td>
      <td>
        <div style="display:flex;gap:6px">
          <button class="btn-sm btn-outline" onclick="openEditMedia(${m.id})">Edit</button>
          <button class="btn-sm btn-outline" onclick="toggleMediaStatus(${m.id})">Toggle</button>
          <button class="btn-sm btn-danger" onclick="deleteMedia(${m.id})">✕</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function onMediaCategoryChange(){
  const cat = document.getElementById('med-category').value;
  const show = (id, on) => document.getElementById(id).style.display = on ? '' : 'none';

  show('med-row-body', cat==='announcement' || cat==='news' || cat==='video');
  show('med-row-image', true);
  show('med-row-video', cat==='video');
  document.getElementById('med-image-label').textContent = cat==='video' ? 'Thumbnail / Poster Image (optional)' : 'Photo';
  show('med-row-icon', cat==='announcement' || cat==='gallery');
  show('med-row-style', cat==='announcement' || cat==='news');
  show('med-row-tag', cat==='announcement' || cat==='news' || cat==='video');
  show('med-row-tagstyle', cat==='announcement');
  show('med-row-date', cat==='announcement' || cat==='news' || cat==='video');
  show('med-row-duration', cat==='video');

  // Filter style dropdown to options relevant to this category
  const styleSel = document.getElementById('med-style');
  const allowed = MEDIA_STYLE_OPTIONS[cat] || [];
  Array.from(styleSel.options).forEach(opt => { opt.style.display = allowed.includes(opt.value) ? '' : 'none'; });
  if (allowed.length && !allowed.includes(styleSel.value)) styleSel.value = allowed[0];

  // Field labels differ per category
  document.getElementById('med-title').placeholder = cat==='gallery' ? 'Photo caption' : (cat==='video' ? 'Video title' : 'Headline');
  document.getElementById('med-tag').placeholder = cat==='video' ? 'e.g. 🏥 Facility' : 'e.g. New, Recurring, Award';
}

function setMediaImagePreview(url){
  const img = document.getElementById('med-image-preview');
  const placeholder = document.getElementById('med-image-placeholder');
  const removeBtn = document.getElementById('med-image-remove-btn');
  document.getElementById('med-image-url').value = url || '';
  if (url){
    img.src = url;
    img.style.display = 'block';
    placeholder.style.display = 'none';
    removeBtn.style.display = '';
  } else {
    img.src = '';
    img.style.display = 'none';
    placeholder.style.display = '';
    removeBtn.style.display = 'none';
  }
}

function removeMediaImage(){
  setMediaImagePreview('');
  document.getElementById('med-image-file').value = '';
  document.getElementById('med-image-status').textContent = '';
}

function setMediaVideoUploaded(url){
  document.getElementById('med-video-uploaded-url').value = url || '';
  document.getElementById('med-video-uploaded-info').style.display = url ? 'flex' : 'none';
  if (url) document.getElementById('med-video-external').value = ''; // uploaded file takes precedence
}

function removeMediaVideo(){
  setMediaVideoUploaded('');
  document.getElementById('med-video-file').value = '';
  document.getElementById('med-video-status').textContent = '';
}

function onMediaVideoExternalChange(){
  // Typing an external link clears any previously uploaded file, since only one source is used.
  if (document.getElementById('med-video-external').value.trim()){
    document.getElementById('med-video-uploaded-url').value = '';
    document.getElementById('med-video-uploaded-info').style.display = 'none';
    document.getElementById('med-video-file').value = '';
  }
}

async function onMediaVideoPicked(e){
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const statusEl = document.getElementById('med-video-status');
  statusEl.textContent = 'Uploading video… this may take a moment.';
  try {
    const token = sessionStorage.getItem('eld_token');
    const formData = new FormData();
    formData.append('video', file);
    const res = await fetch(API_BASE + '/media/upload-video', {
      method: 'POST',
      headers: token ? { 'Authorization': 'Bearer ' + token } : {},
      body: formData,
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || 'Upload failed.');
    setMediaVideoUploaded(json.data.url);
    statusEl.textContent = 'Uploaded ✓';
    setTimeout(()=>{ statusEl.textContent=''; }, 2500);
  } catch(err){
    statusEl.textContent = '';
    toast('Video upload failed: ' + err.message, 'error');
    e.target.value = '';
  }
}

async function onMediaImagePicked(e){
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const statusEl = document.getElementById('med-image-status');
  statusEl.textContent = 'Uploading…';
  try {
    const token = sessionStorage.getItem('eld_token');
    const formData = new FormData();
    formData.append('image', file);
    const res = await fetch(API_BASE + '/media/upload', {
      method: 'POST',
      headers: token ? { 'Authorization': 'Bearer ' + token } : {},
      body: formData,
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || 'Upload failed.');
    setMediaImagePreview(json.data.url);
    statusEl.textContent = 'Uploaded ✓';
    setTimeout(()=>{ statusEl.textContent=''; }, 2000);
  } catch(err){
    statusEl.textContent = '';
    toast('Image upload failed: ' + err.message, 'error');
    e.target.value = '';
  }
}

function resetMediaForm(){
  document.getElementById('med-id').value = '';
  document.getElementById('med-category').value = 'announcement';
  document.getElementById('med-title').value = '';
  document.getElementById('med-body').value = '';
  document.getElementById('med-icon').value = '';
  document.getElementById('med-style').value = 'blue';
  document.getElementById('med-tag').value = '';
  document.getElementById('med-tagstyle').value = 'new';
  document.getElementById('med-date').value = '';
  document.getElementById('med-duration').value = '';
  document.getElementById('med-status').value = 'Published';
  document.getElementById('med-order').value = '0';
  document.getElementById('med-image-file').value = '';
  setMediaImagePreview('');
  document.getElementById('med-video-file').value = '';
  document.getElementById('med-video-external').value = '';
  setMediaVideoUploaded('');
  onMediaCategoryChange();
}

function openAddMedia(){
  resetMediaForm();
  document.getElementById('med-category').value = currentMediaCat || 'announcement';
  onMediaCategoryChange();
  document.getElementById('media-modal-title').textContent = 'Add Media Item';
  document.getElementById('med-save-btn').textContent = 'Add Item';
  document.getElementById('med-save-btn').setAttribute('onclick','saveMedia()');
  openModal('add-media-modal');
}

function openEditMedia(id){
  const m = store.media.find(x=>x.id===id);
  if (!m) return;
  resetMediaForm();
  document.getElementById('med-id').value = m.id;
  document.getElementById('med-category').value = m.category;
  document.getElementById('med-title').value = m.title || '';
  document.getElementById('med-body').value = m.body || '';
  document.getElementById('med-icon').value = m.icon || '';
  document.getElementById('med-style').value = m.style || 'blue';
  document.getElementById('med-tag').value = m.tag || '';
  document.getElementById('med-tagstyle').value = m.tagStyle || 'new';
  document.getElementById('med-date').value = m.dateLabel || '';
  document.getElementById('med-duration').value = m.duration || '';
  document.getElementById('med-status').value = m.status || 'Published';
  document.getElementById('med-order').value = m.sortOrder || 0;
  setMediaImagePreview(m.imageUrl || '');
  if (m.videoUrl && m.videoUrl.startsWith('/images/media-uploads/')){
    setMediaVideoUploaded(m.videoUrl);
  } else if (m.videoUrl){
    document.getElementById('med-video-external').value = m.videoUrl;
  }
  onMediaCategoryChange();
  document.getElementById('media-modal-title').textContent = 'Edit Media Item';
  document.getElementById('med-save-btn').textContent = 'Save Changes';
  openModal('add-media-modal');
}

async function saveMedia(){
  const id = document.getElementById('med-id').value;
  const category = document.getElementById('med-category').value;
  const title = document.getElementById('med-title').value.trim();
  if (!title){ toast('Title is required.','error'); return; }

  const uploadedVideo = document.getElementById('med-video-uploaded-url').value.trim();
  const externalVideo = document.getElementById('med-video-external').value.trim();

  const payload = {
    category,
    title,
    body: document.getElementById('med-body').value.trim(),
    icon: document.getElementById('med-icon').value.trim(),
    imageUrl: document.getElementById('med-image-url').value.trim(),
    videoUrl: uploadedVideo || externalVideo,
    style: document.getElementById('med-style').value,
    tag: document.getElementById('med-tag').value.trim(),
    tagStyle: document.getElementById('med-tagstyle').value,
    dateLabel: document.getElementById('med-date').value.trim(),
    duration: document.getElementById('med-duration').value.trim(),
    status: document.getElementById('med-status').value,
    sortOrder: parseInt(document.getElementById('med-order').value, 10) || 0,
  };

  try {
    if (id){
      const updated = await api.put('/media/' + id, payload);
      const idx = store.media.findIndex(x=>x.id===Number(id));
      if (idx!==-1) store.media[idx] = updated;
      toast('Media item updated.','success');
    } else {
      const created = await api.post('/media', payload);
      store.media.push(created);
      toast('Media item added.','success');
    }
    closeModal('add-media-modal');
    filterMedia(category, document.querySelector(`.media-cat-tab[data-cat="${category}"]`));
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

async function toggleMediaStatus(id){
  const idx = store.media.findIndex(m=>m.id===id);
  if (idx===-1) return;
  const newStatus = store.media[idx].status==='Draft' ? 'Published' : 'Draft';
  try {
    await api.put('/media/' + id, { status: newStatus });
    store.media[idx].status = newStatus;
    renderMedia(currentMediaCat);
    toast('Status set to ' + newStatus + '.','info');
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

async function deleteMedia(id){
  if (!confirm('Delete this media item? This cannot be undone.')) return;
  try {
    await api.delete('/media/' + id);
    store.media = store.media.filter(m=>m.id!==id);
    renderMedia(currentMediaCat);
    toast('Media item deleted.','info');
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

// ══════════════════════════════════════════════
//  DEPARTMENTS
// ══════════════════════════════════════════════
function renderDepartments(){
  const depts = [...store.departments].sort((a,b)=>(b.sortOrder||0)-(a.sortOrder||0));
  const grid = document.getElementById('dept-grid');
  if (!depts.length){
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--muted);padding:28px">No departments yet. Click "+ Add Department" to create one.</div>`;
    return;
  }
  const appts = store.appointments;
  grid.innerHTML = depts.map(d => {
    const cnt = appts.filter(a=>(a.department||a.dept)===d.name).length;
    const inactive = d.status === 'Inactive';
    return `
    <div style="background:#fff;border-radius:var(--radius-lg);border:1px solid var(--border);padding:22px;box-shadow:var(--shadow);${inactive?'opacity:.55':''}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div style="font-size:32px;margin-bottom:10px">${d.icon || '🏥'}</div>
        ${inactive ? `<span class="badge badge-cancelled">Inactive</span>` : ''}
      </div>
      <div style="font-family:var(--ff-display);font-size:16px;font-weight:700;color:var(--text);margin-bottom:4px">${d.name}</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:12px">${d.description || ''}</div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <span style="font-size:12px;font-weight:600;color:var(--text)">${d.count ?? 0} ${d.unit || 'Specialists'}</span>
        <span style="background:var(--gold-pale);color:var(--text);font-size:11px;font-weight:700;padding:3px 9px;border-radius:100px">${cnt} appts</span>
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn-sm btn-outline" style="flex:1" onclick="openEditDepartment(${d.id})">Edit</button>
        <button class="btn-sm btn-outline" onclick="toggleDepartmentStatus(${d.id})">Toggle</button>
        <button class="btn-sm btn-danger" onclick="deleteDepartment(${d.id})">✕</button>
      </div>
    </div>`;
  }).join('');
}

function resetDepartmentForm(){
  document.getElementById('dept-id').value = '';
  document.getElementById('dept-icon').value = '🏥';
  document.getElementById('dept-name').value = '';
  document.getElementById('dept-description').value = '';
  document.getElementById('dept-count').value = '0';
  document.getElementById('dept-unit').value = 'Specialists';
  document.getElementById('dept-status').value = 'Active';
  document.getElementById('dept-order').value = '0';
}

function openAddDepartment(){
  resetDepartmentForm();
  document.getElementById('dept-modal-title').textContent = 'Add Department';
  document.getElementById('dept-save-btn').textContent = 'Add Department';
  openModal('add-department-modal');
}

function openEditDepartment(id){
  const d = store.departments.find(x=>x.id===id);
  if (!d) return;
  resetDepartmentForm();
  document.getElementById('dept-id').value = d.id;
  document.getElementById('dept-icon').value = d.icon || '🏥';
  document.getElementById('dept-name').value = d.name || '';
  document.getElementById('dept-description').value = d.description || '';
  document.getElementById('dept-count').value = d.count ?? 0;
  document.getElementById('dept-unit').value = d.unit || 'Specialists';
  document.getElementById('dept-status').value = d.status || 'Active';
  document.getElementById('dept-order').value = d.sortOrder || 0;
  document.getElementById('dept-modal-title').textContent = 'Edit Department';
  document.getElementById('dept-save-btn').textContent = 'Save Changes';
  openModal('add-department-modal');
}

async function saveDepartment(){
  const id     = document.getElementById('dept-id').value;
  const icon   = document.getElementById('dept-icon').value.trim() || '🏥';
  const name   = document.getElementById('dept-name').value.trim();
  const description = document.getElementById('dept-description').value.trim();
  const count  = parseInt(document.getElementById('dept-count').value, 10) || 0;
  const unit   = document.getElementById('dept-unit').value.trim() || 'Specialists';
  const status = document.getElementById('dept-status').value;
  const order  = parseInt(document.getElementById('dept-order').value, 10) || 0;
  if (!name){ toast('Department name is required.','error'); return; }
  const payload = { name, icon, description, count, unit, status, sortOrder: order };
  try {
    if (id){
      const updated = await api.put('/departments/' + id, payload);
      const idx = store.departments.findIndex(d=>d.id===Number(id));
      if (idx!==-1) store.departments[idx] = updated;
      toast('Department updated successfully.','success');
    } else {
      const created = await api.post('/departments', payload);
      store.departments.push(created);
      toast('Department added successfully.','success');
    }
    closeModal('add-department-modal');
    renderDepartments();
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

async function toggleDepartmentStatus(id){
  const idx = store.departments.findIndex(d=>d.id===id);
  if (idx===-1) return;
  const newStatus = store.departments[idx].status==='Active' ? 'Inactive' : 'Active';
  try {
    await api.put('/departments/' + id, { status: newStatus });
    store.departments[idx].status = newStatus;
    renderDepartments();
    toast('Status updated to ' + newStatus + '.','info');
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

async function deleteDepartment(id){
  if (!confirm('Remove this department from the system?')) return;
  try {
    await api.delete('/departments/' + id);
    store.departments = store.departments.filter(d=>d.id!==id);
    renderDepartments();
    toast('Department removed.','info');
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

// ══════════════════════════════════════════════
//  JOB OPENINGS (Careers page "Current Openings" list)
// ══════════════════════════════════════════════
function renderOpenings(){
  const openings = [...store.openings].sort((a,b)=>(b.sortOrder||0)-(a.sortOrder||0));
  const tbody = document.getElementById('openings-table-body');
  if (!openings.length){
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:28px">No openings yet. Click "+ Add Opening" to create one.</td></tr>`;
    return;
  }
  tbody.innerHTML = openings.map(o => `
    <tr>
      <td><span style="margin-right:8px">${o.icon || '💼'}</span><strong style="font-size:13px">${o.title}</strong></td>
      <td><span class="badge ${o.status==='Open'?'badge-confirmed':'badge-cancelled'}">${o.status||'Open'}</span></td>
      <td style="font-size:12px">${o.sortOrder||0}</td>
      <td>
        <div style="display:flex;gap:6px">
          <button class="btn-sm btn-outline" onclick="openEditOpening(${o.id})">Edit</button>
          <button class="btn-sm btn-outline" onclick="toggleOpeningStatus(${o.id})">Toggle</button>
          <button class="btn-sm btn-danger" onclick="deleteOpening(${o.id})">✕</button>
        </div>
      </td>
    </tr>`).join('');
}

function resetOpeningForm(){
  document.getElementById('opening-id').value = '';
  document.getElementById('opening-icon').value = '💼';
  document.getElementById('opening-title').value = '';
  document.getElementById('opening-status').value = 'Open';
  document.getElementById('opening-order').value = '0';
}

function openAddOpening(){
  resetOpeningForm();
  document.getElementById('opening-modal-title').textContent = 'Add Job Opening';
  document.getElementById('opening-save-btn').textContent = 'Add Opening';
  openModal('add-opening-modal');
}

function openEditOpening(id){
  const o = store.openings.find(x=>x.id===id);
  if (!o) return;
  resetOpeningForm();
  document.getElementById('opening-id').value = o.id;
  document.getElementById('opening-icon').value = o.icon || '💼';
  document.getElementById('opening-title').value = o.title || '';
  document.getElementById('opening-status').value = o.status || 'Open';
  document.getElementById('opening-order').value = o.sortOrder || 0;
  document.getElementById('opening-modal-title').textContent = 'Edit Job Opening';
  document.getElementById('opening-save-btn').textContent = 'Save Changes';
  openModal('add-opening-modal');
}

async function saveOpening(){
  const id     = document.getElementById('opening-id').value;
  const icon   = document.getElementById('opening-icon').value.trim() || '💼';
  const title  = document.getElementById('opening-title').value.trim();
  const status = document.getElementById('opening-status').value;
  const order  = parseInt(document.getElementById('opening-order').value, 10) || 0;
  if (!title){ toast('Role title is required.','error'); return; }
  const payload = { title, icon, status, sortOrder: order };
  try {
    if (id){
      const updated = await api.put('/openings/' + id, payload);
      const idx = store.openings.findIndex(o=>o.id===Number(id));
      if (idx!==-1) store.openings[idx] = updated;
      toast('Opening updated successfully.','success');
    } else {
      const created = await api.post('/openings', payload);
      store.openings.push(created);
      toast('Opening added successfully.','success');
    }
    closeModal('add-opening-modal');
    renderOpenings();
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

async function toggleOpeningStatus(id){
  const idx = store.openings.findIndex(o=>o.id===id);
  if (idx===-1) return;
  const newStatus = store.openings[idx].status==='Open' ? 'Closed' : 'Open';
  try {
    await api.put('/openings/' + id, { status: newStatus });
    store.openings[idx].status = newStatus;
    renderOpenings();
    toast('Status updated to ' + newStatus + '.','info');
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

async function deleteOpening(id){
  if (!confirm('Remove this job opening from the system?')) return;
  try {
    await api.delete('/openings/' + id);
    store.openings = store.openings.filter(o=>o.id!==id);
    renderOpenings();
    toast('Opening removed.','info');
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

// ══════════════════════════════════════════════
//  TESTIMONIALS (Homepage "What Our Patients Say")
// ══════════════════════════════════════════════
function renderTestimonials(){
  const items = [...store.testimonials].sort((a,b)=>(b.sortOrder||0)-(a.sortOrder||0));
  const tbody = document.getElementById('testimonials-table-body');
  if (!items.length){
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:28px">No testimonials yet. Click "+ Add Testimonial" to create one.</td></tr>`;
    return;
  }
  tbody.innerHTML = items.map(t => `
    <tr>
      <td><strong style="font-size:13px">${escapeHtml(t.name)}</strong></td>
      <td style="font-size:12px;color:var(--muted)">${escapeHtml(t.role)||'—'}</td>
      <td style="color:var(--gold);white-space:nowrap">${'★'.repeat(t.rating||5)}${'☆'.repeat(5-(t.rating||5))}</td>
      <td style="max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px;color:var(--muted)">${escapeHtml(t.quote||t.text||'')}</td>
      <td><span class="badge ${t.status==='Published'?'badge-confirmed':'badge-cancelled'}">${t.status||'Published'}</span></td>
      <td style="font-size:12px">${t.sortOrder||0}</td>
      <td>
        <div style="display:flex;gap:6px">
          <button class="btn-sm btn-outline" onclick="openEditTestimonial(${t.id})">Edit</button>
          <button class="btn-sm btn-danger" onclick="deleteTestimonial(${t.id})">✕</button>
        </div>
      </td>
    </tr>`).join('');
}

function resetTestimonialForm(){
  document.getElementById('testimonial-id').value = '';
  document.getElementById('testimonial-name').value = '';
  document.getElementById('testimonial-role').value = '';
  document.getElementById('testimonial-rating').value = '5';
  document.getElementById('testimonial-status').value = 'Published';
  document.getElementById('testimonial-order').value = '0';
  document.getElementById('testimonial-quote').value = '';
}

function openAddTestimonial(){
  resetTestimonialForm();
  document.getElementById('testimonial-modal-title').textContent = 'Add Testimonial';
  document.getElementById('testimonial-save-btn').textContent = 'Add Testimonial';
  openModal('add-testimonial-modal');
}

function openEditTestimonial(id){
  const t = store.testimonials.find(x=>x.id===id);
  if (!t) return;
  resetTestimonialForm();
  document.getElementById('testimonial-id').value = t.id;
  document.getElementById('testimonial-name').value = t.name || '';
  document.getElementById('testimonial-role').value = t.role || '';
  document.getElementById('testimonial-rating').value = String(t.rating || 5);
  document.getElementById('testimonial-status').value = t.status || 'Published';
  document.getElementById('testimonial-order').value = t.sortOrder || 0;
  document.getElementById('testimonial-quote').value = t.quote || t.text || '';
  document.getElementById('testimonial-modal-title').textContent = 'Edit Testimonial';
  document.getElementById('testimonial-save-btn').textContent = 'Save Changes';
  openModal('add-testimonial-modal');
}

async function saveTestimonial(){
  const id     = document.getElementById('testimonial-id').value;
  const name   = document.getElementById('testimonial-name').value.trim();
  const role   = document.getElementById('testimonial-role').value.trim();
  const rating = parseInt(document.getElementById('testimonial-rating').value, 10) || 5;
  const status = document.getElementById('testimonial-status').value;
  const order  = parseInt(document.getElementById('testimonial-order').value, 10) || 0;
  const quote  = document.getElementById('testimonial-quote').value.trim();
  if (!name){ toast('Patient name is required.','error'); return; }
  if (!quote){ toast('Review text is required.','error'); return; }
  const payload = { name, role, rating, status, sortOrder: order, quote };
  try {
    if (id){
      const updated = await api.put('/testimonials/' + id, payload);
      const idx = store.testimonials.findIndex(t=>t.id===Number(id));
      if (idx!==-1) store.testimonials[idx] = updated;
      toast('Testimonial updated successfully.','success');
    } else {
      const created = await api.post('/testimonials', payload);
      store.testimonials.push(created);
      toast('Testimonial added successfully.','success');
    }
    closeModal('add-testimonial-modal');
    renderTestimonials();
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

async function deleteTestimonial(id){
  if (!confirm('Remove this testimonial from the homepage?')) return;
  try {
    await api.delete('/testimonials/' + id);
    store.testimonials = store.testimonials.filter(t=>t.id!==id);
    renderTestimonials();
    toast('Testimonial removed.','info');
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

// ── Overall Rating settings (leave-a-review sidebar) ─────────────────────────
function loadRatingSettingsForm(){
  const r = store.ratingSettings || {};
  document.getElementById('rating-score').value = r.score ?? '4.9';
  document.getElementById('rating-count-label').value = r.countLabel ?? 'Based on 340+ patient reviews';
  document.getElementById('rating-pct5').value = r.pct5 ?? 82;
  document.getElementById('rating-pct4').value = r.pct4 ?? 12;
  document.getElementById('rating-pct3').value = r.pct3 ?? 4;
  document.getElementById('rating-pct2').value = r.pct2 ?? 1;
  document.getElementById('rating-pct1').value = r.pct1 ?? 1;
}

async function saveRatingSettings(){
  const score      = document.getElementById('rating-score').value.trim();
  const countLabel = document.getElementById('rating-count-label').value.trim();
  const pct5 = document.getElementById('rating-pct5').value.trim();
  const pct4 = document.getElementById('rating-pct4').value.trim();
  const pct3 = document.getElementById('rating-pct3').value.trim();
  const pct2 = document.getElementById('rating-pct2').value.trim();
  const pct1 = document.getElementById('rating-pct1').value.trim();
  if (!score){ toast('Score is required.','error'); return; }
  try {
    const updated = await api.put('/settings/rating', { score, countLabel, pct5, pct4, pct3, pct2, pct1 });
    store.ratingSettings = updated;
    loadRatingSettingsForm();
    toast('Overall rating updated.','success');
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

// ══════════════════════════════════════════════
//  SETTINGS
// ══════════════════════════════════════════════
function saveSettings(){
  toast('Settings saved successfully.','success');
}

async function changePass(){
  const cur  = document.getElementById('cur-pass').value;
  const nw   = document.getElementById('new-pass').value;
  const conf = document.getElementById('conf-pass').value;
  if (!cur||!nw||!conf){ toast('Please fill all password fields.','error'); return; }
  if (nw!==conf){ toast('New passwords do not match.','error'); return; }
  if (nw.length < 8){ toast('Password must be at least 8 characters.','error'); return; }
  try {
    await api.put('/auth/change-password', { currentPassword: cur, newPassword: nw });
    ['cur-pass','new-pass','conf-pass'].forEach(id=>document.getElementById(id).value='');
    toast('Password updated successfully. Please log in again.','success');
    setTimeout(doLogout, 2000);
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

// ══════════════════════════════════════════════
//  MESSAGES (from the public "Send Us a Message" contact form)
// ══════════════════════════════════════════════
function renderMessages(){
  const msgs = store.messages;
  const tbody = document.getElementById('msg-table-body');
  if (msgs.length === 0){
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:36px;color:var(--muted)"><div style="font-size:28px;margin-bottom:8px">📭</div>No messages yet.</td></tr>';
    return;
  }
  tbody.innerHTML = msgs.slice().reverse().map((m,i) => `
    <tr style="${m.isRead ? '' : 'font-weight:600'}">
      <td style="color:var(--muted);font-size:12px">${msgs.length-i}</td>
      <td>${escapeHtml(m.name)||'—'}${m.isRead ? '' : ' <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--gold);margin-left:4px"></span>'}</td>
      <td style="font-size:12px">${escapeHtml(m.email)||'—'}</td>
      <td style="font-size:12px">${escapeHtml(m.subject)||'—'}</td>
      <td style="max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px;color:var(--muted)">${escapeHtml(m.message)||'—'}</td>
      <td style="font-size:12px;color:var(--muted)">${fmtDate(m.date||m.createdAt||m.id)}</td>
      <td style="white-space:nowrap">
        <button class="btn-sm btn-outline" onclick="viewMessage(${m.id})">View</button>
        <button class="btn-sm btn-danger" onclick="deleteMessage(${m.id})">✕</button>
      </td>
    </tr>`).join('');
}

async function viewMessage(id){
  const m = store.messages.find(x=>x.id===id); if (!m) return;
  document.getElementById('view-msg-body').innerHTML = `
    <div class="view-grid">
      ${vf('Name', `<span style="font-weight:600">${escapeHtml(m.name)||'—'}</span>`)}
      ${vf('Email', contactHtml(m.email))}
      ${vf('Subject', escapeHtml(m.subject)||'—')}
      ${vf('Received', fmtDate(m.date||m.createdAt||m.id))}
      ${vnote('Message', m.message, 'No message.')}
    </div>`;
  document.getElementById('view-msg-actions').innerHTML =
    `<a href="mailto:${encodeURIComponent(m.email||'')}" class="btn-sm btn-primary" style="display:inline-block;text-decoration:none">✉ Reply via Email</a>`;
  openModal('view-msg-modal');

  if (!m.isRead){
    try {
      await api.put('/messages/' + id, { isRead: true });
      m.isRead = true;
      renderMessages(); updateBadges();
    } catch(e) { /* non-critical; ignore silently */ }
  }
}

async function deleteMessage(id){
  if (!confirm('Delete this message?')) return;
  try {
    await api.delete('/messages/' + id);
    store.messages = store.messages.filter(m=>m.id!==id);
    renderMessages(); updateBadges();
    toast('Message deleted.','info');
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

// ══════════════════════════════════════════════
//  CSV EXPORT
// ══════════════════════════════════════════════
function exportCSV(type){
  let rows, filename, headers;
  if (type==='appointments'){
    headers = ['Ref','Patient Name','Phone','Email','Department','Date','Type','Status','Symptoms','Submitted'];
    rows = store.appointments.map(a=>[`#ELD-${String(a.id).slice(-4).padStart(4,'0')}`,a.name,a.phone||'',a.email||'',a.dept,a.date||'',a.type||'',a.status||'Pending',a.symptoms||a.notes||'',fmtDate(a.created||a.id)]);
    filename = 'ELD_Appointments.csv';
  } else if (type==='cvs'){
    headers = ['#','Full Name','Phone','Email','Department','Degree','Experience','Cover Note','Applied On'];
    rows = store.cvs.map((c,i)=>[i+1,c.name,c.phone||'',c.email||'',c.dept||'',c.degree||'',c.experience||'',c.note||'',fmtDate(c.date||c.id)]);
    filename = 'ELD_CV_Applications.csv';
  } else if (type==='feedbacks'){
    headers = ['#','Name','Phone / Email','Rating','Would Recommend','Comment','Date'];
    rows = store.feedbacks.map((f,i)=>[i+1,f.name||'Anonymous',f.contact||'',f.rating||'',recommendLabel(f.wouldRecommend).replace('—',''),f.comment||'',fmtDate(f.date||f.id)]);
    filename = 'ELD_Feedbacks.csv';
  } else if (type==='messages'){
    headers = ['#','Name','Email','Subject','Message','Date'];
    rows = store.messages.map((m,i)=>[i+1,m.name||'',m.email||'',m.subject||'',m.message||'',fmtDate(m.date||m.createdAt||m.id)]);
    filename = 'ELD_Messages.csv';
  }
  const csvSafe = v => {
    let s = String(v ?? '');
    // Neutralize CSV/formula injection: Excel/Sheets treat a leading =, +, -,
    // @, tab, or CR as the start of a formula when the file is opened there.
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const csv = [headers,...rows].map(r=>r.map(csvSafe).join(',')).join('\n');
  const blob = new Blob([csv],{type:'text/csv'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href=url; a.download=filename; a.click();
  URL.revokeObjectURL(url);
  toast(`${filename} exported.`,'success');
}

// ══════════════════════════════════════════════
//  PANEL NAVIGATION
// ══════════════════════════════════════════════
const PANEL_LABELS = {
  overview:'Overview',appointments:'Appointments',cvs:'CV Applications',
  feedbacks:'Feedbacks',messages:'Messages',doctors:'Doctors',staff:'Staff',departments:'Departments',
  openings:'Job Openings',
  media:'Media Center',testimonials:'Testimonials',settings:'Settings',admins:'Admin Accounts'
};

// ══════════════════════════════════════════════
//  MOBILE SIDEBAR (hamburger + backdrop)
// ══════════════════════════════════════════════
function toggleMobileSidebar(){
  document.getElementById('sidebar').classList.toggle('mobile-open');
  document.getElementById('sidebar-backdrop').classList.toggle('open');
}
function closeMobileSidebar(){
  document.getElementById('sidebar').classList.remove('mobile-open');
  document.getElementById('sidebar-backdrop').classList.remove('open');
}

function showPanel(name){
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  document.getElementById('panel-'+name).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n=>{ if(n.getAttribute('onclick')&&n.getAttribute('onclick').includes("'"+name+"'")) n.classList.add('active'); });
  document.getElementById('page-title').textContent = PANEL_LABELS[name]||name;
  document.getElementById('breadcrumb-current').textContent = PANEL_LABELS[name]||name;
  closeMobileSidebar(); // picking a section on mobile should return you to the content

  // Refresh panel data
  if (name==='overview') loadOverview();
  if (name==='appointments'){ renderAppts(store.appointments); }
  if (name==='cvs'){ buildCVDeptFilter(); filterCVs(); }
  if (name==='feedbacks') renderFeedbacks();
  if (name==='messages') renderMessages();
  if (name==='doctors') renderDoctors();
  if (name==='staff') renderStaff();
  if (name==='departments') renderDepartments();
  if (name==='openings') renderOpenings();
  if (name==='media'){
    const activeTab = document.querySelector('.media-cat-tab.active');
    renderMedia(activeTab ? activeTab.dataset.cat : 'announcement');
  }
  if (name==='testimonials'){ renderTestimonials(); loadRatingSettingsForm(); }
  if (name==='admins') renderAdmins();
}

// ══════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════
function openModal(id){ document.getElementById(id).classList.add('open'); }
function closeModal(id){ document.getElementById(id).classList.remove('open'); }

// Close modal on overlay click
document.querySelectorAll('.modal-overlay').forEach(m=>m.addEventListener('click',function(e){ if(e.target===this) this.classList.remove('open'); }));

function statusBadge(status){
  const map = {Pending:'badge-pending',Confirmed:'badge-confirmed',Completed:'badge-completed',Cancelled:'badge-cancelled'};
  return `<span class="badge ${map[status]||'badge-pending'}">${status}</span>`;
}

function fmtDate(d){
  if (!d) return '—';
  const dt = typeof d === 'number' ? new Date(d) : new Date(d);
  if (isNaN(dt)) return String(d);
  return dt.toLocaleDateString('en-NG',{day:'numeric',month:'short',year:'numeric'});
}

function timeAgo(d){
  if (!d) return '';
  const ms = Date.now() - (typeof d==='number'?d:new Date(d).getTime());
  const m = Math.floor(ms/60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m/60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h/24)}d ago`;
}

function toast(msg, type='info'){
  const el = document.getElementById('toast');
  const inner = document.getElementById('toast-inner');
  const colors = {success:'#1D4ED8',error:'#C0392B',info:'#1D4ED8'};
  inner.style.background = colors[type]||colors.info;
  inner.style.color = '#fff';
  inner.innerHTML = (type==='success'?'✅':type==='error'?'❌':'ℹ️') + ' ' + msg;
  el.style.display='block';
  clearTimeout(el._t);
  el._t = setTimeout(()=>el.style.display='none', 3500);
}

// Keyboard shortcut: press Enter on login
document.addEventListener('keydown', e=>{
  if (e.key==='Enter' && document.getElementById('login-screen').style.display!=='none'){
    const focused = document.activeElement;
    if (focused.id==='login-user'||focused.id==='login-pass') doLogin();
  }
});
