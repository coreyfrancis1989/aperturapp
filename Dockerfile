FROM python:3.11-slim

# System deps for Pillow, image processing, and PyTorch
RUN apt-get update && apt-get install -y \
    build-essential \
    git \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first (better Docker layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Pre-download model weights at build time so first request isn't slow
RUN python -c "import torch; \
    from torchvision.models import resnet50, ResNet50_Weights; \
    resnet50(weights=ResNet50_Weights.DEFAULT); \
    print('Torchvision weights cached')"

RUN python -c "import clip; \
    clip.load('ViT-B/32', device='cpu'); \
    print('CLIP weights cached')" || echo "CLIP cache skipped"

# Copy app code (after deps so code changes don't invalidate the deps cache)
COPY . .

EXPOSE 8000

# Use gunicorn if config exists, else fallback to python server.py
CMD ["sh", "-c", "if [ -f gunicorn_config.py ]; then gunicorn -c gunicorn_config.py server:app; else python server.py; fi"]
