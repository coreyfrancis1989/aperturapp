# Gunicorn config for production deployment.
# This is optional — only used if present. Otherwise the Dockerfile falls
# back to running `python server.py` directly.

import os

# Bind to 0.0.0.0 so the container accepts external traffic.
# Railway sets the PORT env var; default to 8000 for local dev.
bind = f"0.0.0.0:{os.environ.get('PORT', 8000)}"

# Single worker because the ML models load into RAM (PyTorch + CLIP weights
# can use 1-2GB combined). Multi-worker would multiply the RAM usage.
# When you upgrade to Railway Pro with more RAM, bump this to 2-4.
workers = 1

# Timeout: ML inference can take 10-30s on CPU. Default of 30s is too tight.
timeout = 120

# Sync worker is fine for ML inference (CPU-bound, not I/O-bound).
# Don't switch to gevent/eventlet — PyTorch doesn't play well with them.
worker_class = "sync"

# Per-request log line. Helpful for debugging slow requests.
accesslog = "-"
errorlog = "-"
loglevel = "info"

# Graceful shutdown: let in-flight requests complete on redeploy.
graceful_timeout = 30

# Useful for seeing which requests are running long.
capture_output = True
