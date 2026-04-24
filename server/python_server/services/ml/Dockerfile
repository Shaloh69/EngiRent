# ── Stage 1: builder ──────────────────────────────────────────────────────────
# dlib-bin provides a pre-compiled wheel for Python 3.11 — no cmake needed.
FROM python:3.11-slim AS builder

WORKDIR /build

COPY requirements.txt .

# Install numpy first so torch/other packages don't upgrade it past 1.x.
# opencv 4.9.0.80 and dlib-bin are both compiled against numpy 1.x — they conflict
# with numpy 2.x. Pinning numpy==1.26.4 here prevents any later step from upgrading it.
RUN pip install --no-cache-dir --prefix=/install numpy==1.26.4 && \
    pip install --no-cache-dir --prefix=/install \
        torch==2.5.1+cpu \
        torchvision==0.20.1+cpu \
        --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir --prefix=/install dlib-bin && \
    pip install --no-cache-dir --prefix=/install face_recognition==1.3.0 --no-deps && \
    grep -v "^dlib-bin\|^face_recognition==\|^torch\|^torchvision\|^numpy" requirements.txt > requirements_rest.txt && \
    pip install --no-cache-dir --prefix=/install -r requirements_rest.txt


# ── Stage 2: runtime — slim image, no compilers ───────────────────────────────
FROM python:3.11-slim

WORKDIR /app

# Runtime-only native libs:
#   libglib2.0-0  — OpenCV runtime dep
#   libgl1        — OpenCV headless still needs libGL.so.1
#   tesseract-ocr — OCR backend for pytesseract
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libgl1 \
    tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

# Copy all pip-installed packages from the builder
COPY --from=builder /install /usr/local

COPY app/ ./app/

EXPOSE 8001

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8001}"]
