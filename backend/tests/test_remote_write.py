import os
import struct
import types

import pytest

os.environ.setdefault("SECRET_KEY", "a" * 32)
os.environ.setdefault("JWT_SECRET", "b" * 64)

import cramjam  # noqa: E402

from app.services.remote_write import ProtobufError, decode_write_request  # noqa: E402

TS = 1756814400000  # 2026-09-02T12:00:00Z in ms


# ─── minimal protobuf encoder, mirroring what Prometheus sends ───────

def _varint(n: int) -> bytes:
    out = b""
    while True:
        byte = n & 0x7F
        n >>= 7
        out += bytes([byte | (0x80 if n else 0)])
        if not n:
            return out


def _ld(field: int, payload: bytes) -> bytes:
    return _varint(field << 3 | 2) + _varint(len(payload)) + payload


def _label(name: str, value: str) -> bytes:
    return _ld(1, _ld(1, name.encode()) + _ld(2, value.encode()))


def _sample(value: float, ts: int) -> bytes:
    return _ld(2, _varint(1 << 3 | 1) + struct.pack("<d", value) + _varint(2 << 3) + _varint(ts))


def _series(name: str, instance: str, value: float, ts: int = TS, **labels) -> bytes:
    body = _label("__name__", name) + _label("instance", instance) + _label("job", "viory")
    for k, v in labels.items():
        body += _label(k, v)
    return _ld(1, body + _sample(value, ts))


def _push(*series: bytes) -> bytes:
    return bytes(cramjam.snappy.compress_raw(b"".join(series)))


# ─── decoder ─────────────────────────────────────────────────────────

def test_decodes_labels_and_samples():
    out = decode_write_request(_push(_series("probe_success", "https://a.example", 1.0)))
    assert len(out) == 1
    assert out[0].name == "probe_success"
    assert out[0].labels["instance"] == "https://a.example"
    assert out[0].latest == (1.0, TS)


def test_keeps_newest_sample_of_a_series():
    body = _ld(1, _label("__name__", "probe_duration_seconds")
               + _label("instance", "https://a.example")
               + _sample(0.10, TS) + _sample(0.42, TS + 30000))
    out = decode_write_request(_push(body))
    assert out[0].latest == (0.42, TS + 30000)


def test_skips_unknown_fields():
    """A newer Prometheus adding fields must not break ingestion."""
    body = (_label("__name__", "probe_success") + _label("instance", "https://a.example")
            + _sample(1.0, TS) + _varint(9 << 3 | 2) + _varint(3) + b"new")
    out = decode_write_request(_push(_ld(1, body)))
    assert out[0].latest == (1.0, TS)


def test_empty_body_is_not_an_error():
    assert decode_write_request(b"") == []


def test_garbage_is_rejected():
    with pytest.raises(ProtobufError):
        decode_write_request(b"definitely not snappy")


# ─── metric → row folding ────────────────────────────────────────────

def _blank_row():
    return types.SimpleNamespace(
        up=None, http_status=None, ssl_ok=None, ssl_expiry_at=None, probe_duration=None,
        dns_lookup=None, ip_protocol=None, tls_version=None, sample_at=None,
    )


def test_full_target_push_folds_into_one_row():
    from app.api.status import _WANTED, _apply

    push = _push(
        _series("probe_success", "https://a.example", 1.0),
        _series("probe_http_status_code", "https://a.example", 200),
        _series("probe_http_ssl", "https://a.example", 1),
        _series("probe_ssl_earliest_cert_expiry", "https://a.example", 1761998400),
        _series("probe_duration_seconds", "https://a.example", 0.064),
        _series("probe_dns_lookup_time_seconds", "https://a.example", 0.004),
        _series("probe_ip_protocol", "https://a.example", 4),
        _series("probe_tls_version_info", "https://a.example", 1, version="TLS 1.3"),
        _series("probe_http_version", "https://a.example", 1.1),   # not wanted
    )
    series = decode_write_request(push)
    kept = [s for s in series if s.name in _WANTED]
    assert len(series) == 9 and len(kept) == 8   # probe_http_version filtered out

    row = _blank_row()
    for s in kept:
        _apply(row, s)

    assert row.up is True
    assert row.http_status == 200
    assert row.ssl_ok is True
    assert row.tls_version == "TLS 1.3"
    assert row.ip_protocol == "4"
    assert row.probe_duration == pytest.approx(0.064)
    assert row.dns_lookup == pytest.approx(0.004)
    assert row.ssl_expiry_at.year == 2025 and row.ssl_expiry_at.month == 11
    assert row.sample_at is not None


def test_failed_probe_sets_down():
    from app.api.status import _apply

    row = _blank_row()
    for s in decode_write_request(_push(_series("probe_success", "https://a.example", 0.0))):
        _apply(row, s)
    assert row.up is False


def test_missing_cert_expiry_stays_null():
    """Plain-HTTP targets report 0 here; that must not become a 1970 date."""
    from app.api.status import _apply

    row = _blank_row()
    for s in decode_write_request(_push(_series("probe_ssl_earliest_cert_expiry", "http://a.example", 0))):
        _apply(row, s)
    assert row.ssl_expiry_at is None
