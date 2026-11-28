"""Encryption at rest: AES-256-GCM, with key identifiers so keys can be rotated.

Two formats:

* ``seal``/``open_sealed`` for small values (database fields, JSON artifacts):
  ``MHD1 | key-id (8) | nonce (12) | ciphertext+tag``. The caller passes an *associated data*
  string naming where the value lives (``"artifact:<id>"``), so a ciphertext copied into another
  row or column does not decrypt.
* ``encrypt_file``/``decrypt_stream`` for recordings and documents: the file is cut into 1 MiB
  chunks, each sealed with ``nonce-prefix (8) | counter (4)`` and an associated-data byte that marks
  the last chunk, so a truncated or reordered file is detected and a file can be decrypted as a
  stream (audio playback) without holding it in memory.

The key id is the first 8 bytes of SHA-256 of the key. The current key (MAHDAR_DATA_KEY) encrypts;
it and the previous keys (MAHDAR_DATA_KEYS_PREVIOUS) decrypt.
"""

from __future__ import annotations

import hashlib
import os
import struct
from collections.abc import Iterator
from typing import BinaryIO

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

MAGIC_VALUE = b"MHD1"
MAGIC_FILE = b"MHF1"
CHUNK = 1024 * 1024


class DecryptionError(Exception):
    pass


def key_id(key: bytes) -> bytes:
    return hashlib.sha256(key).digest()[:8]


class Keyring:
    def __init__(self, keys: list[bytes]):
        if not keys:
            raise ValueError("no data key configured (MAHDAR_DATA_KEY)")
        self.current = keys[0]
        self._by_id = {key_id(k): k for k in keys}

    def _key(self, kid: bytes) -> bytes:
        try:
            return self._by_id[kid]
        except KeyError as exc:
            raise DecryptionError("encrypted with a key that is not configured") from exc

    # --- small values -----------------------------------------------------------------------
    def seal(self, plaintext: bytes, aad: str) -> bytes:
        nonce = os.urandom(12)
        ct = AESGCM(self.current).encrypt(nonce, plaintext, aad.encode())
        return MAGIC_VALUE + key_id(self.current) + nonce + ct

    def open(self, blob: bytes, aad: str) -> bytes:
        if not blob.startswith(MAGIC_VALUE) or len(blob) < 4 + 8 + 12 + 16:
            raise DecryptionError("not an encrypted value")
        kid, nonce, ct = blob[4:12], blob[12:24], blob[24:]
        try:
            return AESGCM(self._key(kid)).decrypt(nonce, ct, aad.encode())
        except InvalidTag as exc:
            raise DecryptionError("value was altered or belongs elsewhere") from exc

    def needs_rotation(self, blob: bytes) -> bool:
        return blob[4:12] != key_id(self.current)

    # --- files ------------------------------------------------------------------------------
    def encrypt_file(self, src: BinaryIO, dst: BinaryIO, aad: str) -> int:
        """Encrypts src into dst; returns the plaintext size."""
        prefix = os.urandom(8)
        aes = AESGCM(self.current)
        dst.write(MAGIC_FILE + key_id(self.current) + prefix)
        counter = 0
        total = 0
        chunk = src.read(CHUNK)
        while True:
            nxt = src.read(CHUNK)
            last = not nxt
            nonce = prefix + struct.pack(">I", counter)
            ct = aes.encrypt(nonce, chunk, _chunk_aad(aad, counter, last))
            dst.write(struct.pack(">I", len(ct)) + ct)
            total += len(chunk)
            counter += 1
            if last:
                return total
            chunk = nxt

    def decrypt_stream(self, src: BinaryIO, aad: str) -> Iterator[bytes]:
        header = src.read(4 + 8 + 8)
        if len(header) != 20 or not header.startswith(MAGIC_FILE):
            raise DecryptionError("not an encrypted file")
        aes = AESGCM(self._key(header[4:12]))
        prefix = header[12:20]
        counter = 0
        while True:
            raw_len = src.read(4)
            if len(raw_len) != 4:
                raise DecryptionError("encrypted file is truncated")
            (n,) = struct.unpack(">I", raw_len)
            ct = src.read(n)
            if len(ct) != n:
                raise DecryptionError("encrypted file is truncated")
            nonce = prefix + struct.pack(">I", counter)
            peek = src.read(1)
            last = not peek
            try:
                yield aes.decrypt(nonce, ct, _chunk_aad(aad, counter, last))
            except InvalidTag as exc:
                raise DecryptionError("encrypted file was altered") from exc
            if last:
                return
            src.seek(-1, os.SEEK_CUR)
            counter += 1


def _chunk_aad(aad: str, counter: int, last: bool) -> bytes:
    return f"{aad}|{counter}|{'last' if last else 'more'}".encode()
