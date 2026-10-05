// Mobile nav toggle
const navToggle = document.getElementById('nav-toggle');
const siteNav = document.getElementById('site-nav');

navToggle.addEventListener('click', () => {
  const isOpen = siteNav.classList.toggle('open');
  navToggle.setAttribute('aria-expanded', String(isOpen));
});

siteNav.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => {
    siteNav.classList.remove('open');
    navToggle.setAttribute('aria-expanded', 'false');
  });
});

// Footer year
const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = new Date().getFullYear();

// Footer social links: hydrated from /api/social-links (managed in /admin).
// Icons without a configured URL are hidden; the row hides entirely if none.
fetch('/api/social-links')
  .then((r) => (r.ok ? r.json() : {}))
  .then((links) => {
    const row = document.getElementById('social-row');
    if (!row || !links) return;
    let visible = 0;
    row.querySelectorAll('a[data-social]').forEach((a) => {
      const url = (links[a.dataset.social] || '').trim();
      if (url) {
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.style.display = '';
        visible += 1;
      } else {
        a.style.display = 'none';
      }
    });
    if (!visible) {
      const col = row.closest('.footer-col');
      if (col) col.style.display = 'none';
    }
  })
  .catch(() => { /* footer keeps its default links */ });

// Testimonials: hydrated from /api/testimonials (managed in /admin).
// Falls back to the static cards already in the HTML when empty/offline.
fetch('/api/testimonials')
  .then((r) => (r.ok ? r.json() : []))
  .then((items) => {
    const grid = document.getElementById('testimonial-grid');
    if (!grid || !Array.isArray(items) || items.length === 0) return;
    grid.innerHTML = items.map((t) => `
      <figure class="testimonial-card">
        ${t.photo_url ? `<img src="${t.photo_url}" alt="Photo of ${t.name}" width="120" height="120" loading="lazy" class="testimonial-photo">` : ''}
        <blockquote></blockquote>
        <figcaption>
          <span class="testimonial-name"></span>
          ${t.role ? '<span class="testimonial-role"></span>' : ''}
        </figcaption>
      </figure>`).join('');
    // Text set via textContent (not innerHTML) so quotes can't inject markup.
    grid.querySelectorAll('.testimonial-card').forEach((card, i) => {
      card.querySelector('blockquote').textContent = `"${items[i].quote}"`;
      card.querySelector('.testimonial-name').textContent = items[i].name;
      const roleEl = card.querySelector('.testimonial-role');
      if (roleEl) roleEl.textContent = items[i].role;
    });
  })
  .catch(() => { /* static fallback cards stay */ });

// Gallery: hydrated from /api/gallery (managed in /admin).
// Section hides entirely when no photos exist yet.
fetch('/api/gallery')
  .then((r) => (r.ok ? r.json() : []))
  .then((items) => {
    const grid = document.getElementById('gallery-grid');
    if (!grid) return;
    if (!Array.isArray(items) || items.length === 0) {
      const section = document.getElementById('gallery');
      if (section) section.style.display = 'none';
      return;
    }
    grid.innerHTML = '';
    items.slice(0, 8).forEach((g) => {
      const fig = document.createElement('figure');
      fig.className = 'gallery-item';
      const img = document.createElement('img');
      img.src = g.image_url;
      img.alt = g.title || 'Enrich Hope Foundation photo';
      img.loading = 'lazy';
      fig.appendChild(img);
      if (g.title) {
        const cap = document.createElement('figcaption');
        cap.className = 'gallery-caption';
        cap.textContent = g.title;
        fig.appendChild(cap);
      }
      grid.appendChild(fig);
    });
  })
  .catch(() => {
    const section = document.getElementById('gallery');
    if (section) section.style.display = 'none';
  });

// Contact details: hydrated from /api/site-settings (managed in /admin).
fetch('/api/site-settings')
  .then((r) => (r.ok ? r.json() : null))
  .then((settings) => {
    if (!settings || !settings.contact) return;
    const { email, phone, location } = settings.contact;
    const emailEl = document.getElementById('contact-email');
    if (emailEl && email) {
      emailEl.href = `mailto:${email}`;
      emailEl.textContent = email;
    }
    const phoneEl = document.getElementById('contact-phone');
    if (phoneEl && phone) {
      phoneEl.href = `tel:${phone.replace(/\s+/g, '')}`;
      phoneEl.textContent = phone;
    }
    const locEl = document.getElementById('contact-location');
    if (locEl && location) locEl.textContent = location;
    const volPhone = document.getElementById('volunteer-phone');
    if (volPhone && phone) {
      volPhone.href = `tel:${phone.replace(/\s+/g, '')}`;
      volPhone.textContent = `Call ${phone}`;
    }
  })
  .catch(() => { /* static contact details stay */ });

// Floating donate button: hide while the hero or donate section is already in view
const floatDonate = document.querySelector('.float-donate');
const hideZones = document.querySelectorAll('.hero, #donate');
if (floatDonate && hideZones.length && 'IntersectionObserver' in window) {
  const io = new IntersectionObserver((entries) => {
    const anyVisible = entries.some(e => e.isIntersecting);
    floatDonate.style.opacity = anyVisible ? '0' : '1';
    floatDonate.style.pointerEvents = anyVisible ? 'none' : 'auto';
  }, { threshold: 0.3 });
  hideZones.forEach(zone => io.observe(zone));
}

// Donate form: reveal the custom-amount field only when that option is picked
const donateForm = document.getElementById('donate-form');
if (donateForm) {
  const customRow = document.getElementById('donate-custom-row');
  const customInput = document.getElementById('custom_amount');
  const customRadio = document.getElementById('amount-custom-radio');

  donateForm.querySelectorAll('input[name="amount"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      const showCustom = customRadio.checked;
      customRow.hidden = !showCustom;
      customInput.required = showCustom;
      if (showCustom) customInput.focus();
    });
  });
}
