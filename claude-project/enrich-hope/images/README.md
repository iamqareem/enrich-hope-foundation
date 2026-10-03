# /images — replaceable site photos

This folder is the single place non-developers manage site photos (e.g. via a
file browser / SFTP container pointed at this directory).

**Rule: filenames below are hardcoded into the site. Replace a file in place,
keep the exact same filename and `.jpg` extension, and the new photo goes
live on next page load. Do not rename, delete, or add files.**

| Filename                    | Used for                          | Recommended size |
|------------------------------|-------------------------------------|-------------------|
| `hero.jpg`                   | Hero section photo                  | 900 x 1000px (portrait) |
| `about.jpg`                  | About Us section photo              | 700 x 800px (portrait) |
| `service-education.jpg`      | "Education & Mentorship" card       | 480 x 360px |
| `service-health.jpg`         | "Health & Wellbeing" card           | 480 x 360px |
| `service-community.jpg`      | "Community Development" card        | 480 x 360px |
| `service-relief.jpg`         | "Emergency Relief" card             | 480 x 360px |
| `testimonial-1.jpg`          | 1st testimonial's photo (shown as a circle) | 400 x 400px (square) |
| `testimonial-2.jpg`          | 2nd testimonial's photo             | 400 x 400px (square) |
| `testimonial-3.jpg`          | 3rd testimonial's photo             | 400 x 400px (square) |

Notes:
- Section backgrounds (hero, CTA band, donate, volunteer) are solid colors,
  not photos — kept that way on purpose to keep this folder small and the
  page fast. If that changes later, a developer needs to add the slot.
- Keep photos reasonably compressed (under ~300KB each) so the page stays fast.
- The gold-bordered placeholder images currently in this folder are safe to
  swap out one at a time — the layout won't break if a photo is briefly
  missing, as long as the filename is unchanged.
- If a brand-new image slot is ever needed, a developer needs to add it to
  the HTML/CSS first — this folder only swaps existing slots.
