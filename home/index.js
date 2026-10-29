(function() {
  var slides = document.querySelectorAll('#heroCarouselTrack .hero-carousel-slide');
  var dotsWrap = document.getElementById('heroCarouselDots');
  var progressBar = document.getElementById('heroCarouselProgressBar');
  var current = 0;
  var timer;
  var DURATION = 5000;

  slides.forEach(function(_, i) {
    var b = document.createElement('button');
    if (i === 0) b.className = 'is-active';
    b.setAttribute('aria-label', 'Go to slide ' + (i + 1));
    b.addEventListener('click', function() { goTo(i); restart(); });
    dotsWrap.appendChild(b);
  });
  var dots = dotsWrap.querySelectorAll('button');

  function goTo(i) {
    slides[current].classList.remove('is-active');
    dots[current].classList.remove('is-active');
    current = i;
    slides[current].classList.add('is-active');
    dots[current].classList.add('is-active');
    progressBar.style.animation = 'none';
    void progressBar.offsetWidth;
    progressBar.style.animation = 'heroCarouselProgress ' + DURATION + 'ms linear';
  }

  function next() { goTo((current + 1) % slides.length); }

  function restart() {
    clearInterval(timer);
    timer = setInterval(next, DURATION);
  }

  if (slides.length) { restart(); }
})();

