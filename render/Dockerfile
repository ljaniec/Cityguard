# Jeden obraz na Render: dashboard + API + mock (bez Torch / YOLO).
# Kontekst builda = katalog główny repozytorium.

FROM node:22-alpine AS frontend
WORKDIR /fe
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt opencv-python-headless

COPY backend/app /app/app
COPY data /app/data
COPY ml/infer.py /app/ml/infer.py
COPY render/asgi.py /app/asgi.py
COPY render/entrypoint.sh /app/entrypoint.sh
COPY --from=frontend /fe/dist /app/frontend/dist

RUN chmod +x /app/entrypoint.sh \
    && mkdir -p /app/storage/media

ENV CITYGUARD_ROOT=/app \
    CITYGUARD_STORAGE=/app/storage \
    CITYGUARD_STATIC=/app/frontend/dist \
    PYTHONUNBUFFERED=1

EXPOSE 8000
CMD ["/app/entrypoint.sh"]
