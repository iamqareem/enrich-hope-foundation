// server.js
// Single-process app: serves the existing static site AND the blog
// (public + admin) on top of it. One `node server.js` is the whole deployment.

require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const cookieSession = require('cookie-session');
const multer = require('multer');
const { marked } = require('marked');

const posts = require('./src/db');
const donations = require('./src/donations');
const pesapal = require('./src/pesapal');
const { checkCredentials, requireAuth } = require('./src/auth');

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.SESSION_SECRET) {
  console.error('Missing SESSION_SECRET in environment. See .env.example. Exiting.');
  process.exit(1);
}
if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD_HASH) {
  console.error('Missing ADMIN_USERNAME / ADMIN_PASSWORD_HASH in environment. See .env.example. Exiting.');
  process.exit(1);
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json()); // Pesapal IPN can POST JSON — without this req.body is undefined
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use(
  cookieSession({
    name: 'session',
    secret: process.env.SESSION_SECRET,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    sameSite: 'lax',
    // secure: true, // enable once served over HTTPS
  })
);

// Minimal security headers (no extra dependency). Tighten further behind
// HTTPS via the nginx/TLS steps in DEPLOY.md.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

// ---- Image upload setup (blog covers, testimonials, gallery) ----
function makeUploader(subdir, prefix) {
  const dir = path.join(__dirname, 'uploads', subdir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, dir),
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const safeExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '.jpg';
        cb(null, `${prefix}${Date.now()}-${Math.round(Math.random() * 1e6)}${safeExt}`);
      },
    }),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
      const ok = /^image\/(jpeg|png|webp)$/.test(file.mimetype);
      cb(ok ? null : new Error('Only JPG, PNG, or WEBP images are allowed'), ok);
    },
  });
}

const upload = makeUploader('blog', '');
const uploadTestimonial = makeUploader('testimonials', 't-');
const uploadGallery = makeUploader('gallery', 'g-');

// Delete an uploaded file when its record is removed/replaced.
// Only touches files under /uploads — never static site images.
function removeUploadedFile(publicUrl) {
  if (!publicUrl || !publicUrl.startsWith('/uploads/')) return;
  const abs = path.join(__dirname, publicUrl);
  fs.unlink(abs, () => {});
}

// Wrap multer so a bad upload re-renders the admin form with a message
// instead of crashing to a bare 500 page.
function handleUpload(mw, getView) {
  return (req, res, next) => {
    mw(req, res, (err) => {
      if (!err) return next();
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'Image is too large — please use a file under 5MB.'
          : err.message || 'Image upload failed. Please try a JPG, PNG, or WEBP file.';
      return res.status(400).render(getView(req), {
        post: { ...req.body, id: req.params.id },
        error: message,
        pageTitle: 'Edit Post | Admin',
      });
    });
  };
}

// Same idea for the section-style hatches (testimonials, gallery):
// a bad upload just bounces back to the section (kwaja pattern).
function uploadOrBounce(mw, anchor) {
  return (req, res, next) => {
    mw(req, res, (err) => {
      if (!err) return next();
      console.error(`Upload failed (${anchor}):`, err.message);
      return res.redirect(`/admin${anchor}`);
    });
  };
}

// ---- Site settings (footer social links + contact details) ----
// Available in every EJS view as `socialLinks` / `contact`, so the footer
// partial can render them with zero changes to each individual route.
app.use((req, res, next) => {
  try {
    res.locals.socialLinks = posts.getSocialLinks();
    res.locals.contact = posts.getContactDetails();
  } catch (err) {
    res.locals.socialLinks = { facebook: '', instagram: '', x: '', youtube: '' };
    res.locals.contact = { email: '', phone: '', location: '' };
  }
  next();
});

// Public JSON feeds for the static homepage (public/index.html can't use
// EJS, so a tiny script hydrates dynamic blocks from here).
app.get('/api/social-links', (req, res) => {
  res.json(res.locals.socialLinks);
});

app.get('/api/site-settings', (req, res) => {
  res.json({ social: res.locals.socialLinks, contact: res.locals.contact });
});

app.get('/api/testimonials', (req, res) => {
  res.json(posts.listTestimonials());
});

app.get('/api/gallery', (req, res) => {
  res.json(posts.listGallery());
});

// =========================================================
// PUBLIC BLOG ROUTES
// =========================================================

app.get('/blog', (req, res) => {
  const list = posts.listPublished().map((p) => ({
    ...p,
    excerpt: markdownExcerpt(p.body_markdown),
  }));
  res.render('blog-list', {
    posts: list,
    pageTitle: 'Blog | Enrich Hope Foundation',
    pageDescription: 'News and stories from Enrich Hope Foundation programs in Kampala, Uganda.',
  });
});

