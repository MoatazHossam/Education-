# مَحضَر — Mahdar

**محاضر اجتماعات عربية رسمية، كل ما فيها مستند إلى التسجيل.** يستقبل النظام تسجيلاً صوتياً لاجتماع
(بالعامية المصرية أو الخليجية أو الفصحى، مع المصطلحات الإنجليزية)، فيفرّغه ويميّز المتحدثين، ويستخرج
الموضوعات والمقترحات والقرارات والتكليفات، ويتحقق من كل بند مقابل نص التسجيل، ثم يصوغ محضراً رسمياً
بالفصحى بصيغتي Word وPDF من اليمين إلى اليسار، مع تقرير منفصل للأدلة وعدم اليقين. لا يُعتمد أي محضر
آلياً: المراجعة والاعتماد بيد البشر، وكل تعديل مسجَّل.

**Evidence-grounded Arabic meeting minutes.** Upload a recording; get formal Modern Standard Arabic
minutes (DOCX, PDF), an executive summary, an action-item table (CSV), a timestamped transcript, an
evidence and uncertainty report and structured JSON — every material statement linked to the
words and the second of the recording it comes from. Nothing is approved automatically.

| | |
| --- | --- |
| Architecture, technology choices, methodology, costs, risks | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Evaluation results and how to evaluate on your own meetings | [docs/EVALUATION.md](docs/EVALUATION.md), [evaluation/README.md](evaluation/README.md) |
| Deployment, configuration, backups, keys, retention | [docs/OPERATIONS.md](docs/OPERATIONS.md) |
| API reference | `/docs` on a running server (OpenAPI) |

## What it does

1. **Intake** — validates the file, keeps the original, measures quality (loudness, clipping, noise, speech ratio, silences), plans overlapping chunks for long recordings.
2. **Transcription** — faster-whisper large-v3 locally by default (or Deepgram, Azure, OpenAI); verbatim and readable copies kept separately; hallucinations over silence screened out; uncertain words flagged.
3. **Speakers** — anonymous speakers (المتحدث 1، 2…) with attribution confidence; names only from people.
4. **Analysis** — Claude classifies topics, proposals, objections, tentative agreements, approved decisions, rejected proposals, assigned and suggested actions, risks, open questions, deferrals and contradictions, each quoting the transcript.
5. **Verification** — rules independent of any model (quotes, numbers, dates, names, approval and assignment wording, negation) plus an independent audit; a decision without approving words is downgraded, never the reverse.
6. **Writing** and 7. **language review** — formal Arabic, checked after writing so no number, date, name or decision wording can be added.
8. **Documents** — RTL DOCX and PDF with Arabic fonts, checked after rendering.

A review interface (Arabic, RTL) lets people listen to every piece of evidence, correct the transcript
and speaker names, accept, correct or reject each item, edit the wording, regenerate, approve and export.

## Quick start (Docker)

```bash
cd meeting-minutes
cp .env.docker.example .env.docker
```

Set `POSTGRES_PASSWORD`, `MAHDAR_APP_DB_PASSWORD`, `MAHDAR_SECRET_KEY` and `MAHDAR_DATA_KEY` in `.env.docker` (the commands are in
the file). To let transcripts go to Claude, also set `ANTHROPIC_API_KEY` and
`MAHDAR_ALLOWED_EXTERNAL_PROVIDERS=anthropic`, then allow it in the organization's privacy settings.

```bash
docker compose --env-file .env.docker up --build -d
```

```bash
docker compose --env-file .env.docker exec api python3 -m mahdar.cli create-admin --org "اسم الجهة" --email admin@example.com
```

Open http://localhost:8080. The first transcription downloads the speech models (about 3 GB for
large-v3) into the `models` volume; `docker compose exec worker python3 -m mahdar.cli models download`
does it in advance.

## Development

```bash
cd meeting-minutes
python3 -m venv .venv && .venv/bin/pip install -e "./backend[dev]"
```

```bash
cd frontend && npm ci && npm run dev
```

| Command | Purpose |
| --- | --- |
| `.venv/bin/pytest backend/tests -m "not models"` | Unit and API tests (set `MAHDAR_TEST_DATABASE_URL` to a PostgreSQL superuser URL for the API tests) |
| `.venv/bin/pytest backend/tests -m models` | The real speech models on the evaluation recordings |
| `.venv/bin/ruff check backend` | Lint |
| `npm run lint && npm run typecheck && npm test && npm run build` (in `frontend/`) | Interface checks and build |
| `python -m mahdar.cli process-file REC.mp3 --meta meta.json --out runs/REC` | Whole pipeline on one file, without the API |
| `python -m mahdar.cli evaluate --results runs --dataset evaluation` | Score runs against the human-written references |
| `python -m mahdar.cli selfcheck --out /tmp/check` | Fonts, FFmpeg, DOCX/PDF rendering |

Layout: `backend/mahdar` (API, worker, pipeline agents, documents, evaluation), `frontend/` (React),
`evaluation/` (scenarios, recordings, references), `docs/`, `deploy/` (Caddy).

## Status

Working end to end with local speech models and a local OpenAI-compatible language model. The Claude
integration is implemented with the official SDK but was **not exercised live** in this build (no API
key was available): run it once with a key before relying on it — see ARCHITECTURE §12.
