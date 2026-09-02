"""Decoder for Prometheus `remote_write` v1 payloads.

Prometheus POSTs a snappy-block-compressed protobuf `prometheus.WriteRequest`.
Rather than pull in protobuf + generated stubs for three tiny messages, we walk
the wire format directly — the schema is fixed and trivial:

    WriteRequest { repeated TimeSeries timeseries = 1 }
    TimeSeries   { repeated Label labels = 1; repeated Sample samples = 2 }
    Label        { string name = 1; string value = 2 }
    Sample       { double value = 1; int64 timestamp = 2 }   # timestamp in ms

Unknown fields (metadata, exemplars, and anything a newer Prometheus adds) are
skipped, so a version bump on the sender side can't break ingestion.
"""
from __future__ import annotations

import struct
from typing import Iterator, NamedTuple

import cramjam

MAX_DECOMPRESSED_BYTES = 32 * 1024 * 1024  # sanity bound on a single push


class Series(NamedTuple):
    labels: dict[str, str]
    # (value, timestamp_ms) newest-last, as Prometheus orders them
    samples: list[tuple[float, int]]

    @property
    def name(self) -> str:
        return self.labels.get("__name__", "")

    @property
    def latest(self) -> tuple[float, int] | None:
        return self.samples[-1] if self.samples else None


class ProtobufError(ValueError):
    """Malformed payload — the sender should not retry it."""


# ─── wire-format primitives ──────────────────────────────────────────

def _varint(buf: bytes, i: int) -> tuple[int, int]:
    result = shift = 0
    while True:
        if i >= len(buf):
            raise ProtobufError("truncated varint")
        byte = buf[i]
        i += 1
        result |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return result, i
        shift += 7
        if shift > 63:
            raise ProtobufError("varint overflow")


def _fields(buf: bytes, start: int = 0, end: int | None = None) -> Iterator[tuple[int, int, object]]:
    """Yield (field_number, wire_type, payload) for one message body.

    payload is an int for varint/fixed types and a bytes slice for length-delimited.
    """
    i, end = start, len(buf) if end is None else end
    while i < end:
        key, i = _varint(buf, i)
        field_no, wire_type = key >> 3, key & 0x07
        if wire_type == 0:                      # varint
            value, i = _varint(buf, i)
        elif wire_type == 1:                    # fixed64
            value, i = buf[i:i + 8], i + 8
            if len(value) != 8:
                raise ProtobufError("truncated fixed64")
        elif wire_type == 2:                    # length-delimited
            length, i = _varint(buf, i)
            if i + length > end:
                raise ProtobufError("truncated length-delimited field")
            value, i = buf[i:i + length], i + length
        elif wire_type == 5:                    # fixed32
            value, i = buf[i:i + 4], i + 4
            if len(value) != 4:
                raise ProtobufError("truncated fixed32")
        else:
            raise ProtobufError(f"unsupported wire type {wire_type}")
        yield field_no, wire_type, value


def _string(raw: bytes) -> str:
    return raw.decode("utf-8", errors="replace")


# ─── message decoders ────────────────────────────────────────────────

def _label(buf: bytes) -> tuple[str, str]:
    name = value = ""
    for field_no, wire_type, payload in _fields(buf):
        if wire_type != 2:
            continue
        if field_no == 1:
            name = _string(payload)
        elif field_no == 2:
            value = _string(payload)
    return name, value


def _sample(buf: bytes) -> tuple[float, int]:
    value, timestamp = 0.0, 0
    for field_no, wire_type, payload in _fields(buf):
        if field_no == 1 and wire_type == 1:
            value = struct.unpack("<d", payload)[0]
        elif field_no == 2 and wire_type == 0:
            timestamp = payload
    return value, timestamp


def _timeseries(buf: bytes) -> Series:
    labels: dict[str, str] = {}
    samples: list[tuple[float, int]] = []
    for field_no, wire_type, payload in _fields(buf):
        if wire_type != 2:
            continue
        if field_no == 1:
            name, value = _label(payload)
            if name:
                labels[name] = value
        elif field_no == 2:
            samples.append(_sample(payload))
    return Series(labels=labels, samples=samples)


def decode_write_request(body: bytes) -> list[Series]:
    """Snappy-decompress and parse a remote_write v1 body into time series."""
    if not body:
        return []
    try:
        raw = bytes(cramjam.snappy.decompress_raw(body))
    except Exception as exc:  # cramjam raises its own error types
        raise ProtobufError(f"snappy decompression failed: {exc}") from exc
    if len(raw) > MAX_DECOMPRESSED_BYTES:
        raise ProtobufError("payload too large")

    series: list[Series] = []
    for field_no, wire_type, payload in _fields(raw):
        if field_no == 1 and wire_type == 2:
            series.append(_timeseries(payload))
    return series
