// src/db.js
// The entire data layer for the blog. One SQLite file on disk, one table.
// SQLite is a good fit here: a single admin writes posts occasionally,
// many people just read them — that's exactly the read-heavy, low-write
// workload SQLite is built for, with zero separate database server to run,
// back up, or secure. The whole database is one file at data/blog.db.

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'blog.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    title         TEXT NOT NULL,
    subtitle      TEXT,
    slug          TEXT NOT NULL UNIQUE,
    cover_image   TEXT,
    body_markdown TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'draft',   -- 'draft' | 'published'
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    published_at  TEXT
  );

  -- Small generic key/value store, e.g. caching the Pesapal IPN id so it
  -- only needs to be registered with Pesapal once, ever, not on every boot.
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  -- Homepage testimonials, managed in /admin ("Voices of Impact").
  CREATE TABLE IF NOT EXISTS testimonials (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    quote      TEXT NOT NULL,
    name       TEXT NOT NULL,
    role       TEXT,
    photo_url  TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Homepage photo gallery, managed in /admin (upload or image URL).
  CREATE TABLE IF NOT EXISTS gallery (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL,
    image_url  TEXT NOT NULL,
    category   TEXT DEFAULT 'general',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

function slugify(title) {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'post';
}

function uniqueSlug(title, ignoreId = null) {
  const base = slugify(title);
  let slug = base;
  let n = 2;
  const existsStmt = ignoreId
    ? db.prepare('SELECT id FROM posts WHERE slug = ? AND id != ?')
    : db.prepare('SELECT id FROM posts WHERE slug = ?');
  while (ignoreId ? existsStmt.get(slug, ignoreId) : existsStmt.get(slug)) {
    slug = `${base}-${n++}`;
  }
  return slug;
}

const queries = {
  listPublished: db.prepare(
    `SELECT * FROM posts WHERE status = 'published' ORDER BY published_at DESC`
  ),
  listAll: db.prepare(`SELECT * FROM posts ORDER BY created_at DESC`),
  getBySlug: db.prepare('SELECT * FROM posts WHERE slug = ?'),
  getById: db.prepare('SELECT * FROM posts WHERE id = ?'),
  insert: db.prepare(`
    INSERT INTO posts (title, subtitle, slug, cover_image, body_markdown, status, published_at)
    VALUES (@title, @subtitle, @slug, @cover_image, @body_markdown, @status, @published_at)
  `),
  update: db.prepare(`
    UPDATE posts SET
      title = @title,
      subtitle = @subtitle,
      slug = @slug,
      cover_image = COALESCE(@cover_image, cover_image),
      body_markdown = @body_markdown,
      status = @status,
      published_at = @published_at,
      updated_at = datetime('now')
    WHERE id = @id
  `),
  delete: db.prepare('DELETE FROM posts WHERE id = ?'),

  // Testimonials
  listTestimonials: db.prepare('SELECT * FROM testimonials ORDER BY id ASC'),
  insertTestimonial: db.prepare(
    'INSERT INTO testimonials (quote, name, role, photo_url) VALUES (@quote, @name, @role, @photo_url)'
  ),
  deleteTestimonial: db.prepare('DELETE FROM testimonials WHERE id = ?'),

  // Gallery
  listGallery: db.prepare('SELECT * FROM gallery ORDER BY id DESC'),
  insertGallery: db.prepare(
    'INSERT INTO gallery (title, image_url, category) VALUES (@title, @image_url, @category)'
  ),
  deleteGallery: db.prepare('DELETE FROM gallery WHERE id = ?'),
};

const settingsQueries = {
  get: db.prepare('SELECT value FROM settings WHERE key = ?'),
  set: db.prepare(`
    INSERT INTO settings (key, value) VALUES (@key, @value)
    ON CONFLICT(key) DO UPDATE SET value = @value
  `),
};

// ---- Site settings: footer social links (editable in /admin) ----
// Stored as individual settings rows so a single link can be updated
// without touching the others. Empty string = "not set, hide the icon".
const SOCIAL_KEYS = {
  facebook: 'social_facebook',
  instagram: 'social_instagram',
  x: 'social_x',
  youtube: 'social_youtube',
};

function sanitizeSocialUrl(raw) {
  const url = String(raw ?? '').trim().slice(0, 300);
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

// ---- Site settings: contact details (editable in /admin) ----
const CONTACT_DEFAULTS = {
  email: 'info@enrichhopefoundation.org',
  phone: '+256 701 707 471',
  location: 'Kampala, Uganda',
};

const CONTACT_KEYS = {
  email: 'contact_email',
  phone: 'contact_phone',
  location: 'contact_location',
};

function getContactDetails() {
  return {
    email: settingsQueries.get.get(CONTACT_KEYS.email)?.value ?? CONTACT_DEFAULTS.email,
    phone: settingsQueries.get.get(CONTACT_KEYS.phone)?.value ?? CONTACT_DEFAULTS.phone,
    location: settingsQueries.get.get(CONTACT_KEYS.location)?.value ?? CONTACT_DEFAULTS.location,
  };
}

function setContactDetails({ email, phone, location }) {
  const clean = {
    email: String(email ?? '').trim().slice(0, 120) || CONTACT_DEFAULTS.email,
    phone: String(phone ?? '').trim().slice(0, 40) || CONTACT_DEFAULTS.phone,
    location: String(location ?? '').trim().slice(0, 120) || CONTACT_DEFAULTS.location,
  };
  settingsQueries.set.run({ key: CONTACT_KEYS.email, value: clean.email });
  settingsQueries.set.run({ key: CONTACT_KEYS.phone, value: clean.phone });
  settingsQueries.set.run({ key: CONTACT_KEYS.location, value: clean.location });
  return clean;
}

// Seed defaults so the homepage has real content on first boot.
// The admin can edit or delete any of these from /admin afterwards.
const countTestimonials = db.prepare('SELECT COUNT(*) AS count FROM testimonials').get();
if (countTestimonials.count === 0) {
  const seed = db.prepare(
    'INSERT INTO testimonials (quote, name, role, photo_url) VALUES (@quote, @name, @role, @photo_url)'
  );
  seed.run({
    quote: 'Because of the support from Enrich Hope, my children can now dream of a future where they finish school and help others.',
    name: 'Sarah N.',
    role: 'Beneficiary, Education Program',
    photo_url: '/images/testimonial-1.jpg',
  });
  seed.run({
    quote: "This foundation doesn't just give handouts; they give us the tools to build our own community's success.",
    name: 'Robert K.',
    role: 'Village Leader',
    photo_url: '/images/testimonial-2.jpg',
  });
}

const countGallery = db.prepare('SELECT COUNT(*) AS count FROM gallery').get();
if (countGallery.count === 0) {
  const seed = db.prepare(
    'INSERT INTO gallery (title, image_url, category) VALUES (@title, @image_url, @category)'
  );
  [
    { title: 'Learning Together', image_url: '/images/service-education.jpg', category: 'Education' },
    { title: 'Health Outreach', image_url: '/images/service-health.jpg', category: 'Health' },
    { title: 'Stronger Communities', image_url: '/images/service-community.jpg', category: 'Community' },
    { title: 'Clean Water for All', image_url: '/images/service-borehole.jpg', category: 'Water' },
  ].forEach((img) => seed.run(img));
}

module.exports = {
  db,
  uniqueSlug,  listPublished: () => queries.listPublished.all(),
  listAll: () => queries.listAll.all(),
  getBySlug: (slug) => queries.getBySlug.get(slug),
  getById: (id) => queries.getById.get(id),

  getSetting: (key) => settingsQueries.get.get(key)?.value ?? null,
  setSetting: (key, value) => settingsQueries.set.run({ key, value }),

  getContactDetails,
  setContactDetails,

  getSocialLinks: () => ({
    facebook: settingsQueries.get.get(SOCIAL_KEYS.facebook)?.value ?? '',
    instagram: settingsQueries.get.get(SOCIAL_KEYS.instagram)?.value ?? '',
    x: settingsQueries.get.get(SOCIAL_KEYS.x)?.value ?? '',
    youtube: settingsQueries.get.get(SOCIAL_KEYS.youtube)?.value ?? '',
  }),

  setSocialLinks: ({ facebook, instagram, x, youtube }) => {
    const clean = {
      facebook: sanitizeSocialUrl(facebook),
      instagram: sanitizeSocialUrl(instagram),
      x: sanitizeSocialUrl(x),
      youtube: sanitizeSocialUrl(youtube),
    };
    settingsQueries.set.run({ key: SOCIAL_KEYS.facebook, value: clean.facebook });
    settingsQueries.set.run({ key: SOCIAL_KEYS.instagram, value: clean.instagram });
    settingsQueries.set.run({ key: SOCIAL_KEYS.x, value: clean.x });
    settingsQueries.set.run({ key: SOCIAL_KEYS.youtube, value: clean.youtube });
    return clean;
  },

  createPost({ title, subtitle, body_markdown, cover_image, status }) {
    const slug = uniqueSlug(title);
    const published_at = status === 'published' ? new Date().toISOString() : null;
    const info = queries.insert.run({
      title, subtitle: subtitle || '', slug,
      cover_image: cover_image || null,
      body_markdown, status, published_at,
    });
    return queries.getById.get(info.lastInsertRowid);
  },

  updatePost(id, { title, subtitle, body_markdown, cover_image, status }) {
    const existing = queries.getById.get(id);
    if (!existing) return null;
    const slug = title !== existing.title ? uniqueSlug(title, id) : existing.slug;
    const published_at =
      status === 'published'
        ? (existing.published_at || new Date().toISOString())
        : null;
    queries.update.run({
      id, title, subtitle: subtitle || '', slug,
      cover_image: cover_image || null, // COALESCE keeps old image if none uploaded
      body_markdown, status, published_at,
    });
    return queries.getById.get(id);
  },

  deletePost(id) {
    return queries.delete.run(id);
  },

  // Testimonials (homepage "Voices of Impact")
  listTestimonials: () => queries.listTestimonials.all(),
  addTestimonial: ({ quote, name, role, photo_url }) =>
    queries.insertTestimonial.run({
      quote,
      name,
      role: role || '',
      photo_url: photo_url || null,
    }),
  deleteTestimonial: (id) => queries.deleteTestimonial.run(id),

  // Gallery (homepage photo grid)
  listGallery: () => queries.listGallery.all(),
  addGalleryItem: ({ title, image_url, category }) =>
    queries.insertGallery.run({
      title: title || 'Enrich Hope Photo',
      image_url,
      category: category || 'general',
    }),
  deleteGalleryItem: (id) => queries.deleteGallery.run(id),
};