app.get('/blog/:slug', (req, res) => {
  const post = posts.getBySlug(req.params.slug);
  if (!post || post.status !== 'published') {
    return res.status(404).render('blog-post', {
      post: null,
      pageTitle: 'Post not found | Enrich Hope Foundation',
      pageDescription: '',
    });
  }
  res.render('blog-post', {
    post,
    bodyHtml: marked.parse(post.body_markdown),
    pageTitle: `${post.title} | Enrich Hope Foundation Blog`,
    pageDescription: post.subtitle || '',
  });
});

function markdownExcerpt(md, maxLen = 160) {
  const text = md.replace(/[#*_>`\-\[\]()!]/g, '').replace(/\s+/g, ' ').trim();
  return text.length > maxLen ? text.slice(0, maxLen).trim() + '…' : text;
}

// =========================================================
// DONATION ROUTES (Pesapal)
// =========================================================
// Frontend only ever POSTs here — no Pesapal key ever reaches the browser.

app.post('/donate/start', async (req, res) => {
  if (!pesapal.isConfigured()) {
    return res.status(503).render('donate-status', {
      state: 'not_configured',
      pageTitle: 'Donations Coming Soon | Enrich Hope Foundation',
    });
  }

  const amountRaw = req.body.amount === 'custom' ? req.body.custom_amount : req.body.amount;
  const amount = Math.round(Number(amountRaw));
  const MIN_UGX = 1000;
  const MAX_UGX = 100000000;
  if (!Number.isFinite(amount) || amount < MIN_UGX || amount > MAX_UGX) {
    return res.status(400).render('donate-status', {
      state: 'invalid_amount',
      pageTitle: 'Donate | Enrich Hope Foundation',
    });
  }

  const donation = donations.create({
    amount,
    currency: 'UGX',
    donor_name: (req.body.donor_name || '').trim() || null,
    donor_email: (req.body.donor_email || '').trim() || null,
    donor_phone: (req.body.donor_phone || '').trim() || null,
  });

  try {
    const order = await pesapal.submitOrder({
      merchantReference: donation.merchant_reference,
      amount,
      currency: 'UGX',
      description: 'Donation to Enrich Hope Foundation',
      email: donation.donor_email,
      phone: donation.donor_phone,
      firstName: donation.donor_name,
    });
    donations.attachTrackingId(donation.merchant_reference, order.order_tracking_id);
    res.redirect(order.redirect_url);
  } catch (err) {
    console.error('Pesapal submitOrder failed:', err.message);
    donations.setStatus(donation.merchant_reference, 'failed', 'Order submission error');
    res.status(502).render('donate-status', {
      state: 'error',
      pageTitle: 'Donate | Enrich Hope Foundation',
    });
  }
});

app.get('/donate/callback', async (req, res) => {
  const trackingId = req.query.OrderTrackingId || req.query.orderTrackingId;
  if (!trackingId) {
    return res.status(400).render('donate-status', { state: 'error', pageTitle: 'Donate | Enrich Hope Foundation' });
  }
  try {
    const result = await pesapal.getTransactionStatus(trackingId);
    const donation = donations.getByTrackingId(trackingId);
    const mapped = mapPesapalStatus(result.payment_status_description);
    if (donation) donations.setStatus(donation.merchant_reference, mapped, result.payment_status_description);
    res.render('donate-status', {
      state: mapped,
      amount: result.amount,
      pageTitle: 'Thank You | Enrich Hope Foundation',
    });
  } catch (err) {
    console.error('Pesapal callback status check failed:', err.message);
    res.status(502).render('donate-status', { state: 'error', pageTitle: 'Donate | Enrich Hope Foundation' });
  }
});

// Pesapal's server-to-server notification — the reliable source of truth,
// since a donor can close the browser tab before /donate/callback ever runs.
app.all('/donate/ipn', async (req, res) => {
  const trackingId = req.query.OrderTrackingId || req.query.orderTrackingId || req.body?.OrderTrackingId;
  const merchantRef = req.query.OrderMerchantReference || req.body?.OrderMerchantReference;

  try {
    if (trackingId) {
      const result = await pesapal.getTransactionStatus(trackingId);
      const donation = donations.getByTrackingId(trackingId) || (merchantRef && donations.getByRef(merchantRef));
      if (donation) {
        donations.setStatus(donation.merchant_reference, mapPesapalStatus(result.payment_status_description), result.payment_status_description);
      }
    }
    res.json({
      orderNotificationType: 'IPNCHANGE',
      orderTrackingId: trackingId || '',
      orderMerchantReference: merchantRef || '',
      status: 200,
    });
  } catch (err) {
    console.error('Pesapal IPN handling failed:', err.message);
    res.status(500).json({ status: 500 });
  }
});

function mapPesapalStatus(description) {
  switch ((description || '').toUpperCase()) {
    case 'COMPLETED': return 'completed';
    case 'FAILED': return 'failed';
    case 'INVALID': return 'failed';
    default: return 'pending';
  }
}

// =========================================================
// ADMIN ROUTES
// =========================================================

app.get('/admin/login', (req, res) => {
  res.render('admin-login', { error: null, pageTitle: 'Admin Login | Enrich Hope Foundation' });
});

// Brute-force guard for the single admin login: max 10 attempts per
// IP per 15 minutes. In-memory is fine — one process, one admin.
const loginAttempts = new Map();
function loginRateLimit(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const entry = loginAttempts.get(ip) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }
  entry.count += 1;
  loginAttempts.set(ip, entry);
  if (entry.count > 10) {
    return res.status(429).render('admin-login', {
      error: 'Too many attempts. Please wait 15 minutes and try again.',
      pageTitle: 'Admin Login | Enrich Hope Foundation',
    });
  }
  next();
}

app.post('/admin/login', loginRateLimit, (req, res) => {
  const { username, password } = req.body;
  if (checkCredentials(username, password)) {
    req.session.isAdmin = true;
    return res.redirect('/admin');
  }
  res.status(401).render('admin-login', {
    error: 'Incorrect username or password.',
    pageTitle: 'Admin Login | Enrich Hope Foundation',
  });
});

app.post('/admin/logout', (req, res) => {
  req.session = null;
  res.redirect('/admin/login');
});

function renderDashboard(res, overrides = {}, status = 200) {
  return res.status(status).render('admin-dashboard', {
    posts: posts.listAll(),
    testimonials: posts.listTestimonials(),
    gallery: posts.listGallery(),
    socialLinks: posts.getSocialLinks(),
    contact: posts.getContactDetails(),
    settingsSaved: false,
    settingsError: null,
    pageTitle: 'Dashboard | Admin',
    ...overrides,
  });
}

app.get('/admin', requireAuth, (req, res) => {
  renderDashboard(res, { settingsSaved: req.query.saved === '1' });
});

function saveSettings(res, saver, successPayload) {
  try {
    const saved = saver();
    renderDashboard(res, { ...successPayload(saved), settingsSaved: true });
  } catch (err) {
    console.error(err);
    renderDashboard(
      res,
      { settingsSaved: false, settingsError: 'Could not save. Please try again.' },
      500
    );
  }
}

app.post('/admin/settings/social', requireAuth, (req, res) => {
  saveSettings(
    res,
    () => posts.setSocialLinks({
      facebook: req.body.facebook,
      instagram: req.body.instagram,
      x: req.body.x,
      youtube: req.body.youtube,
    }),
    (saved) => ({ socialLinks: saved })
  );
});

app.post('/admin/settings/contact', requireAuth, (req, res) => {
  saveSettings(
    res,
    () => posts.setContactDetails({
      email: req.body.email,
      phone: req.body.phone,
      location: req.body.location,
    }),
    (saved) => ({ contact: saved })
  );
});

// ---- Testimonials management ("Voices of Impact" on the homepage) ----
app.post('/admin/testimonials', requireAuth, uploadOrBounce(uploadTestimonial.single('photo'), '#testimonials-section'), (req, res) => {
  const quote = (req.body.quote || '').trim().slice(0, 1000);
  const name = (req.body.name || '').trim().slice(0, 120);
  if (!quote || !name) return res.redirect('/admin#testimonials-section');
  let photoUrl = (req.body.photo_url || '').trim().slice(0, 300) || null;
  if (req.file) photoUrl = `/uploads/testimonials/${req.file.filename}`;
  posts.addTestimonial({
    quote,
    name,
    role: (req.body.role || '').trim().slice(0, 120),
    photo_url: photoUrl,
  });
  res.redirect('/admin#testimonials-section');
});

app.post('/admin/testimonials/:id/delete', requireAuth, (req, res) => {
  const item = posts.listTestimonials().find((t) => String(t.id) === String(req.params.id));
  posts.deleteTestimonial(req.params.id);
  if (item) removeUploadedFile(item.photo_url);
  res.redirect('/admin#testimonials-section');
});

// ---- Gallery management (homepage photo grid) ----
const GALLERY_CATEGORIES = ['Education', 'Health', 'Community', 'Water', 'Events', 'General'];

app.post('/admin/gallery', requireAuth, uploadOrBounce(uploadGallery.single('gallery_image'), '#gallery-section'), (req, res) => {
  const title = (req.body.title || '').trim().slice(0, 120) || 'Enrich Hope Photo';
  const category = GALLERY_CATEGORIES.includes(req.body.category) ? req.body.category : 'General';
  let imageUrl = '';
  if (req.file) {
    imageUrl = `/uploads/gallery/${req.file.filename}`;
  } else if (req.body.image_url && req.body.image_url.trim()) {
    imageUrl = req.body.image_url.trim().slice(0, 300);
  } else {
    return res.redirect('/admin#gallery-section');
  }
  posts.addGalleryItem({ title, image_url: imageUrl, category });
  res.redirect('/admin#gallery-section');
});

app.post('/admin/gallery/:id/delete', requireAuth, (req, res) => {
  const item = posts.listGallery().find((g) => String(g.id) === String(req.params.id));
  posts.deleteGalleryItem(req.params.id);
  if (item) removeUploadedFile(item.image_url);
  res.redirect('/admin#gallery-section');
});

app.get('/admin/posts/new', requireAuth, (req, res) => {
  res.render('admin-post-form', { post: null, error: null, pageTitle: 'New Post | Admin' });
});

app.post('/admin/posts', requireAuth, handleUpload(upload.single('cover_image'), () => 'admin-post-form'), (req, res) => {
  try {
    const { title, subtitle, body_markdown, status } = req.body;
    if (!title || !title.trim() || !body_markdown || !body_markdown.trim()) {
      return res.status(400).render('admin-post-form', {
        post: req.body,
        error: 'Title and body are required.',
        pageTitle: 'New Post | Admin',
      });
    }
    const created = posts.createPost({
      title: title.trim(),
      subtitle: (subtitle || '').trim(),
      body_markdown,
      cover_image: req.file ? `/uploads/blog/${req.file.filename}` : null,
      status: status === 'published' ? 'published' : 'draft',
    });
    res.redirect(`/admin/posts/${created.id}/edit`);
  } catch (err) {
    console.error(err);
    res.status(500).render('admin-post-form', {
      post: req.body,
      error: 'Something went wrong saving the post.',
      pageTitle: 'New Post | Admin',
    });
  }
});

app.get('/admin/posts/:id/edit', requireAuth, (req, res) => {
  const post = posts.getById(req.params.id);
  if (!post) return res.redirect('/admin');
  res.render('admin-post-form', { post, error: null, pageTitle: 'Edit Post | Admin' });
});

app.post('/admin/posts/:id', requireAuth, handleUpload(upload.single('cover_image'), () => 'admin-post-form'), (req, res) => {
  try {
    const { title, subtitle, body_markdown, status } = req.body;
    if (!title || !title.trim() || !body_markdown || !body_markdown.trim()) {
      if (req.file) removeUploadedFile(`/uploads/blog/${req.file.filename}`);
      return res.status(400).render('admin-post-form', {
        post: { ...req.body, id: req.params.id },
        error: 'Title and body are required.',
        pageTitle: 'Edit Post | Admin',
      });
    }
    const before = posts.getById(req.params.id);
    posts.updatePost(req.params.id, {
      title: title.trim(),
      subtitle: (subtitle || '').trim(),
      body_markdown,
      cover_image: req.file ? `/uploads/blog/${req.file.filename}` : null,
      status: status === 'published' ? 'published' : 'draft',
    });
    if (req.file && before) removeUploadedFile(before.cover_image);
    res.redirect(`/admin/posts/${req.params.id}/edit`);
  } catch (err) {
    console.error(err);
    res.status(500).render('admin-post-form', {
      post: { ...req.body, id: req.params.id },
      error: 'Something went wrong saving the post.',
      pageTitle: 'Edit Post | Admin',
    });
  }
});

app.post('/admin/posts/:id/delete', requireAuth, (req, res) => {
  const post = posts.getById(req.params.id);
  posts.deletePost(req.params.id);
  if (post) removeUploadedFile(post.cover_image);
  res.redirect('/admin');
});

// Friendly 404 for everything else (must stay after all routes).
app.use((req, res) => {
  res.status(404).render('not-found', { pageTitle: 'Page Not Found | Enrich Hope Foundation' });
});

app.listen(PORT, () => {
  console.log(`Enrich Hope site running at http://localhost:${PORT}`);
});
