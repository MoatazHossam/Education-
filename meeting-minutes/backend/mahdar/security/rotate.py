"""Re-encrypts everything sealed with a previous data key under the current MAHDAR_DATA_KEY.

Procedure (docs/OPERATIONS.md): set the new key as MAHDAR_DATA_KEY and the old one in
MAHDAR_DATA_KEYS_PREVIOUS, restart, run ``python -m mahdar.cli rotate-data-key``, then remove the
old key. Each value is decrypted and re-sealed with the same associated data.
"""

from __future__ import annotations

import tempfile

from sqlalchemy import text

from mahdar import storage
from mahdar.db.core import owner_engine
from mahdar.security.crypto import MAGIC_FILE, key_id

COLUMNS = [
    ("meetings", "meta_enc", lambda r: f"meeting:{r['id']}:meta"),
    ("artifacts", "content_enc", lambda r: f"artifact:{r['id']}"),
    ("glossary_terms", "data_enc", lambda r: f"glossary:{r['id']}"),
    ("audit_log", "details_enc", lambda r: f"audit:{r['org_id']}"),
    ("blobs", "filename_enc", lambda r: f"blob:{r['id']}:filename"),
]


def rotate_all() -> dict:
    kr = storage.keyring()
    counts: dict[str, int] = {}
    # The owner connection is used on purpose: rotation spans every organization.
    with owner_engine().begin() as c:
        for table, col, aad in COLUMNS:
            n = 0
            rows = c.execute(
                text(f"select id, org_id, {col} from {table} where {col} is not null and length({col}) > 0")  # noqa: S608
            ).mappings()
            for r in list(rows):
                blob = bytes(r[col])
                if not kr.needs_rotation(blob):
                    continue
                c.execute(
                    text(f"update {table} set {col} = :v where id = :id"),  # noqa: S608
                    {"v": kr.seal(kr.open(blob, aad(r)), aad(r)), "id": r["id"]},
                )
                n += 1
            counts[table] = n
        files = 0
        for r in list(c.execute(text("select id, storage_key from blobs where purged_at is null")).mappings()):
            src = storage.backend().open(r["storage_key"])
            try:
                header = src.read(12)
                if header[:4] != MAGIC_FILE or header[4:12] == key_id(kr.current):
                    continue
                src.seek(0)
                with tempfile.TemporaryFile() as plain, tempfile.TemporaryFile() as enc:
                    for chunk in kr.decrypt_stream(src, aad=f"blob:{r['id']}"):
                        plain.write(chunk)
                    plain.seek(0)
                    kr.encrypt_file(plain, enc, aad=f"blob:{r['id']}")
                    enc.seek(0)
                    storage.backend().put(r["storage_key"], enc)
                files += 1
            finally:
                src.close()
        counts["files"] = files
    return counts
