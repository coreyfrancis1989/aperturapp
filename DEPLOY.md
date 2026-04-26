# Apertur App — Railway Deployment Guide

End-to-end guide for getting `Apertur_CARF_v3.html` + `server.py` deployed
as a web app at `app.apertur.app` via Railway.

Time to first deploy: **~30 minutes**, most of which is Railway's first
Docker build (PyTorch is heavy).

---

## What's in this bundle

| File | Purpose |
|---|---|
| `Dockerfile` | Tells Railway how to build your container |
| `requirements.txt` | Python dependencies (PyTorch, DeepGaze, CLIP, Flask) |
| `railway.toml` | Railway-specific build & deploy config |
| `.dockerignore` | Files Docker should skip when building (saves space) |
| `gunicorn_config.py` | Production server config (optional but recommended) |
| `DEPLOY.md` | This file |

These all live in the **root of your app's GitHub repo**, alongside
`server.py` and `Apertur_CARF_v3.html`.

---

## Prerequisites

1. **A GitHub account** (you already have one — same one as the marketing site)
2. **A Railway account** — sign up at https://railway.app with GitHub
3. **An Anthropic API key** — for the Claude vision pipeline (sign up at console.anthropic.com)
4. **Your `server.py` and `Apertur_CARF_v3.html`** ready to push

---

## Step 1 — Tweak `server.py` for production

Two small edits before you push to GitHub. Open `server.py` and find the
bottom where you start the Flask server. You probably have something like:

```python
if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8000, debug=True)
```

**Change it to:**

```python
import os

if __name__ == "__main__":
    PORT = int(os.environ.get("PORT", 8000))
    app.run(host="0.0.0.0", port=PORT, debug=False)
```

Why:
- `host="0.0.0.0"` makes the container accept external traffic (without
  this, requests from Railway's load balancer can't reach Flask)
- `PORT` env var lets Railway route traffic to whatever port it assigns
- `debug=False` is a security must in production

Also make sure your Flask app is exposed as `app` at module scope — that
is, `app = Flask(__name__)` at the top, not inside a function. Gunicorn
imports it via `server:app` so it has to be importable.

---

## Step 2 — Add a `/api/status` health check endpoint

Railway pings this every 30 seconds to know if your app is alive. Without
it, Railway will assume the app is broken and restart it constantly.

Add to `server.py`:

```python
@app.route("/api/status")
def status():
    return {"status": "ok", "service": "apertur-carf"}, 200
```

That's it — just needs to return 200. The `railway.toml` is already
configured to hit this endpoint.

---

## Step 3 — Lock the app behind Basic Auth (recommended)

Right now anyone with the URL can hit your inference endpoints. Add a
simple username/password gate before going live.

Install `Flask-HTTPAuth` (already listed in `requirements.txt`? It isn't
— add it):

```
# Add this line to requirements.txt
Flask-HTTPAuth>=4.8.0
```

Then in `server.py`, near the top:

```python
import os
from flask_httpauth import HTTPBasicAuth
from werkzeug.security import check_password_hash, generate_password_hash

auth = HTTPBasicAuth()

# Read credentials from env vars (set these in Railway dashboard)
USERS = {
    os.environ.get("APP_USERNAME", "admin"):
        generate_password_hash(os.environ.get("APP_PASSWORD", "change-me")),
}

@auth.verify_password
def verify_password(username, password):
    if username in USERS and check_password_hash(USERS[username], password):
        return username
    return None
```

Then on every route you want protected:

```python
@app.route("/")
@auth.login_required
def index():
    return send_from_directory(".", "Apertur_CARF_v3.html")

@app.route("/api/analyze", methods=["POST"])
@auth.login_required
def analyze():
    # ... existing code ...
```

Don't put `@auth.login_required` on `/api/status` — Railway needs to
hit that without auth.

In Railway's dashboard later, you'll set:
- `APP_USERNAME` = something memorable like `pilot`
- `APP_PASSWORD` = a long random string (use `openssl rand -base64 24` to generate)

---

## Step 4 — Push everything to GitHub

Create a new GitHub repo (e.g., `apertur-app`) — keep it **private** since
your inference logic is your IP.

Place these files in the repo root:

```
apertur-app/
├── server.py                   ← your existing backend
├── Apertur_CARF_v3.html         ← your existing frontend
├── requirements.txt            ← from this bundle
├── Dockerfile                  ← from this bundle
├── railway.toml                ← from this bundle
├── .dockerignore               ← from this bundle
└── gunicorn_config.py          ← from this bundle (optional)
```

Commit and push:

```bash
git init
git add .
git commit -m "Initial deploy"
git branch -M main
git remote add origin git@github.com:YOUR_USERNAME/apertur-app.git
git push -u origin main
```

---

## Step 5 — Deploy on Railway

1. Go to **railway.app → New Project → Deploy from GitHub repo**
2. Select your `apertur-app` repo
3. Railway detects the `Dockerfile` and starts building. **First build
   takes 8–12 minutes** because PyTorch is ~750MB and pip has to compile
   some bits. Subsequent builds are 1–2 minutes thanks to Docker layer
   caching.
