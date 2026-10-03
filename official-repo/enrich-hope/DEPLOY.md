# Deploying to your VPS

Everything needed to take this from "runs on my machine" to a live site with
working donations. Roughly in order.

## 1. Server prerequisites

- A VPS with a public IP (any provider is fine)
- A domain name, with an **A record pointing at that IP**
  (e.g. `enrichhopefoundation.org` → `your.vps.ip.address`)
- Node.js 18+ installed (`node --version` to check)
- `git` (or another way to get the code onto the server)
- PM2 installed globally: `npm install -g pm2`
- `nginx` (or another reverse proxy) — the Node app listens on a plain HTTP
  port; nginx sits in front of it and handles HTTPS
- `certbot` for a free TLS certificate (Let's Encrypt)

## 2. Why HTTPS is not optional here

Pesapal's callback and IPN URLs **must be publicly reachable over HTTPS**.
`PUBLIC_BASE_URL` in `.env` has to be your real `https://` domain — Pesapal
will not call back to `http://` or to an IP address, and it can't reach
`localhost` at all. So the order here matters: get the domain and TLS
working *before* filling in real Pesapal credentials, otherwise donations
will silently fail to complete.

## 3. Get the code onto the server

```bash
git clone <your-repo-url> enrich-hope
cd enrich-hope
npm install
cp .env.example .env
```

Fill in `.env` (see the main README for how to generate `SESSION_SECRET`
and `ADMIN_PASSWORD_HASH`). Set:

```
PUBLIC_BASE_URL=https://yourdomain.org
```

Leave the `PESAPAL_*` values blank for now if you don't have merchant
credentials yet — the Donate button will show a "coming soon" message
instead of erroring, so the rest of the site can go live immediately.

## 4. Start it with PM2

```bash
npm run pm2:start
pm2 save
pm2 startup   # prints a command — copy-paste and run it once,
              # so PM2 restarts the app automatically after a server reboot
```

The app listens on `PORT` from `.env` (default `3000`) — not exposed to the
internet directly, nginx will proxy to it.

## 5. nginx reverse proxy

Create `/etc/nginx/sites-available/enrichhopefoundation.org`:

```nginx
server {
    listen 80;
    server_name yourdomain.org www.yourdomain.org;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/enrichhopefoundation.org /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## 6. TLS certificate

```bash
sudo certbot --nginx -d yourdomain.org -d www.yourdomain.org
```

Certbot edits the nginx config to add the HTTPS block and sets up
auto-renewal. Confirm `https://yourdomain.org` loads before moving on.

## 7. Firewall

Only nginx (80/443) needs to be open to the world — the Node app itself
(port 3000) should not be:

```bash
sudo ufw allow 'Nginx Full'
sudo ufw allow OpenSSH
sudo ufw enable
sudo ufw status
```

## 8. Turn on real Pesapal payments

Once `https://yourdomain.org` is live:

1. Get merchant credentials from the Pesapal dashboard (Settings → API) —
   start with the sandbox key/secret to test end-to-end, then switch to
   live ones.
2. Fill in `.env`:
   ```
   PESAPAL_ENV=sandbox        # then "live" once you've tested and are ready
   PESAPAL_CONSUMER_KEY=...
   PESAPAL_CONSUMER_SECRET=...
   PUBLIC_BASE_URL=https://yourdomain.org
   ```
3. Restart: `npm run pm2:restart`
4. Make a small real test donation end-to-end (sandbox first) and confirm
   it shows up correctly — the app registers its IPN URL with Pesapal
   automatically the first time it's needed, so there's no separate manual
   registration step.

## 9. Ongoing maintenance

- **Backups:** `data/blog.db` is the entire database (posts + donation
  records). Back it up regularly:
  ```bash
  cp data/blog.db backups/blog-$(date +%F).db
  ```
  Also back up `uploads/blog/` (blog cover images) — same idea, it's just
  files on disk.
- **Deploying updates:**
  ```bash
  git pull
  npm install   # only needed if package.json changed
  npm run pm2:restart
  ```
- **Logs:** `npm run pm2:logs`, or `pm2 logs enrich-hope --lines 200`
- **Renewing TLS:** certbot sets up auto-renewal via a systemd timer or cron
  job — check it's active with `sudo certbot renew --dry-run`.
