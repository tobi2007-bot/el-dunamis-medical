// ── CV / Careers Submission ──

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Non-clinical career tracks that sit alongside the admin-managed clinical
// departments — kept as a fixed tail so applicants can still apply to these
// even though they aren't part of the "Our Departments" homepage list.
const CAREERS_EXTRA_CATEGORIES = ['Radiology & Diagnostics', 'Pharmacy', 'Nursing', 'Medical Laboratory', 'Administration & Management', 'Other'];

/* ── Department options — loaded live from the admin-managed list ── */
async function loadCvDeptOptions() {
  const sel = document.getElementById('cv-dept');
  if (!sel) return;
  try {
    const res = await api.get('/departments?limit=200');
    const active = (res.departments || [])
      .filter(d => (d.status || 'Active') !== 'Inactive')
      .sort((a, b) => (b.sortOrder || 0) - (a.sortOrder || 0));
    if (!active.length) return; // keep the static fallback options already in the HTML
    const current = sel.value;
    const options = active.map(d => d.name).concat(CAREERS_EXTRA_CATEGORIES);
    sel.innerHTML = '<option value="">— Choose a department —</option>' +
      options.map(name => `<option>${escapeHtml(name)}</option>`).join('');
    if (current && options.includes(current)) sel.value = current;
  } catch (e) {
    // API unreachable — leave the built-in static option list in place
  }
}
loadCvDeptOptions();

/* ── Current Openings — loaded live from the admin-managed list ── */
async function loadOpenings() {
  const wrap = document.getElementById('openingsList');
  if (!wrap) return;
  try {
    const res = await api.get('/openings?limit=200');
    const active = (res.openings || [])
      .filter(o => (o.status || 'Open') !== 'Closed')
      .sort((a, b) => (b.sortOrder || 0) - (a.sortOrder || 0));
    if (!active.length) {
      wrap.innerHTML = 'No openings listed right now — feel free to submit your CV anyway.';
      return;
    }
    wrap.innerHTML = active.map(o => `${escapeHtml(o.icon || '💼')} ${escapeHtml(o.title)}`).join('<br>\n          ');
  } catch (e) {
    wrap.innerHTML = 'Could not load current openings right now.';
  }
}
loadOpenings();

// ── Résumé file handling ──
let selectedResumeFile = null;

function onResumePicked(event) {
  const file = event.target.files && event.target.files[0];
  const status = document.getElementById('cv-resume-status');
  if (!file) { selectedResumeFile = null; status.textContent = 'PDF or Word document, up to 5MB.'; return; }

  const okExt = /\.(pdf|doc|docx)$/i.test(file.name);
  if (!okExt) {
    selectedResumeFile = null;
    event.target.value = '';
    status.textContent = 'Please choose a PDF or Word (.doc/.docx) file.';
    status.style.color = '#C0392B';
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    selectedResumeFile = null;
    event.target.value = '';
    status.textContent = 'That file is over 5MB — please choose a smaller one.';
    status.style.color = '#C0392B';
    return;
  }
  selectedResumeFile = file;
  status.textContent = `Selected: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)`;
  status.style.color = '';
}

// Uploads the résumé ahead of the main CV submission and returns a reference
// {resumeFile, resumeOriginalName} to attach to the /api/cvs POST body.
// Not a JSON call (it's multipart), so it bypasses the shared `api` helper.
async function uploadResumeFile(file) {
  const formData = new FormData();
  formData.append('resume', file);
  const res = await fetch(API_BASE + '/cvs/upload-resume', { method: 'POST', body: formData });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || 'Résumé upload failed.');
  return json.data;
}

async function submitCV() {
  const name   = document.getElementById('cv-name').value.trim();
  const phone  = document.getElementById('cv-phone').value.trim();
  const email  = document.getElementById('cv-email').value.trim();
  const dept   = document.getElementById('cv-dept').value;
  const degree = document.getElementById('cv-degree').value;
  const exp    = document.getElementById('cv-exp').value;
  const note   = document.getElementById('cv-note').value.trim();

  if (!name || !phone || !email || !dept || !degree || !exp) {
    alert('Please fill in all required fields (marked with *).');
    return;
  }
  if (!selectedResumeFile) {
    alert('Please attach your résumé (PDF or Word document).');
    return;
  }
  // Basic email check
  if (!/\S+@\S+\.\S+/.test(email)) {
    alert('Please enter a valid email address.');
    return;
  }

  const btn = document.querySelector('#careers .form-submit');
  btn.disabled = true;
  btn.textContent = 'Uploading résumé…';

  let resumeRef;
  try {
    resumeRef = await uploadResumeFile(selectedResumeFile);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Submit';
    alert('Sorry, your résumé could not be uploaded: ' + err.message);
    return;
  }

  btn.textContent = 'Submitting…';

  // Generate a warm AI acknowledgement
  let aiMsg = '';
  try {
    const result = await api.post('/chat', {
      max_tokens: 120,
      system: 'You are the HR officer at EL DUNAMIS Medical Centre, Lagos. Write a warm, professional 2-sentence acknowledgement for a job application. Mention the department and the applicant\'s first name. Sign off as "EL DUNAMIS Medical Centre HR Team".',
      messages: [{
        role: 'user',
        content: `Applicant: ${name} | Department: ${dept} | Degree: ${degree} | Experience: ${exp}`
      }]
    });
    aiMsg = result.reply || '';
  } catch(e) { aiMsg = ''; }

  // ── Send CV to backend API ────────────────────────────────────────────────
  try {
    await api.post('/cvs', {
      name, phone, email,
      departmentOfInterest: dept,
      degree,
      experienceYears: parseInt(exp) || 0,
      coverNote: note || undefined,
      resumeFile: resumeRef.resumeFile,
      resumeOriginalName: resumeRef.resumeOriginalName,
    });
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Submit';
    alert('Sorry, something went wrong: ' + err.message);
    return;
  }

  btn.disabled = false;
  btn.textContent = 'Submit';

  // Show success
  document.getElementById('cv-form-fields').style.display = 'none';
  document.getElementById('cv-success-msg').innerHTML =
    (aiMsg ? escapeHtml(aiMsg) : '') || `Thank you, ${name.split(' ')[0]}! We have received your application, résumé included, for the <strong>${dept}</strong> department and will be in touch if a suitable opening arises.`;
  document.getElementById('cv-success-box').style.display = 'block';
}

function resetCVForm() {
  ['cv-name','cv-phone','cv-email','cv-note'].forEach(id => { document.getElementById(id).value = ''; });
  ['cv-dept','cv-degree','cv-exp'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('cv-resume-file').value = '';
  document.getElementById('cv-resume-status').textContent = 'PDF or Word document, up to 5MB.';
  document.getElementById('cv-resume-status').style.color = '';
  selectedResumeFile = null;
  document.getElementById('cv-form-fields').style.display = 'block';
  document.getElementById('cv-success-box').style.display = 'none';
}

// Footer copyright year — keeps "© YYYY" current automatically, no manual edits needed.
(function () {
  const el = document.getElementById("copyright-year");
  if (el) el.textContent = new Date().getFullYear();
})();
