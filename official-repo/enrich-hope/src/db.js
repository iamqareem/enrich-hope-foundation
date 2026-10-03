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
};

const settingsQueries = {
  get: db.prepare('SELECT value FROM settings WHERE key = ?'),
  set: db.prepare(`
    INSERT INTO settings (key, value) VALUES (@key, @value)
    ON CONFLICT(key) DO UPDATE SET value = @value
  `),
};

module.exports = {
  db,
  uniqueSlug,
  listPublished: () => queries.listPublished.all(),
  listAll: () => queries.listAll.all(),
  getBySlug: (slug) => queries.getBySlug.get(slug),
  getById: (id) => queries.getById.get(id),

  getSetting: (key) => settingsQueries.get.get(key)?.value ?? null,
  setSetting: (key, value) => settingsQueries.set.run({ key, value }),

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
};
