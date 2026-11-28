# Mahdar — operations

## 1. Requirements

* Docker with Compose v2, or Python 3.12 + PostgreSQL 16 + FFmpeg + the Arabic fonts (`fonts-noto-core`, `fonts-hosny-amiri`) + Pango.
* Speech on CPU: 4+ cores and 8 GB RAM for large-v3 (int8), at roughly real time or slower. A GPU
  (`MAHDAR_WHISPER_DEVICE=cuda`, `MAHDAR_WHISPER_COMPUTE_TYPE=float16`, image with CUDA 12/cuDNN 9) is
  much faster for regular use.
* Disk: the models (~3.5 GB), recordings (~1 MB per minute of MP3; the normalised copy ~2 MB/min), documents.
* Memory: the worker loads Whisper for the transcription stage and releases it afterwards; set
  `MAHDAR_WHISPER_KEEP_LOADED=true` on a dedicated speech worker to keep it loaded between jobs.

## 2. Configuration

All settings are environment variables (`MAHDAR_*`), listed with comments in `.env.docker.example`
and defined in `backend/mahdar/config.py`. In production (`MAHDAR_ENV=production`) the API, the
worker and `mahdar.cli check-config` refuse to start with a missing or short `MAHDAR_SECRET_KEY`,
a missing `MAHDAR_DATA_KEY`, a non-HTTPS `MAHDAR_PUBLIC_URL` or an unknown external provider.
The interactive API reference (`/docs`) is disabled in production; set `MAHDAR_API_DOCS=true` to
publish it.

Choosing engines:

| Need | Settings |
| --- | --- |
| Nothing leaves the network | `MAHDAR_ASR_PROVIDER=faster_whisper`, `MAHDAR_DIARIZATION_PROVIDER=sherpa_onnx`, `MAHDAR_LLM_PROVIDER=openai_compatible`, `MAHDAR_LLM_BASE_URL=http://llm:8000/v1`, `MAHDAR_ALLOWED_EXTERNAL_PROVIDERS=` |
| Claude for analysis and writing | `MAHDAR_LLM_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, `MAHDAR_ALLOWED_EXTERNAL_PROVIDERS=anthropic`, and the organization allows "transcript" → anthropic in its privacy settings |
| A cloud speech engine | `MAHDAR_ASR_PROVIDER=deepgram` (or `azure`, `openai`) + its key, add it to `MAHDAR_ALLOWED_EXTERNAL_PROVIDERS`, and the organization allows "audio" → it |
| pyannote diarization | Build with `--build-arg WITH_PYANNOTE=true`, `MAHDAR_DIARIZATION_PROVIDER=pyannote`, `HF_TOKEN` (accept the model's terms on Hugging Face first) |
| llama-cpp-python as the local server | add `MAHDAR_LLM_JSON_MODE=json_object` (it does not accept OpenAI's `json_schema` format) |

The meeting's classification caps external processing: by default only "عام" and "داخلي" meetings may
go to an allowed external provider; "سري" and "سري للغاية" stay local unless the organization raises
the ceiling.

## 3. Database roles

Two roles. The schema owner (`POSTGRES_PASSWORD`) is used only by the `migrate` service, which
also creates or updates `mahdar_app` with `MAHDAR_APP_DB_PASSWORD`. The API and the worker connect
as `mahdar_app` — no superuser, no `BYPASSRLS` — so row-level security applies to every query, and
they never receive the owner's password. Every repository query also filters by the transaction's
organization itself, so isolation holds even if a role is misconfigured; in production the API and
the worker refuse to start when their role could bypass row-level security. With a managed
database, create the two roles and set `MAHDAR_DATABASE_URL` (owner, for `migrate`) and
`MAHDAR_APP_DATABASE_URL` (runtime).

## 4. TLS

`MAHDAR_DOMAIN=minutes.example.org ACME_EMAIL=it@example.org docker compose --env-file .env.docker --profile tls up -d`
puts Caddy in front with automatic certificates. Set `MAHDAR_PUBLIC_URL=https://…`.

## 5. Backups and restore

Back up together: the PostgreSQL database (`pg_dump -Fc`), the `storage` volume (or the S3 bucket),
and — separately and offline — `MAHDAR_DATA_KEY`. Without the key, the backups cannot be read; with
the key alongside them, the encryption protects nothing. Restore: database, then storage, then start
with the same key.

## 6. Rotating the data key

1. Generate a new key (`openssl rand -base64 32`).
2. Set it as `MAHDAR_DATA_KEY`, move the old one to `MAHDAR_DATA_KEYS_PREVIOUS`, restart.
3. `docker compose exec worker python3 -m mahdar.cli rotate-data-key` (re-encrypts database values and files).
4. Remove the old key from `MAHDAR_DATA_KEYS_PREVIOUS`, restart.

## 7. Retention and deletion

Each organization sets how long recordings, transcripts and documents are kept (Settings). The
worker applies it every `MAHDAR_RETENTION_SWEEP_HOURS` (6 by default) or on demand with
`python -m mahdar.cli purge-expired`. Deleting a meeting removes its files and content; its audit
entries remain (who did what, and when), but their encrypted before/after details are removed with
the content. A meeting cannot be deleted while it is being processed.

## 8. Monitoring

* `/healthz` (process alive) and `/readyz` (database reachable, schema present) on the API; the
  worker's health check reads its heartbeat (`mahdar.cli worker-health`).
* JSON logs on stdout: requests (method, path, status, duration, request id), job stages, failures.
  No transcript text, names, titles, file names or keys are logged.
* Per-meeting stage history and errors in the interface (Processing tab) and in `jobs.stages`.
* Every model call's token usage is stored with the meeting (`documents.usage`) and in the
  processing register — the basis for cost tracking.

## 9. Failure handling

Jobs retry with exponential backoff (30 s, 60 s, … up to 15 min; `MAHDAR_JOB_MAX_ATTEMPTS`) on
retryable errors (timeouts, rate limits, provider outages). A worker that dies leaves its job
"running" without heartbeat; after 5 minutes another worker takes it over. Stages already saved
are not redone; transcription resumes at the next chunk. Non-retryable errors (unreadable audio,
a refused key, missing authorization) stop with an Arabic message; "awaiting authorization" keeps
the transcript available and resumes from analysis once the policy allows it.

## 10. Upgrading

Rebuild the image, `docker compose up -d` (the `migrate` service applies new migrations first).
Speech models are cached in the `models` volume and survive upgrades.
