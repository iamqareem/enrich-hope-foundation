// src/auth.js
// There is exactly one admin (the site owner), so there's no "users" table —
// just a username and a bcrypt password hash, both set via environment
// variables (see .env.example). The session itself lives in a signed,
// encrypted cookie (via cookie-session), so there's no session store to run
// or clean up either.

const bcrypt = require('bcryptjs');

function checkCredentials(username, password) {
  const okUser = username === process.env.ADMIN_USERNAME;
  const okPass =
    process.env.ADMIN_PASSWORD_HASH &&
    bcrypt.compareSync(password || '', process.env.ADMIN_PASSWORD_HASH);
  return Boolean(okUser && okPass);
}

function requireAuth(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.redirect('/admin/login');
}

module.exports = { checkCredentials, requireAuth };
