"""The API and the review interface (one origin). API reference: /docs (OpenAPI at /openapi.json)."""

from __future__ import annotations

import logging
import os
import re
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy import text
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.staticfiles import StaticFiles

from mahdar.api import routes_admin, routes_auth, routes_meetings
from mahdar.config import check_production, get_settings
from mahdar.db.core import system_tx
from mahdar.logging_setup import setup_logging

log = logging.getLogger("mahdar.api")

CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; "
    "font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'"
)


_REQUEST_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
UPLOAD_PATHS = ("/api/meetings", "/api/org/logo")


class SecurityHeaders(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        s = get_settings()
        if request.method == "POST" and request.url.path in UPLOAD_PATHS:
            # Before the body is read: uploads need a declared size, a session cookie and the
            # CSRF header (the route checks the session itself; this keeps anonymous bodies off the disk).
            if not request.headers.get("content-length"):
                return JSONResponse({"detail": "يلزم تحديد حجم الملف المرفوع"}, status_code=411)
            if "mahdar_session" not in request.cookies or request.headers.get("x-requested-with") != "mahdar":
                return JSONResponse({"detail": "يلزم تسجيل الدخول"}, status_code=401)
        # Reject oversized uploads before reading them (the route enforces the exact limit too).
        length = request.headers.get("content-length")
        if length and length.isdigit() and int(length) > s.max_upload_mb * 1_000_000 + 1_000_000:
            return JSONResponse(
                {"detail": f"حجم الطلب يتجاوز الحد المسموح ({s.max_upload_mb} ميجابايت)"}, status_code=413
            )
        rid = request.headers.get("x-request-id") or ""
        if not _REQUEST_ID.match(rid):
            rid = uuid.uuid4().hex[:16]
        start = time.monotonic()
        response = await call_next(request)
        response.headers["X-Request-Id"] = rid
        response.headers["Content-Security-Policy"] = CSP
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        if s.public_url.startswith("https://"):
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        if request.url.path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "no-store")
            # Path and status only: ids in paths are opaque, query strings are not logged.
            log.info(
                "request",
                extra={
                    "method": request.method,
                    "path": request.url.path,
                    "status": response.status_code,
                    "ms": round((time.monotonic() - start) * 1000),
                    "request_id": rid,
                },
            )
        return response


def create_app() -> FastAPI:
    setup_logging()
    s = get_settings()
    problems = check_production(s)
    if s.env == "production":
        from mahdar.db.core import runtime_role_bypasses_rls

        if runtime_role_bypasses_rls():
            problems.append(
                "the database role bypasses row-level security (superuser or BYPASSRLS): set MAHDAR_APP_DATABASE_URL to the mahdar_app role"
            )
    if problems:
        raise RuntimeError("refusing to start: " + "; ".join(problems))
    # The API reference is public in development; in production only with MAHDAR_API_DOCS=true.
    docs = s.env != "production" or os.environ.get("MAHDAR_API_DOCS", "").lower() == "true"
    app = FastAPI(
        title="Mahdar — Arabic meeting minutes API",
        version="0.1.0",
        docs_url="/docs" if docs else None,
        redoc_url=None,
        openapi_url="/openapi.json" if docs else None,
    )
    app.add_middleware(SecurityHeaders)
    app.include_router(routes_auth.router)
    app.include_router(routes_meetings.router)
    app.include_router(routes_admin.router)

    # "service" lets the start script tell Mahdar from another program on the same port.
    @app.get("/healthz", include_in_schema=False)
    def healthz() -> dict:
        return {"ok": True, "service": "mahdar"}

    @app.get("/readyz", include_in_schema=False)
    def readyz() -> JSONResponse:
        try:
            with system_tx() as c:
                c.execute(text("select 1 from schema_migrations limit 1"))
        except Exception:
            return JSONResponse({"ok": False, "service": "mahdar"}, status_code=503)
        return JSONResponse({"ok": True, "service": "mahdar"})

    web = s.web_dir
    if web and (Path(web) / "index.html").exists():
        app.mount("/assets", StaticFiles(directory=Path(web) / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        def spa(path: str) -> FileResponse:
            candidate = (Path(web) / path).resolve()
            if path and candidate.is_file() and Path(web).resolve() in candidate.parents:
                return FileResponse(candidate)
            return FileResponse(Path(web) / "index.html", headers={"Cache-Control": "no-cache"})

    return app


app = create_app()
