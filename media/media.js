// Tab switching
function switchTab(tab, btn) {
  document.querySelectorAll('.tab-content').forEach(function(el) { el.classList.remove('active'); });
  document.querySelectorAll('.filter-btn').forEach(function(el) { el.classList.remove('active'); });
  document.getElementById('tab-' + tab).classList.add('active');
  btn.classList.add('active');
}

// Dropdown click handlers
document.addEventListener('click', function(e) {
  ['doctors-dropdown', 'clinic-days-dropdown'].forEach(function(id) {
    var dropdown = document.getElementById(id);
    if (dropdown && !dropdown.contains(e.target)) {
      dropdown.classList.remove('open');
    }
  });
});

// Mobile menu close on link click
document.querySelectorAll('.mobile-menu a').forEach(function(a) {
  a.addEventListener('click', function() {
    document.querySelector('.mobile-menu').classList.remove('open');
  });
});

// ══════════════════════════════════════════════
//  DYNAMIC MEDIA CONTENT (News / Announcements / Gallery / Videos)
// ══════════════════════════════════════════════
const GALLERY_COLORS = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8'];
const VIDEO_COLORS = ['vt1', 'vt2', 'vt3', 'vt4', 'vt5', 'vt6'];
let GALLERY_ITEMS = [];
let currentImageIndex = -1;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function byOrder(a, b) {
  return (b.sortOrder || 0) - (a.sortOrder || 0) || (b.id - a.id);
}

function renderAnnouncements(items) {
  const el = document.getElementById('announcements-list');
  if (!items.length) { el.innerHTML = '<p class="media-empty">No announcements yet. Please check back soon.</p>'; return; }
  el.innerHTML = items.map(function (a) {
    const badgeClass = 'badge-' + (a.tagStyle || 'notice');
    const iconInner = a.imageUrl
      ? `<img src="${esc(a.imageUrl)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:10px"/>`
      : esc(a.icon || '📢');
    return `
      <div class="announcement-card">
        <div class="ann-icon ${esc(a.style || 'blue')}">${iconInner}</div>
        <div class="ann-body">
          <h4>${esc(a.title)}</h4>
          <p>${esc(a.body)}</p>
          <div class="ann-meta">
            <span class="ann-date">${esc(a.dateLabel)}</span>
            ${a.tag ? `<span class="ann-badge ${badgeClass}">${esc(a.tag)}</span>` : ''}
          </div>
        </div>
      </div>`;
  }).join('');
}

function renderNews(items) {
  const el = document.getElementById('news-grid');
  if (!items.length) { el.innerHTML = '<p class="media-empty">No news articles yet. Please check back soon.</p>'; return; }
  el.innerHTML = items.map(function (n) {
    const thumbClass = n.style || 'health';
    const thumbInner = n.imageUrl
      ? `<img src="${esc(n.imageUrl)}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"/>`
      : esc(n.icon || '📰');
    return `
      <div class="news-card">
        <div class="news-thumb ${esc(thumbClass)}">
          ${thumbInner}
          ${n.tag ? `<span class="news-tag tag-${esc(thumbClass)}" style="position:relative;z-index:1">${esc(n.tag)}</span>` : ''}
        </div>
        <div class="news-body">
          <div class="news-date">${esc(n.dateLabel)}</div>
          <h3>${esc(n.title)}</h3>
          <p>${esc(n.body)}</p>
        </div>
      </div>`;
  }).join('');
}

function renderGallery(items) {
  GALLERY_ITEMS = items;
  const el = document.getElementById('gallery-grid');
  if (!items.length) { el.innerHTML = '<p class="media-empty">No gallery photos yet. Please check back soon.</p>'; return; }
  el.innerHTML = items.map(function (g, i) {
    const color = GALLERY_COLORS[i % GALLERY_COLORS.length];
    const sizeClass = i === 0 ? 'tall' : (i % 5 === 4 ? 'wide' : '');
    const inner = g.imageUrl
      ? `<img src="${esc(g.imageUrl)}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"/>`
      : esc(g.icon || '📷');
    return `
      <div class="gallery-item ${sizeClass} ${g.imageUrl ? '' : color}" style="position:relative;${g.imageUrl ? 'background:#0B2A52' : ''}" onclick="openImageModal(${i})">
        ${inner}
        <div class="gallery-caption" style="position:relative;z-index:1">${esc(g.title)}</div>
        <div class="gallery-overlay"><span>🔍</span><p>View Photo</p></div>
      </div>`;
  }).join('');
}

function renderVideos(items) {
  VIDEO_ITEMS = items;
  const el = document.getElementById('videos-grid');
  if (!items.length) { el.innerHTML = '<p class="media-empty">No videos yet. Please check back soon.</p>'; return; }
  el.innerHTML = items.map(function (v, i) {
    const color = VIDEO_COLORS[i % VIDEO_COLORS.length];
    const thumbInner = v.imageUrl
      ? `<img src="${esc(v.imageUrl)}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"/>`
      : '';
    return `
      <div class="video-card" onclick="playVideo(${v.id})">
        <div class="video-thumb ${v.imageUrl ? '' : color}" style="position:relative;${v.imageUrl ? 'background:#0B2A52' : ''}">
          ${thumbInner}
          <div class="play-btn" style="position:relative;z-index:1">▶</div>
          ${v.duration ? `<span class="video-duration" style="z-index:1">${esc(v.duration)}</span>` : ''}
        </div>
        <div class="video-body">
          <h3>${esc(v.title)}</h3>
          <p>${esc(v.body)}</p>
          <div class="video-meta"><span>${esc(v.dateLabel)}</span>${v.tag ? `<span>${esc(v.tag)}</span>` : ''}</div>
        </div>
      </div>`;
  }).join('');
}