;

  /* ── Doctors & Staff — loaded live from the admin-managed API ── */
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  function initials(name) {
    return String(name || '').replace(/^(Dr\.|Mr\.|Mrs\.|Miss|Ms\.)\s*/i, '')
      .trim().split(/\s+/).map(function(w){ return w[0] || ''; }).slice(0, 2).join('').toUpperCase() || '?';
  }

  // Hero "Doctors" stat mirrors the number of Active doctors in the admin portal.
  function updateDoctorCount(n) {
    var stat = document.getElementById('hero-doctors-stat');
    if (!stat) return;
    if (n > 0) {
      document.getElementById('hero-doctors-count').textContent = String(n);
      document.getElementById('hero-doctors-label').textContent = n === 1 ? 'Doctor' : 'Doctors';
      stat.style.display = '';
    } else {
      stat.style.display = 'none';
    }
  }

  function renderDoctorsGrid(doctors) {
    var grid = document.getElementById('doctorsGrid');
    if (!grid) return;
    var active = (doctors || []).filter(function(d){ return (d.status || 'Active') !== 'Inactive'; });
    updateDoctorCount(active.length);
    if (!active.length) {
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:30px;color:var(--text-muted)">Doctor information coming soon.</div>';
      return;
    }
    grid.innerHTML = active.map(function(d) {
      var img = d.imageUrl
        ? '<img src="' + escapeHtml(d.imageUrl) + '" alt="' + escapeHtml(d.name) + ' — ' + escapeHtml(d.specialty) + ', EL DUNAMIS Medical Centre" />'
        : '<div class="doctor-avatar">' + initials(d.name) + '</div>';
      var badge = d.department || d.dept || '';
      return (
        '<div class="doctor-card">' +
          '<div class="doctor-img">' + img +
            (badge ? '<span class="doctor-badge">' + escapeHtml(badge) + '</span>' : '') +
          '</div>' +
          '<div class="doctor-info">' +
            '<h3>' + escapeHtml(d.name) + '</h3>' +
            '<div class="specialty">' + escapeHtml(d.specialty || '') + '</div>' +
            (d.bio ? '<p>' + escapeHtml(d.bio) + '</p>' : '') +
            '<div class="doctor-meta"><span>📅 ' + escapeHtml(d.availability || d.avail || 'Mon – Fri') + '</span></div>' +
            '<a href="../schedule-a-visit/schedule-a-visit.html" class="doc-btn">Book Appointment</a>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  function renderStaffGrid(staff) {
    var grid = document.getElementById('staffGrid');
    if (!grid) return;
    var active = (staff || []).filter(function(s){ return (s.status || 'Active') !== 'Inactive'; })
      .sort(function(a, b){ return (b.sortOrder || 0) - (a.sortOrder || 0); });
    if (!active.length) {
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:30px;color:var(--text-muted)">Staff directory coming soon.</div>';
      return;
    }
    grid.innerHTML = active.map(function(s) {
      var dept = s.department || s.dept || '';
      var photo = s.photoUrl
        ? '<img src="' + escapeHtml(s.photoUrl) + '" alt="' + escapeHtml(s.name) + '" />'
        : '<div class="staff-photo-placeholder" style="cursor:default"><span style="font-size:20px;font-weight:700">' + initials(s.name) + '</span></div>';
      return (
        '<div class="staff-card" data-dept="' + escapeHtml(dept) + '">' +
          '<div class="staff-photo">' + photo + '</div>' +
          '<div class="staff-info">' +
            '<h3>' + escapeHtml(s.name) + '</h3>' +
            '<div class="staff-role">' + escapeHtml(s.role) + '</div>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  function renderDepartmentsGrid(depts) {
    var grid = document.getElementById('deptGrid');
    if (!grid) return;
    var active = (depts || []).filter(function(d){ return (d.status || 'Active') !== 'Inactive'; })
      .sort(function(a, b){ return (b.sortOrder || 0) - (a.sortOrder || 0); });
    var sub = document.getElementById('deptSectionSub');
    if (sub) {
      sub.textContent = active.length
        ? active.length + ' departments staffed by experienced consultants and supported by modern equipment.'
        : 'Departments staffed by experienced consultants and supported by modern equipment.';
    }
    if (!active.length) {
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:30px;color:var(--text-muted)">Department information coming soon.</div>';
      return;
    }
    grid.innerHTML = active.map(function(d) {
      return (
        '<div class="dept-card">' +
          '<div class="dept-icon">' + escapeHtml(d.icon || '🏥') + '</div>' +
          '<h4>' + escapeHtml(d.name) + '</h4>' +
          (d.description ? '<p>' + escapeHtml(d.description) + '</p>' : '') +
          '<span class="dept-count">' + escapeHtml(String(d.count ?? 0)) + ' ' + escapeHtml(d.unit || 'Specialists') + '</span>' +
        '</div>'
      );
    }).join('');
  }

  function renderTestimonialsGrid(items) {
    var grid = document.getElementById('reviews-container');
    if (!grid) return;
    var published = (items || []).filter(function(t){ return (t.status || 'Published') !== 'Draft'; })
      .sort(function(a, b){ return (b.sortOrder || 0) - (a.sortOrder || 0); })
      .slice(0, 3);
    if (!published.length) {
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:30px;color:var(--text-muted)">Patient feedback coming soon.</div>';
      return;
    }
    grid.innerHTML = published.map(function(t) {
      var stars = Math.max(0, Math.min(5, t.rating || 5));
      return (
        '<div class="testimonial">' +
          '<div class="testimonial-stars">' + '★'.repeat(stars) + '</div>' +
          '<p class="testimonial-text">"' + escapeHtml(t.quote || t.text || '') + '"</p>' +
          '<div class="testimonial-author">' +
            '<div class="author-avatar">' + escapeHtml(initials(t.name)) + '</div>' +
            '<div class="author-info"><div class="name">' + escapeHtml(t.name) + '</div><div class="role">' + escapeHtml(t.role || '') + '</div></div>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  async function loadDoctorsAndStaff() {
    try {
      var doctorsRes = await api.get('/doctors?limit=200');
      renderDoctorsGrid(doctorsRes.doctors || []);
    } catch (e) {
      var g = document.getElementById('doctorsGrid');
      if (g) g.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:30px;color:var(--text-muted)">Could not load doctor information right now.</div>';
    }
    try {
      var staffRes = await api.get('/staff?limit=200');
      renderStaffGrid(staffRes.staff || []);
    } catch (e) {
      var g2 = document.getElementById('staffGrid');
      if (g2) g2.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:30px;color:var(--text-muted)">Could not load staff information right now.</div>';
    }
    try {
      var deptRes = await api.get('/departments?limit=200');
      renderDepartmentsGrid(deptRes.departments || []);
    } catch (e) {
      var g3 = document.getElementById('deptGrid');
      if (g3) g3.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:30px;color:var(--text-muted)">Could not load department information right now.</div>';
    }
    try {
      var testRes = await api.get('/testimonials?limit=200');
      renderTestimonialsGrid(testRes.testimonials || []);
    } catch (e) {
      var g4 = document.getElementById('reviews-container');
      if (g4) g4.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:30px;color:var(--text-muted)">Could not load patient feedback right now.</div>';
    }
  }
  loadDoctorsAndStaff();

  /* ── Staff department filter ── */
  function filterStaff(dept, btn) {
    document.querySelectorAll('.staff-tab').forEach(function(t){ t.classList.remove('active'); });
    btn.classList.add('active');
    document.querySelectorAll('#staffGrid .staff-card').forEach(function(card) {
      card.style.display = (dept === 'all' || card.dataset.dept === dept) ? '' : 'none';
    });
  }

;


  // Close mobile menu when any link clicked
  document.querySelectorAll('.mobile-menu a').forEach(function(a){
    a.addEventListener('click', function(){
      document.querySelector('.mobile-menu').classList.remove('open');
      var btn = document.getElementById('hamburger-btn');
      if(btn) btn.classList.remove('is-open');
    });
  });




  // ── Contact Form ──
  async function submitContact() {
    const name    = document.getElementById('contact-name').value.trim();
    const email   = document.getElementById('contact-email').value.trim();
    const subject = document.getElementById('contact-subject').value.trim();
    const message = document.getElementById('contact-message').value.trim();
    if (!name || !email || !message) {
      alert('Please fill in your name, email, and message.');
      return;
    }
    const btn = document.getElementById('contact-submit-btn');
    btn.disabled = true;
    btn.textContent = 'Sending…';

    // ── Send message to backend API ───────────────────────────────────────────
    try {
      await api.post('/messages', {
        name, email,
        subject: subject || 'General Inquiry',
        message
      });
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Send Message';
      alert('Sorry, something went wrong: ' + err.message);
      return;
    }

    btn.disabled = false;
    btn.textContent = 'Send Message';
    document.getElementById('contact-success-msg').textContent = `Thank you, ${name}! We've received your message and will respond within 24 hours. For urgent matters, call 09024543941.`;
    document.getElementById('contact-success-box').style.display = 'block';
    document.getElementById('contact-form-fields').style.display = 'none';
  }

  // ── CV / Careers Submission — moved to /careers/careers.js ──

  // Close dropdowns when clicking outside
  document.addEventListener('click', function(e) {
    ['doctors-dropdown', 'clinic-days-dropdown'].forEach(function(id) {
      const dropdown = document.getElementById(id);
      if (dropdown && !dropdown.contains(e.target)) {
        dropdown.classList.remove('open');
      }
    });
  });

// Footer copyright year — keeps "© YYYY" current automatically, no manual edits needed.
(function () {
  const el = document.getElementById("copyright-year");
  if (el) el.textContent = new Date().getFullYear();
})();
