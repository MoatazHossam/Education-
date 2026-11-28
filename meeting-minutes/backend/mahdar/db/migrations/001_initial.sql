-- Mahdar initial schema.
--
-- Sensitive content (meeting titles and details, transcripts, analyses, minutes, audit details,
-- glossary entries) is stored encrypted by the application (AES-256-GCM, *_enc columns); only
-- identifiers, statuses and timestamps are plain. Recordings and documents are encrypted files in
-- storage (blobs).
--
-- Organization isolation: every content table carries org_id, and row-level security restricts
-- each transaction to the organization set in mahdar.org_id (set by the application per request
-- and per job). FORCE applies it to the table owner too; only a superuser or a BYPASSRLS role
-- escapes it, which is why the API and the worker connect as mahdar_app (002_app_role).

CREATE TABLE organizations (
    id          uuid PRIMARY KEY,
    name        text NOT NULL,
    -- Privacy (external providers per kind of data), retention, quality gates, document branding.
    settings    jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id              uuid PRIMARY KEY,
    org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email           text NOT NULL,
    name            text NOT NULL,
    password_hash   text NOT NULL,
    -- admin: users and settings; editor: upload, review, correct; approver: editor + approve minutes;
    -- viewer: read only.
    role            text NOT NULL CHECK (role IN ('admin', 'approver', 'editor', 'viewer')),
    active          boolean NOT NULL DEFAULT true,
    failed_logins   integer NOT NULL DEFAULT 0,
    locked_until    timestamptz,
    last_login_at   timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));
CREATE INDEX users_org_idx ON users (org_id);

CREATE TABLE sessions (
    id          uuid PRIMARY KEY,
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL,
    revoked_at  timestamptz
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE meetings (
    id                  uuid PRIMARY KEY,
    org_id              uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_by          uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    -- Title, date, place, attendees, preparer... (encrypted JSON).
    meta_enc            bytea NOT NULL,
    -- عام / داخلي / سري / سري للغاية: public, internal, confidential, secret.
    classification      text NOT NULL DEFAULT 'internal'
                        CHECK (classification IN ('public', 'internal', 'confidential', 'secret')),
    -- uploaded -> processing -> review (or failed / awaiting_authorization).
    status              text NOT NULL DEFAULT 'uploaded'
                        CHECK (status IN ('uploaded', 'processing', 'review', 'failed', 'awaiting_authorization')),
    stage               text,
    progress            real NOT NULL DEFAULT 0,
    -- draft_requires_review (unresolved critical issues), draft, reviewed (by a human), approved (by an approver).
    minutes_status      text NOT NULL DEFAULT 'draft_requires_review'
                        CHECK (minutes_status IN ('draft_requires_review', 'draft', 'reviewed', 'approved')),
    approved_by         uuid REFERENCES users(id) ON DELETE SET NULL,
    approved_at         timestamptz,
    error_code          text,
    duration_seconds    real,
    critical_open       integer NOT NULL DEFAULT 0,
    retention_until     timestamptz
);
CREATE INDEX meetings_org_created_idx ON meetings (org_id, created_at DESC);

-- Recordings (original and normalised), documents and logos: encrypted files in storage.
CREATE TABLE blobs (
    id              uuid PRIMARY KEY,
    org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    meeting_id      uuid REFERENCES meetings(id) ON DELETE CASCADE,
    kind            text NOT NULL,
    storage_key     text NOT NULL,
    size_bytes      bigint NOT NULL,
    sha256          text NOT NULL,
    content_type    text NOT NULL,
    filename_enc    bytea,
    created_at      timestamptz NOT NULL DEFAULT now(),
    purged_at       timestamptz
);
CREATE INDEX blobs_meeting_idx ON blobs (meeting_id, kind);

-- Versioned, encrypted JSON produced by the agents and by reviewers: audio_quality, transcript,
-- analysis, verification, minutes, evidence_report, review. A correction is a new version; nothing
-- is overwritten, so every version stays auditable.
CREATE TABLE artifacts (
    id                  uuid PRIMARY KEY,
    org_id              uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    meeting_id          uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    kind                text NOT NULL,
    version             integer NOT NULL,
    content_enc         bytea NOT NULL,
    sha256              text NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    created_by_user     uuid REFERENCES users(id) ON DELETE SET NULL,
    created_by_agent    text,
    note                text,
    purged_at           timestamptz,
    UNIQUE (meeting_id, kind, version)
);

CREATE TABLE glossary_terms (
    id          uuid PRIMARY KEY,
    org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    -- {term, variants[], category, note} (encrypted: names of people and projects).
    data_enc    bytea NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX glossary_org_idx ON glossary_terms (org_id);

-- Which provider processed which kind of data, for which meeting (privacy register).
CREATE TABLE processing_records (
    id          bigserial PRIMARY KEY,
    org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    meeting_id  uuid REFERENCES meetings(id) ON DELETE SET NULL,
    at          timestamptz NOT NULL DEFAULT now(),
    stage       text NOT NULL,
    provider    text NOT NULL,
    model       text,
    data_kind   text NOT NULL,
    external    boolean NOT NULL,
    detail      jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX processing_org_idx ON processing_records (org_id, at DESC);

-- Audit trail: who did what, when. details_enc holds before/after values (encrypted).
CREATE TABLE audit_log (
    id              bigserial PRIMARY KEY,
    org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    at              timestamptz NOT NULL DEFAULT now(),
    actor_user      uuid REFERENCES users(id) ON DELETE SET NULL,
    actor_kind      text NOT NULL CHECK (actor_kind IN ('user', 'agent', 'system')),
    action          text NOT NULL,
    target_type     text,
    target_id       text,
    meeting_id      uuid,
    details_enc     bytea
);
CREATE INDEX audit_org_idx ON audit_log (org_id, at DESC);
CREATE INDEX audit_meeting_idx ON audit_log (meeting_id, at DESC);

-- Background jobs. No content: identifiers and status only, so the queue can be read across
-- organizations by the worker (no row-level security on this table).
CREATE TABLE jobs (
    id              uuid PRIMARY KEY,
    org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    meeting_id      uuid REFERENCES meetings(id) ON DELETE CASCADE,
    kind            text NOT NULL,
    status          text NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
    payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
    attempts        integer NOT NULL DEFAULT 0,
    max_attempts    integer NOT NULL DEFAULT 3,
    run_after       timestamptz NOT NULL DEFAULT now(),
    locked_by       text,
    locked_at       timestamptz,
    heartbeat_at    timestamptz,
    stage           text,
    progress        real NOT NULL DEFAULT 0,
    -- Per-stage timings and outcomes: [{stage, status, started_at, finished_at, message_ar}].
    stages          jsonb NOT NULL DEFAULT '[]'::jsonb,
    error           text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    finished_at     timestamptz
);
CREATE INDEX jobs_claim_idx ON jobs (status, run_after) WHERE status = 'queued';
CREATE INDEX jobs_meeting_idx ON jobs (meeting_id, created_at DESC);

CREATE TABLE worker_heartbeats (
    worker_id   text PRIMARY KEY,
    seen_at     timestamptz NOT NULL DEFAULT now()
);

-- Row-level security on the content tables.
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['meetings', 'blobs', 'artifacts', 'glossary_terms', 'processing_records', 'audit_log']
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format(
            'CREATE POLICY org_isolation ON %I USING (org_id = nullif(current_setting(''mahdar.org_id'', true), '''')::uuid) '
            'WITH CHECK (org_id = nullif(current_setting(''mahdar.org_id'', true), '''')::uuid)', t);
    END LOOP;
END $$;