// ══════════════════════════════════════════════
//  VIDEO PLAYBACK MODAL
// ══════════════════════════════════════════════
let VIDEO_ITEMS = [];

function toEmbedUrl(url) {
  if (!url) return null;
  // YouTube: watch?v=, youtu.be/, or already /embed/
  let m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{11})/);
  if (m) return { type: 'iframe', src: `https://www.youtube.com/embed/${m[1]}?autoplay=1&rel=0` };
  // Vimeo
  m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (m) return { type: 'iframe', src: `https://player.vimeo.com/video/${m[1]}?autoplay=1` };
  // Otherwise treat as a direct video file (uploaded file or direct .mp4/.webm link)
  return { type: 'file', src: url };
}

function playVideo(id) {
  const v = VIDEO_ITEMS.find(function (x) { return x.id === id; });
  if (!v) return;
  const player = document.getElementById('video-modal-player');
  const embed = toEmbedUrl(v.videoUrl);
  if (!embed) {
    player.innerHTML = '<div style="color:#fff;display:flex;align-items:center;justify-content:center;height:100%;font-size:14px;text-align:center;padding:24px">This video is not available yet. Please check back soon.</div>';
  } else if (embed.type === 'iframe') {
    player.innerHTML = `<iframe src="${esc(embed.src)}" title="${esc(v.title)}" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`;
  } else {
    player.innerHTML = `<video controls autoplay playsinline src="${esc(embed.src)}"></video>`;
  }
  document.getElementById('video-modal-title').textContent = v.title || '';
  document.getElementById('video-modal-desc').textContent = v.body || '';
  document.getElementById('video-modal-overlay').classList.add('open');
}

function closeVideoModal() {
  document.getElementById('video-modal-overlay').classList.remove('open');
  document.getElementById('video-modal-player').innerHTML = ''; // stop playback
}

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') { closeVideoModal(); closeImageModal(); }
  if (document.getElementById('image-modal-overlay').classList.contains('open')) {
    if (e.key === 'ArrowLeft') navImageModal(-1);
    if (e.key === 'ArrowRight') navImageModal(1);
  }
});

// ══════════════════════════════════════════════
//  IMAGE LIGHTBOX MODAL (Photo Gallery)
// ══════════════════════════════════════════════
function renderImageModal(index) {
  const g = GALLERY_ITEMS[index];
  if (!g) return;
  const media = document.getElementById('image-modal-media');
  if (g.imageUrl) {
    media.innerHTML = `<img src="${esc(g.imageUrl)}" alt="${esc(g.title)}"/>`;
  } else {
    const color = GALLERY_COLORS[index % GALLERY_COLORS.length];
    media.innerHTML = `<div class="fallback-tile ${color}">${esc(g.icon || '📷')}</div>`;
  }
  document.getElementById('image-modal-caption').textContent = g.title || '';
  document.getElementById('image-modal-prev').style.display = GALLERY_ITEMS.length > 1 ? '' : 'none';
  document.getElementById('image-modal-next').style.display = GALLERY_ITEMS.length > 1 ? '' : 'none';
}

function openImageModal(index) {
  if (!GALLERY_ITEMS.length) return;
  currentImageIndex = index;
  renderImageModal(currentImageIndex);
  document.getElementById('image-modal-overlay').classList.add('open');
}

function navImageModal(dir) {
  if (!GALLERY_ITEMS.length) return;
  currentImageIndex = (currentImageIndex + dir + GALLERY_ITEMS.length) % GALLERY_ITEMS.length;
  renderImageModal(currentImageIndex);
}

function closeImageModal() {
  document.getElementById('image-modal-overlay').classList.remove('open');
  document.getElementById('image-modal-media').innerHTML = '';
}

async function loadMedia() {
  try {
    const data = await api.get('/media?limit=300');
    const items = (data.items || []).filter(function (m) { return m.status !== 'Draft'; });
    renderAnnouncements(items.filter(function (m) { return m.category === 'announcement'; }).sort(byOrder));
    renderNews(items.filter(function (m) { return m.category === 'news'; }).sort(byOrder));
    renderGallery(items.filter(function (m) { return m.category === 'gallery'; }).sort(byOrder));
    renderVideos(items.filter(function (m) { return m.category === 'video'; }).sort(byOrder));
  } catch (e) {
    ['announcements-list', 'news-grid', 'gallery-grid', 'videos-grid'].forEach(function (id) {
      document.getElementById(id).innerHTML = '<p class="media-empty">Could not load content right now. Please refresh the page.</p>';
    });
  }
}

loadMedia();

// Footer copyright year — keeps "© YYYY" current automatically, no manual edits needed.
(function () {
  const el = document.getElementById("copyright-year");
  if (el) el.textContent = new Date().getFullYear();
})();
