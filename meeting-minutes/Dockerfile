# syntax=docker/dockerfile:1
# Mahdar (Arabic meeting minutes): one image for the API, the worker and the database migrations
# (same image, different command). The Arabic review interface is built in the first stage and is
# served by the API, so the whole system is one origin.
#
# Base images are pinned by digest, as in the rest of the repository: a rebuild gets the same bytes
# until Dependabot (.github/dependabot.yml) proposes a newer digest, which is then tested like any
# change. The runtime is Ubuntu 24.04 LTS (supported until 2029) for its Arabic fonts, FFmpeg and Pango.
#
# Build:   docker build -t mahdar:local meeting-minutes
# Options: --build-arg WITH_PYANNOTE=true   adds pyannote.audio (and PyTorch for CPU, about 1 GB) for
#                                            diarization with pyannote's gated models (needs HF_TOKEN).
#          --secret id=build_ca,src=ca.crt   builds behind a TLS-intercepting proxy; the CA is never
#                                            stored in an image layer.

FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=secret,id=build_ca,required=false \
    if [ -s /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca npm_config_cafile=/run/secrets/build_ca; fi; \
    npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM ubuntu:24.04@sha256:562111b88caa79c71391c0c4d3c2114a7d5c35915c20561fd893cb1e07929e6b AS runtime
ARG WITH_PYANNOTE=false
ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH=/opt/venv/bin:$PATH \
    MAHDAR_WEB_DIR=/app/web \
    MAHDAR_DATA_DIR=/data \
    HF_HOME=/data/models/huggingface

# FFmpeg: audio intake, normalisation and segment playback. Fonts: Noto Naskh/Sans/Kufi Arabic
# (fonts-noto-core) and Amiri for the DOCX and PDF minutes; the self-check refuses to pass without
# them. Pango and HarfBuzz: Arabic shaping and right-to-left layout in the PDF (WeasyPrint).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       python3 python3-venv ca-certificates ffmpeg libgomp1 \
       fontconfig fonts-noto-core fonts-hosny-amiri \
       libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz-subset0 \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -f

WORKDIR /app
# Dependencies first (from pyproject.toml's pinned list), so a code change does not reinstall them.
COPY backend/pyproject.toml ./backend/pyproject.toml
RUN --mount=type=secret,id=build_ca,required=false \
    if [ -s /run/secrets/build_ca ]; then export PIP_CERT=/run/secrets/build_ca; fi; \
    python3 -m venv /opt/venv \
    && pip install --no-cache-dir --upgrade pip "setuptools>=75" \
    && python3 -c "import tomllib; print('\n'.join(tomllib.load(open('backend/pyproject.toml','rb'))['project']['dependencies']))" > /tmp/requirements.txt \
    && pip install --no-cache-dir -r /tmp/requirements.txt \
    && if [ "$WITH_PYANNOTE" = "true" ]; then \
         pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch torchaudio \
         && python3 -c "import tomllib; print('\n'.join(tomllib.load(open('backend/pyproject.toml','rb'))['project']['optional-dependencies']['pyannote']))" > /tmp/pyannote.txt \
         && pip install --no-cache-dir -r /tmp/pyannote.txt; \
       fi \
    && rm -f /tmp/requirements.txt /tmp/pyannote.txt

COPY backend/ ./backend/
# No network at this step: dependencies and setuptools are already installed.
RUN pip install --no-cache-dir --no-deps --no-build-isolation ./backend
COPY --from=web /web/dist /app/web

# An unprivileged user; /data holds the encrypted recordings and documents (storage) and the
# speech models (models), both volumes in docker-compose.yml.
RUN useradd --system --uid 10001 --home-dir /app --shell /usr/sbin/nologin mahdar \
    && mkdir -p /data/storage /data/models \
    && chown -R mahdar:mahdar /data
USER mahdar
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python3 -c "import sys,urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=4).status == 200 else 1)"
CMD ["uvicorn", "mahdar.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
