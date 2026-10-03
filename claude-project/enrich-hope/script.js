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
document.getElementById('year').textContent = new Date().getFullYear();

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
