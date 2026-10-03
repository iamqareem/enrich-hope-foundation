// src/donations.js
// One row per donation attempt. Created as 'pending' the moment we redirect
// someone to Pesapal, then flipped to 'completed'/'failed' either when they
// return via the callback URL, or — more reliably — when Pesapal's IPN
// hits us server-to-server (the callback alone isn't enough: a donor can
// close the tab before the redirect completes).

const { db } = require('./db');

db.exec(`
  CREATE TABLE IF NOT EXISTS donations (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    merchant_reference TEXT NOT NULL UNIQUE,
    order_tracking_id  TEXT,
    amount             REAL NOT NULL,
    currency           TEXT NOT NULL DEFAULT 'UGX',
    donor_name         TEXT,
    donor_email        TEXT,
    donor_phone        TEXT,
    status             TEXT NOT NULL DEFAULT 'pending', -- pending | completed | failed
    status_detail      TEXT,
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const q = {
  insert: db.prepare(`
    INSERT INTO donations (merchant_reference, amount, currency, donor_name, donor_email, donor_phone, status)
    VALUES (@merchant_reference, @amount, @currency, @donor_name, @donor_email, @donor_phone, 'pending')
  `),
  getByRef: db.prepare('SELECT * FROM donations WHERE merchant_reference = ?'),
  getByTrackingId: db.prepare('SELECT * FROM donations WHERE order_tracking_id = ?'),
  setTrackingId: db.prepare(`
    UPDATE donations SET order_tracking_id = @order_tracking_id, updated_at = datetime('now')
    WHERE merchant_reference = @merchant_reference
  `),
  setStatus: db.prepare(`
    UPDATE donations SET status = @status, status_detail = @status_detail, updated_at = datetime('now')
    WHERE merchant_reference = @merchant_reference
  `),
};

function newReference() {
  return `EHF-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

module.exports = {
  newReference,
  create({ amount, currency, donor_name, donor_email, donor_phone }) {
    const merchant_reference = newReference();
    q.insert.run({
      merchant_reference,
      amount,
      currency: currency || 'UGX',
      donor_name: donor_name || null,
      donor_email: donor_email || null,
      donor_phone: donor_phone || null,
    });
    return q.getByRef.get(merchant_reference);
  },
  getByRef: (ref) => q.getByRef.get(ref),
  getByTrackingId: (id) => q.getByTrackingId.get(id),
  attachTrackingId: (merchant_reference, order_tracking_id) =>
    q.setTrackingId.run({ merchant_reference, order_tracking_id }),
  setStatus: (merchant_reference, status, status_detail) =>
    q.setStatus.run({ merchant_reference, status, status_detail: status_detail || null }),
};
