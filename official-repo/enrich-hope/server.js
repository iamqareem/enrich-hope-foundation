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

// ---- Image upload setup (blog cover images) ----
const UPLOAD_DIR = path.join(__dirname, 'uploads', 'blog');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '.jpg';
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}${safeExt}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpeg|png|webp)$/.test(file.mimetype);
    cb(ok ? null : new Error('Only JPG, PNG, or WEBP images are allowed'), ok);
  },
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
  const amount = Number(amountRaw);
  if (!amount || amount <= 0) {
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

app.post('/admin/login', (req, res) => {
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

app.get('/admin', requireAuth, (req, res) => {
  res.render('admin-dashboard', { posts: posts.listAll(), pageTitle: 'Dashboard | Admin' });
});

app.get('/admin/posts/new', requireAuth, (req, res) => {
  res.render('admin-post-form', { post: null, error: null, pageTitle: 'New Post | Admin' });
});

app.post('/admin/posts', requireAuth, upload.single('cover_image'), (req, res) => {
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

app.post('/admin/posts/:id', requireAuth, upload.single('cover_image'), (req, res) => {
  try {
    const { title, subtitle, body_markdown, status } = req.body;
    if (!title || !title.trim() || !body_markdown || !body_markdown.trim()) {
      return res.status(400).render('admin-post-form', {
        post: { ...req.body, id: req.params.id },
        error: 'Title and body are required.',
        pageTitle: 'Edit Post | Admin',
      });
    }
    posts.updatePost(req.params.id, {
      title: title.trim(),
      subtitle: (subtitle || '').trim(),
      body_markdown,
      cover_image: req.file ? `/uploads/blog/${req.file.filename}` : null,
      status: status === 'published' ? 'published' : 'draft',
    });
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
  posts.deletePost(req.params.id);
  res.redirect('/admin');
});

app.listen(PORT, () => {
  console.log(`Enrich Hope site running at http://localhost:${PORT}`);
});
