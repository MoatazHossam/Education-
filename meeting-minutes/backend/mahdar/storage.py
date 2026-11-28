"""Encrypted file storage: a local directory or any S3-compatible store.

Files are encrypted before they are written (security.crypto), with the blob's id as associated
data, so the store never holds a readable recording or document and a file cannot be swapped for
another blob's.
"""

from __future__ import annotations

import hashlib
import io
import shutil
import tempfile
import uuid
from collections.abc import Iterator
from functools import lru_cache
from pathlib import Path
from typing import BinaryIO, Protocol

from mahdar.config import get_settings
from mahdar.security.crypto import Keyring


class Backend(Protocol):
    def put(self, key: str, src: BinaryIO) -> None: ...
    def open(self, key: str) -> BinaryIO: ...
    def delete(self, key: str) -> None: ...


class LocalBackend:
    def __init__(self, root: Path):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        p = (self.root / key).resolve()
        if self.root.resolve() not in p.parents:
            raise ValueError("storage key escapes the storage directory")
        return p

    def put(self, key: str, src: BinaryIO) -> None:
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".part")
        with open(tmp, "wb") as f:
            shutil.copyfileobj(src, f)
        tmp.replace(p)

    def open(self, key: str) -> BinaryIO:
        return open(self._path(key), "rb")

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)


class S3Backend:
    def __init__(self, bucket: str, endpoint: str | None, region: str | None):
        import boto3

        self.bucket = bucket
        self.client = boto3.client("s3", endpoint_url=endpoint or None, region_name=region or None)

    def put(self, key: str, src: BinaryIO) -> None:
        self.client.upload_fileobj(src, self.bucket, key)

    def open(self, key: str) -> BinaryIO:
        # Downloaded to a temporary file: decryption needs to seek.
        tmp = tempfile.TemporaryFile()
        self.client.download_fileobj(self.bucket, key, tmp)
        tmp.seek(0)
        return tmp  # type: ignore[return-value]

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=key)


@lru_cache
def keyring() -> Keyring:
    return Keyring(get_settings().data_keys())


@lru_cache
def backend() -> Backend:
    s = get_settings()
    if s.storage_backend == "s3":
        if not s.s3_bucket:
            raise RuntimeError("MAHDAR_S3_BUCKET is required with MAHDAR_STORAGE_BACKEND=s3")
        return S3Backend(s.s3_bucket, s.s3_endpoint, s.s3_region)
    return LocalBackend(s.storage_dir)


def reset() -> None:
    keyring.cache_clear()
    backend.cache_clear()


def storage_key(org_id: str, blob_id: str) -> str:
    return f"{org_id}/{blob_id[:2]}/{blob_id}.enc"


def put_file(org_id: str, blob_id: str, path: Path) -> tuple[str, int, str]:
    """Encrypts and stores a local file; returns (storage key, size, sha256 of the plaintext)."""
    sha = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            sha.update(chunk)
    key = storage_key(org_id, blob_id)
    with open(path, "rb") as src, tempfile.TemporaryFile() as enc:
        size = keyring().encrypt_file(src, enc, aad=f"blob:{blob_id}")
        enc.seek(0)
        backend().put(key, enc)
    return key, size, sha.hexdigest()


def put_bytes(org_id: str, blob_id: str, data: bytes) -> tuple[str, int, str]:
    with tempfile.NamedTemporaryFile(delete=False) as tmp:
        tmp.write(data)
        name = tmp.name
    try:
        return put_file(org_id, blob_id, Path(name))
    finally:
        Path(name).unlink(missing_ok=True)


def read_stream(storage_key_: str, blob_id: str) -> Iterator[bytes]:
    src = backend().open(storage_key_)
    try:
        yield from keyring().decrypt_stream(src, aad=f"blob:{blob_id}")
    finally:
        src.close()


def read_to_file(storage_key_: str, blob_id: str, dst: Path) -> Path:
    with open(dst, "wb") as f:
        for chunk in read_stream(storage_key_, blob_id):
            f.write(chunk)
    return dst


def read_bytes(storage_key_: str, blob_id: str) -> bytes:
    buf = io.BytesIO()
    for chunk in read_stream(storage_key_, blob_id):
        buf.write(chunk)
    return buf.getvalue()


def delete(storage_key_: str) -> None:
    backend().delete(storage_key_)


def new_id() -> str:
    return str(uuid.uuid4())
