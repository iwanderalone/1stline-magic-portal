import tempfile
import os
import pytest
from app.dedup import DedupStore


@pytest.fixture
def store(tmp_path):
    return DedupStore(db_path=str(tmp_path / "dedup.db"))


def test_new_fingerprint_not_seen(store):
    assert store.is_seen("abc123") is False


def test_mark_seen_makes_it_seen(store):
    store.mark_seen("abc123")
    assert store.is_seen("abc123") is True


def test_mark_seen_idempotent(store):
    store.mark_seen("abc123")
    store.mark_seen("abc123")  # should not raise
    assert store.is_seen("abc123") is True


def test_different_fingerprints_independent(store):
    store.mark_seen("aaa")
    assert store.is_seen("bbb") is False


def test_make_fingerprint_deterministic(store):
    fp1 = store.make_fingerprint("<msg@id>", "box@example.com")
    fp2 = store.make_fingerprint("<msg@id>", "box@example.com")
    assert fp1 == fp2
    assert len(fp1) == 24


def test_make_fingerprint_differs_by_mailbox(store):
    fp1 = store.make_fingerprint("<msg@id>", "a@example.com")
    fp2 = store.make_fingerprint("<msg@id>", "b@example.com")
    assert fp1 != fp2
