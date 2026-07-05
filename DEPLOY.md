# How to Go Live — Archery.Services

## Option 1 — Railway (Recommended, free to start)

1. Push this folder to a GitHub repository (private is fine).
2. Go to https://railway.app → New Project → Deploy from GitHub Repo.
3. Select the repo. Railway auto-detects Node.js and runs `node local-server.js`.
4. Go to **Variables** tab and add:
   - `ADMIN_PASSWORD` = your chosen password (e.g. `ArcheryAdmin2025!`)
   - `PORT` is set automatically by Railway — do NOT set it yourself.
5. Go to **Settings → Domains** → Generate Domain → you'll get a `.up.railway.app` URL immediately.
6. To use your own domain (e.g. `archery.services`):
   - Add a **Custom Domain** in Railway Settings.
   - Copy the CNAME value Railway gives you.
   - In your domain registrar (GoDaddy, Namecheap, etc.) add a CNAME record:
     `www  →  <value from Railway>`
   - For the root (`@`), use ALIAS/ANAME if your registrar supports it, or point to Railway's IP.

---

## Option 2 — Render (also free to start)

1. Push to GitHub.
2. https://render.com → New → Web Service → Connect repo.
3. Build command: (leave blank or `npm install` if you later add packages)
4. Start command: `node local-server.js`
5. Add environment variable: `ADMIN_PASSWORD` = your password.
6. Render gives you a `.onrender.com` URL. Custom domain setup is the same as above.

---

## Option 3 — VPS (DigitalOcean / Linode / Contabo)

```bash
# On the server:
sudo apt update && sudo apt install -y nodejs npm
git clone https://github.com/YOUR/repo.git archery
cd archery
npm install       # only needed if you add packages
export ADMIN_PASSWORD="ArcheryAdmin2025!"
node local-server.js &  # runs in background

# For auto-restart on crash, use PM2:
npm install -g pm2
ADMIN_PASSWORD="ArcheryAdmin2025!" pm2 start local-server.js --name archery
pm2 save && pm2 startup
```

Then point your domain via A record to the server IP, and optionally set up Nginx as a reverse proxy.

---

## Data file

All your content is saved to `data.json` in the project folder automatically.
Back this file up regularly (download it, or commit it to a private repo).
On Railway/Render it lives inside the container — use their file storage or a DB for true persistence.

---

## Admin login

After deploying, go to `https://yourdomain.com/admin.html`
Default password: `archery2025`
**Change it immediately** by setting the `ADMIN_PASSWORD` environment variable.
