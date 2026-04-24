# ── Stage 1: builder — compile dlib and all CPU-heavy packages ────────────────
FROM python:3.12-slim AS builder

WORKDIR /build

# Build tools required to compile dlib from source
# libopenblas-dev provides BLAS routines dlib links against at runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    cmake \
    build-essential \
    libopenblas-dev \
    liblapack-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

# Install CPU-only torch first (avoids pulling the ~2 GB CUDA variant)
# Then install the rest of requirements (including face_recognition/dlib)
RUN grep -v "^torch\|^torchvision" requirements.txt > requirements_base.txt && \
    pip install --no-cache-dir --prefix=/install \
        torch==2.5.1+cpu \
        torchvision==0.20.1+cpu \
        --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir --prefix=/install -r requirements_base.txt


# ── Stage 2: runtime — slim image, no compilers ───────────────────────────────
FROM python:3.12-slim

WORKDIR /app

# Runtime-only native libs:
#   libopenblas0     — shared library dlib compiled against
#   libglib2.0-0     — OpenCV runtime dep
#   libgl1           — OpenCV headless still needs libGL.so.1
#   tesseract-ocr    — OCR backend for pytesseract
RUN apt-get update && apt-get install -y --no-install-recommends \
    libopenblas0 \
    libglib2.0-0 \
    libgl1 \
    tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

# Copy all pip-installed packages from the builder
COPY --from=builder /install /usr/local

COPY app/ ./app/

EXPOSE 8001

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8001}"]
