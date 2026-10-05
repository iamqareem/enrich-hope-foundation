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
