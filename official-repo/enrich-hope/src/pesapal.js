// src/pesapal.js
// All Pesapal API 3.0 calls live here, and only here — this is the one file
// that touches the consumer key/secret. Nothing in public/ ever sees them;
// the frontend only ever POSTs to our own /donate/start route, which then
// talks to Pesapal from the server.
//
// Docs: https://developer.pesapal.com/how-to-integrate/e-commerce/api-30-overview
//
// Until PESAPAL_CONSUMER_KEY / PESAPAL_CONSUMER_SECRET are set in .env,
// isConfigured() returns false and server.js shows a "coming soon" message
// instead of calling any of this — so the donate button can go live on the
// site today without a working merchant account yet.

const db = require('./db');

const ENV = (process.env.PESAPAL_ENV || 'sandbox').toLowerCase();
const BASE_URL =
  ENV === 'live'
    ? 'https://pay.pesapal.com/v3'
    : 'https://cybqa.pesapal.com/pesapalv3';

let cachedToken = null; // { token, expiresAt }

function isConfigured() {
  return Boolean(process.env.PESAPAL_CONSUMER_KEY && process.env.PESAPAL_CONSUMER_SECRET && process.env.PUBLIC_BASE_URL);
}

async function getToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.token;
  }
  const res = await fetch(`${BASE_URL}/api/Auth/RequestToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      consumer_key: process.env.PESAPAL_CONSUMER_KEY,
      consumer_secret: process.env.PESAPAL_CONSUMER_SECRET,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.token) {
    throw new Error(`Pesapal auth failed: ${data.message || res.status}`);
  }
  // Pesapal tokens are short-lived (~5 min) — cache for 4 to be safe.
  cachedToken = { token: data.token, expiresAt: Date.now() + 4 * 60_000 };
  return data.token;
}

async function getIpnId() {
  const cached = db.getSetting('pesapal_ipn_id');
  if (cached) return cached;

  const token = await getToken();
  const res = await fetch(`${BASE_URL}/api/URLSetup/RegisterIPN`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      url: `${process.env.PUBLIC_BASE_URL}/donate/ipn`,
      ipn_notification_type: 'GET',
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.ipn_id) {
    throw new Error(`Pesapal IPN registration failed: ${data.message || res.status}`);
  }
  db.setSetting('pesapal_ipn_id', data.ipn_id);
  return data.ipn_id;
}

async function submitOrder({ merchantReference, amount, currency, description, email, phone, firstName, lastName }) {
  const token = await getToken();
  const notificationId = await getIpnId();

  const res = await fetch(`${BASE_URL}/api/Transactions/SubmitOrderRequest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      id: merchantReference,
      currency: currency || 'UGX',
      amount,
      description: description || 'Donation to Enrich Hope Foundation',
      callback_url: `${process.env.PUBLIC_BASE_URL}/donate/callback`,
      notification_id: notificationId,
      billing_address: {
        email_address: email || undefined,
        phone_number: phone || undefined,
        first_name: firstName || undefined,
        last_name: lastName || undefined,
        country_code: 'UG',
      },
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.redirect_url) {
    throw new Error(`Pesapal order submission failed: ${data.error?.message || data.message || res.status}`);
  }
  return data; // { order_tracking_id, merchant_reference, redirect_url }
}

async function getTransactionStatus(orderTrackingId) {
  const token = await getToken();
  const res = await fetch(
    `${BASE_URL}/api/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(orderTrackingId)}`,
    { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Pesapal status check failed: ${data.message || res.status}`);
  }
  return data; // includes payment_status_description: PENDING | COMPLETED | FAILED | INVALID
}

module.exports = { isConfigured, submitOrder, getTransactionStatus };
