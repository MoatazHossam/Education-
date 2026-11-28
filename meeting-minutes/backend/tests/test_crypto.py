import io
import os

import pytest

from mahdar.security.crypto import CHUNK, DecryptionError, Keyring


def keys(n=1):
    return [os.urandom(32) for _ in range(n)]


def test_seal_open_and_associated_data_binding():
    kr = Keyring(keys())
    blob = kr.seal(b"transcript", "artifact:1")
    assert kr.open(blob, "artifact:1") == b"transcript"
    with pytest.raises(DecryptionError):
        kr.open(blob, "artifact:2")  # copied into another row
    tampered = blob[:-1] + bytes([blob[-1] ^ 1])
    with pytest.raises(DecryptionError):
        kr.open(tampered, "artifact:1")


def test_rotation_previous_key_still_decrypts():
    old, new = keys(2)
    blob = Keyring([old]).seal(b"x", "a")
    kr = Keyring([new, old])
    assert kr.open(blob, "a") == b"x"
    assert kr.needs_rotation(blob)
    assert not kr.needs_rotation(kr.seal(b"x", "a"))
    with pytest.raises(DecryptionError):
        Keyring([new]).open(blob, "a")


@pytest.mark.parametrize("size", [0, 10, CHUNK, CHUNK * 2 + 17])
def test_file_round_trip(size):
    kr = Keyring(keys())
    data = os.urandom(size)
    enc = io.BytesIO()
    assert kr.encrypt_file(io.BytesIO(data), enc, "blob:1") == size
    enc.seek(0)
    assert b"".join(kr.decrypt_stream(enc, "blob:1")) == data


def test_truncated_or_swapped_file_is_detected():
    kr = Keyring(keys())
    enc = io.BytesIO()
    kr.encrypt_file(io.BytesIO(os.urandom(CHUNK * 2 + 5)), enc, "blob:1")
    raw = enc.getvalue()
    # Drop the last chunk: the previous one was sealed as "more", so this is detected.
    first_len = int.from_bytes(raw[20:24], "big")
    cut = raw[: 20 + 4 + first_len + 4 + int.from_bytes(raw[24 + first_len : 28 + first_len], "big")]
    with pytest.raises(DecryptionError):
        b"".join(kr.decrypt_stream(io.BytesIO(cut), "blob:1"))
    with pytest.raises(DecryptionError):
        b"".join(kr.decrypt_stream(io.BytesIO(raw), "blob:2"))


def test_no_silent_fallback_to_a_previous_key():
    import base64

    from mahdar.config import Settings

    old = base64.b64encode(os.urandom(32)).decode()
    assert Settings(data_key="", data_keys_previous=old).data_keys() == []


def test_artifact_ciphertext_is_bound_to_its_context():
    from mahdar.db.repo import artifact_aad

    a = artifact_aad(
        "6f1c1d1e-0000-4000-8000-000000000001",
        "6f1c1d1e-0000-4000-8000-000000000002",
        "analysis",
        1,
        "6f1c1d1e-0000-4000-8000-000000000003",
    )
    b = artifact_aad(
        "6F1C1D1E-0000-4000-8000-000000000001",
        "6f1c1d1e-0000-4000-8000-000000000002",
        "analysis",
        1,
        "6f1c1d1e-0000-4000-8000-000000000003",
    )
    assert a == b  # same ids in another letter case
    kr = Keyring(keys())
    blob = kr.seal(b"x", a)
    with pytest.raises(DecryptionError):
        kr.open(blob, a.replace("analysis", "transcript"))
