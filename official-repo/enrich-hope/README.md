# Enrich Hope Foundation — Site + Blog + Donations

The main site (`public/`) is the same static page as before, now with two
more services (Mosque Construction, Borehole Drilling). On top of it sits a
small blog: a public `/blog`, and a password-protected `/admin` where the
owner writes and publishes posts (title, subtitle, cover image, body). The
Donate button on the main site now goes through Pesapal for real checkout.

## Why SQLite

One admin writes occasionally; anyone can read. That's exactly the shape
SQLite is built for. It's a single file (`data/blog.db`) — no separate
database server to install, configure, back up, or secure. Backing up the
blog (and donation records) is `cp data/blog.db somewhere-safe.db`.
Restoring is copying it back. There's no `users` table either — just one
admin account, defined by two environment variables (see below), because
there's only ever one person logging in.

## Architecture, in one paragraph

`server.js` is the entire app: it serves the static site from `public/`,
handles the blog (public pages + admin), and handles donations (Pesapal)
— all in the same process. One `node server.js` is the whole deployment —
no separate frontend build, no second service to run. Posts are written as
Markdown in a plain textarea and rendered to HTML on the way out. Cover
images are saved to `uploads/blog/` on disk (not in the database) — same
pattern as the images folder already in use for the main site.

**Trade-off worth knowing:** before this, the site was pure static files —
deployable on literally any web host, no server process required. Now it
needs a Node process running continuously (PM2, in this setup) because
logins, publishing, and payment processing all require a backend. That's
the unavoidable cost of "log in and hit Publish" — and of taking donations
without exposing any secret key in the browser.

## Donations (Pesapal)

The Donate button submits a plain HTML form to `/donate/start` — a normal
server route, not client-side JavaScript — which is what keeps the Pesapal
consumer key and secret out of the browser entirely. `src/pesapal.js` is
the only file that talks to Pesapal's API; `src/donations.js` keeps a
`donations` table (one row per attempt: amount, donor info if given, status)
in the same SQLite database as everything else.

Flow: donor picks/enters an amount → `/donate/start` creates a `pending`
donation row and asks Pesapal for a checkout link → donor is redirected to
Pesapal to actually pay → Pesapal sends the result two ways: the donor's
browser bounces back to `/donate/callback` (nice for showing a thank-you
page), and Pesapal separately calls `/donate/ipn` server-to-server (the
one that's actually reliable, since a donor can close the tab before the
browser redirect completes).

**Until `PESAPAL_CONSUMER_KEY`/`PESAPAL_CONSUMER_SECRET`/`PUBLIC_BASE_URL`
are set in `.env`, the Donate button shows a friendly "coming soon" page**
instead of erroring — so the rest of the site (including the new services)
can go live before the merchant account is ready. See `DEPLOY.md` for the
full checklist to switch real payments on — it needs a live HTTPS domain,
which Pesapal requires for the callback/IPN URLs to work at all.

## Local setup

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

```bash
# random session-signing secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# bcrypt hash of the real admin password
node -e "console.log(require('bcryptjs').hashSync('your-real-password', 10))"
```

Paste those into `SESSION_SECRET` and `ADMIN_PASSWORD_HASH` in `.env`, and
set `ADMIN_USERNAME` to whatever you like. Leave the `PESAPAL_*` values
blank for now — see "Donations" above.

```bash
npm start
```

Visit `http://localhost:3000` for the site, `http://localhost:3000/blog`
for the blog, and `http://localhost:3000/admin` to log in and write posts.

## Running with PM2

```bash
npm install -g pm2   # if not already installed
npm install
cp .env.example .env # fill it in as described above
npm run pm2:start
pm2 save             # so it comes back after a reboot
```

`ecosystem.config.js` is the whole PM2 config — one process, named
`enrich-hope`, running `server.js`. Useful commands:

```bash
npm run pm2:logs       # tail logs
npm run pm2:restart    # after pulling code changes
pm2 status              # see it's running
```

If you want it to survive a server reboot, run `pm2 startup` once (it
prints a command to copy-paste) and then `pm2 save`.

**Going to a real VPS?** See `DEPLOY.md` for the full walkthrough —
domain, HTTPS, nginx, firewall, and turning on real Pesapal payments.

## Day-to-day: writing a post

1. Go to `/admin`, log in.
2. "New Post" → fill in title, optional subtitle, optional cover image,
   and the body (plain text or light Markdown — `**bold**`, `*italic*`,
   `## Heading`, `- list item`, blank line for a new paragraph).
3. Leave "Published" unchecked to save it as a draft (only visible in the
   admin dashboard), or check it to make it live on `/blog` immediately.
4. Edit or delete any post from `/admin` at any time.

## Folder structure

```
server.js            entry point — all routes
src/db.js             SQLite schema + post/settings queries
src/auth.js           single-admin login check
src/donations.js       donations table + queries
src/pesapal.js         Pesapal API client (the only file with the keys)
views/                 EJS templates (public blog + admin + donate status)
public/                the existing static site + blog.css
uploads/blog/          uploaded cover images (persist on disk)
data/blog.db            the database — posts, donations, settings
ecosystem.config.js      PM2 process config
DEPLOY.md               step-by-step VPS deployment guide
```

## Security notes

- Change the default-feeling `ADMIN_USERNAME`/password before going live.
- Once the site is served over HTTPS, uncomment `secure: true` in the
  cookie-session config in `server.js` so the session cookie is HTTPS-only.
- The admin body editor trusts the logged-in admin's Markdown/HTML input —
  there's exactly one admin account, so this is intentional. Don't share
  admin credentials with anyone you wouldn't trust to edit the site directly.
- Never commit `.env` — it holds the session secret and, eventually, real
  Pesapal credentials.
