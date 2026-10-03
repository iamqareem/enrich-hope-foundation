document.addEventListener('DOMContentLoaded', () => {
    const navToggle = document.getElementById('nav-toggle');
    const siteNav = document.getElementById('site-nav');

    // 1. Mobile Menu Toggle
    if (navToggle && siteNav) {
        navToggle.addEventListener('click', () => {
            const isOpen = siteNav.classList.toggle('open');
            navToggle.classList.toggle('active');
            navToggle.setAttribute('aria-expanded', isOpen);
        });

        // Close menu when clicking a link
        const navLinks = siteNav.querySelectorAll('a');
        navLinks.forEach(link => {
            link.addEventListener('click', () => {
                siteNav.classList.remove('open');
                navToggle.classList.remove('active');
                navToggle.setAttribute('aria-expanded', 'false');
            });
        });
    }

    // 2. Set Current Year for Copyright
    const yearSpan = document.getElementById('year');
    if (yearSpan) {
        yearSpan.textContent = new Date().getFullYear();
    }

    // 3. Simple Form Submission Handling (Optional)
    const volunteerForm = document.querySelector('.contact-form');
    if (volunteerForm) {
        volunteerForm.addEventListener('submit', (e) => {
            e.preventDefault();
            alert("Thank you for your interest! A foundation representative will reach out to you shortly via email.");
            volunteerForm.reset();
        });
    }

    // 4. Smooth Scroll for browsers that don't support CSS smooth scroll
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth'
                });
            }
        });
    });
});