4. While it builds, click **Variables** in the Railway sidebar and add:
   - `ANTHROPIC_API_KEY` = your Claude API key
   - `APP_USERNAME` = e.g., `pilot`
   - `APP_PASSWORD` = generate with `openssl rand -base64 24`
5. Once the build succeeds, click **Settings → Networking → Generate
   Domain**. Railway gives you a URL like
   `apertur-app-production.up.railway.app`.
6. Visit that URL. You should get a Basic Auth prompt. Log in with the
   username/password you set. The app should load.

If the build fails, click into the build logs to see why. Most common
issues:
- **Out of memory during pip install** → Railway's free tier has 512MB.
  PyTorch fits, but barely. If you hit OOM, upgrade to the $5/mo Hobby
  plan which gives 8GB.
- **CLIP install fails** → it sometimes can't find a wheel. The
  Dockerfile already handles this with a fallback. If you still hit
  errors, comment out the CLIP pre-cache line.
- **Healthcheck failing** → make sure `/api/status` is implemented and
  returns 200. Check Railway logs.

---

## Step 6 — Point `app.apertur.app` at it

You want it at a custom domain, not the ugly Railway URL.

1. **Railway → Settings → Networking → Custom Domain → add `app.apertur.app`**
2. Railway shows you a CNAME target — something like
   `xyz-production.up.railway.app`. Copy it.
3. Open **Cloudflare → your apertur.app domain → DNS → Records**
4. **Add record:**
   - Type: `CNAME`
   - Name: `app`
   - Target: paste the Railway CNAME target
   - Proxy status: **DNS only** (grey cloud, NOT orange) — Railway needs
     to handle TLS itself
   - TTL: Auto
5. Save. DNS propagates in 30 seconds.
6. Visit `https://app.apertur.app` — should load with Basic Auth prompt.
   Railway provisions a TLS cert automatically within a few minutes.

---

## Step 7 — Test the full flow

1. Visit `https://app.apertur.app`
2. Enter your Basic Auth credentials
3. Upload a test image
4. Confirm the analysis completes (takes 15-30s on CPU, that's normal)
5. Check Railway logs for any errors

If you hit issues, the logs are at:
**Railway dashboard → your service → Deployments → click the active
deployment → View Logs**

---

## Cost expectations

Railway pricing as of early 2026:

- **Free tier:** $5/mo credit, sleeps after 30 days of inactivity
- **Hobby plan:** $5/mo + usage. Realistic monthly cost for your traffic:
  - **No users:** ~$5 (just the base)
  - **5-10 active pilot users running 50 analyses/mo:** ~$10-15
  - **Heavier traffic, dozens of analyses/day:** $25-50

The bottleneck is RAM (your container uses ~1-2GB) and CPU during
inference. If you grow past pilot stage, look at:
- Modal Labs for ML-specific scale-to-zero
- A GPU-equipped host for 10-100x faster inference

---

## Common gotchas

**1. Container crashes on startup with "Address already in use"**
- You're trying to bind to port 8000 explicitly when Railway has assigned
  a different port. Use `os.environ.get("PORT")` (Step 1).

**2. First request after deploy takes 60+ seconds**
- ML model weights are loading into RAM on first request. The Dockerfile
  pre-caches them at build time, but they still need to load on container
  startup. Use Railway's "warmup" endpoint feature, or accept it.

**3. Cloudflare proxy breaks the connection**
- Make sure Cloudflare proxy is **OFF (grey cloud)** for the `app`
  CNAME. Railway handles TLS. Cloudflare proxy on top can confuse routing.

**4. Build fails with "No space left on device"**
- Free tier disk is small. Upgrade to Hobby ($5/mo) and you get 8GB.

**5. Memory keeps creeping up**
- ML inference doesn't always release tensors. Add `torch.cuda.empty_cache()`
  (or `gc.collect()` for CPU) at the end of each analysis function.

---

## Next steps after launch

Once it's live:

1. **Monitor first 10 sessions closely.** Watch Railway logs in real time
   to catch any errors only real users would surface.
2. **Add error reporting.** Sentry has a generous free tier — 10 minutes
   to integrate, saves hours of debugging later.
3. **Consider rate limiting.** Even with Basic Auth, you don't want one
   user spamming 100 analyses and exhausting your Anthropic quota. Use
   `flask-limiter`.
4. **Backup analyses.** Store every analysis result in a database (Railway
   provides Postgres for $5/mo). Right now your app loses everything on
   restart.
5. **Plan for real auth.** Basic Auth is fine for pilot. Once you have
   paying customers, swap it for Clerk or Supabase Auth (~2 hours of
   work).

---

## If something goes wrong

Tell me what the error message is and what step you were on. Most
deployment issues fall into a small handful of categories and are fixable
in 5-10 minutes. Railway's UI shows logs clearly — copy/paste the error
and we'll debug it.
