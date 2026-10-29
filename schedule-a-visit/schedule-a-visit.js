document.getElementById('apptdate').min = new Date().toISOString().split('T')[0];

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  /* ── Department options — loaded live from the admin-managed list ── */
  async function loadDepartmentOptions() {
    const sel = document.getElementById('department');
    if (!sel) return;
    try {
      const res = await api.get('/departments?limit=200');
      const active = (res.departments || [])
        .filter(d => (d.status || 'Active') !== 'Inactive')
        .sort((a, b) => (b.sortOrder || 0) - (a.sortOrder || 0));
      if (!active.length) return; // keep the static fallback options already in the HTML
      const current = sel.value;
      sel.innerHTML = '<option value="">Select department</option>' +
        active.map(d => `<option>${escapeHtml(d.name)}</option>`).join('');
      if (current && active.some(d => d.name === current)) sel.value = current;
    } catch (e) {
      // API unreachable — leave the built-in static option list in place
    }
  }
  loadDepartmentOptions();

  function selectType(el, type) {
    document.querySelectorAll('.consult-type').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    document.getElementById('consult-type-input').value = type;
  }

  async function submitForm() {
    const fname    = document.getElementById('fname').value.trim();
    const lname    = document.getElementById('lname').value.trim();
    const phone    = document.getElementById('phone').value.trim();
    const dept     = document.getElementById('department').value;
    const date     = document.getElementById('apptdate').value;
    const type     = document.getElementById('consult-type-input').value;
    const symptoms = document.getElementById('symptoms').value.trim();

    if (!fname || !lname || !phone || !dept || !date) {
      alert('Please fill in all required fields (marked with *).');
      return;
    }

    const btn = document.querySelector('.form-submit');
    btn.disabled = true;
    btn.textContent = 'Processing…';

    const d = new Date(date + 'T00:00:00');
    const niceDateStr = d.toLocaleDateString('en-NG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    // ── Send to backend API ──────────────────────────────────────────────────
    const consultTypeMap = {
      'In-Person Consultation': 'In-Person',
      'Telemedicine Consultation': 'Teleconsult',
      'Home Visit': 'In-Person',
      'Follow-Up Appointment': 'In-Person'
    };
    const email = document.getElementById('email').value.trim();
    try {
      await api.post('/appointments', {
        patientName: fname + ' ' + lname,
        phone,
        email: email || undefined,
        department: dept,
        preferredDate: new Date(date + 'T00:00:00').toISOString(),
        consultationType: consultTypeMap[type] || 'In-Person',
        symptoms: symptoms || undefined,
      });
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Book Appointment';
      alert('Sorry, something went wrong: ' + err.message);
      return;
    }

    btn.disabled = false;
    btn.textContent = 'Book Appointment';

    const modalContent = document.getElementById('modal-ai-note');
    if (modalContent) modalContent.textContent = `Thank you, ${fname}! We've received your ${dept} appointment request for ${niceDateStr}. We will confirm within 2 hours via phone or email.`;

    document.getElementById('modal').classList.add('open');
  }

  function closeModal() {
    document.getElementById('modal').classList.remove('open');
    ['fname','lname','phone','email','department','apptdate','symptoms'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    // Reset consultation-type selector back to the default (In-Person)
    document.querySelectorAll('.consult-type').forEach((t, i) => t.classList.toggle('active', i === 0));
    document.getElementById('consult-type-input').value = 'In-Person Consultation';
  }

  document.getElementById('modal').addEventListener('click', function(e) {
    if (e.target === this) closeModal();
  });

  document.querySelectorAll('.mobile-menu a').forEach(function(a) {
    a.addEventListener('click', function() {
      document.querySelector('.mobile-menu').classList.remove('open');
    });
  });
