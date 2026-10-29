var selectedRating = 0;
  var ratingLabels = ['', 'Poor', 'Fair', 'Good', 'Very Good', 'Excellent'];

  function setRating(n) {
    selectedRating = n;
    document.querySelectorAll('#star-row span').forEach(function(s, i) {
      s.classList.toggle('active', i < n);
    });
    document.getElementById('rating-label').textContent = ratingLabels[n];
    document.getElementById('rating-label').style.color = n >= 4 ? '#1D4ED8' : n === 3 ? '#2E7D52' : '#C0392B';
  }

  function updateCounter(el) {
    var len = el.value.length;
    document.getElementById('char-count').textContent = len;
    if (len > 600) el.value = el.value.slice(0, 600);
  }

  async function submitReview() {
    var name = document.getElementById('r-name').value.trim();
    var text = document.getElementById('r-text').value.trim();
    var contact = document.getElementById('r-contact').value.trim();
    var recommendEl = document.querySelector('input[name="recommend"]:checked');
    var recommend = recommendEl ? recommendEl.value : '';

    if (!name) { highlight('r-name', 'Please enter your name.'); return; }
    if (!selectedRating) { alert('Please select a star rating.'); return; }
    if (!text)  { highlight('r-text', 'Please share your experience.'); return; }

    var btn = document.querySelector('.btn-submit');
    btn.disabled = true;
    btn.textContent = 'Submitting…';

    try {
      await api.post('/feedbacks', {
        name,
        rating: selectedRating,
        comment: text,
        contact: contact || undefined,
        wouldRecommend: recommend || undefined,
        dateOfVisit: new Date().toISOString().split('T')[0]
      });
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Submit Review';
      alert('Sorry, something went wrong: ' + err.message);
      return;
    }

    btn.disabled = false;
    document.getElementById('form-wrap').style.display = 'none';
    document.getElementById('success-state').style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function highlight(id, msg) {
    var el = document.getElementById(id);
    el.style.borderColor = '#C0392B';
    el.focus();
    alert(msg);
    setTimeout(function(){ el.style.borderColor = ''; }, 2000);
  }

  // Dropdown close on outside click
  document.addEventListener('click', function(e) {
    ['doctors-dropdown', 'clinic-days-dropdown'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el && !el.contains(e.target)) el.classList.remove('open');
    });
  });

  // Mobile menu close on link click
  document.querySelectorAll('.mobile-menu a').forEach(function(a) {
    a.addEventListener('click', function() {
      document.querySelector('.mobile-menu').classList.remove('open');
    });
  });

  /* ── Overall rating summary — loaded live from the admin-managed settings ── */
  async function loadRatingSummary() {
    try {
      var r = await api.get('/settings/rating');
      var scoreEl = document.getElementById('rating-score-display');
      var countEl = document.getElementById('rating-count-display');
      if (scoreEl) scoreEl.textContent = r.score || '4.9';
      if (countEl) countEl.textContent = r.countLabel || 'Based on patient reviews';
      [5, 4, 3, 2, 1].forEach(function(n) {
        var pct = r['pct' + n];
        if (pct === undefined || pct === null) return;
        var bar = document.getElementById('rating-bar-' + n);
        var lbl = document.getElementById('rating-pct-' + n + '-display');
        if (bar) bar.style.width = pct + '%';
        if (lbl) lbl.textContent = pct + '%';
      });
    } catch (e) {
      // Keep the default markup shown in the HTML if this fails.
    }
  }
  loadRatingSummary();

// Footer copyright year — keeps "© YYYY" current automatically, no manual edits needed.
(function () {
  const el = document.getElementById("copyright-year");
  if (el) el.textContent = new Date().getFullYear();
})();
