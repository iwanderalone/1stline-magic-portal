# backend/tests/test_model_consistency.py
def test_email_log_no_is_solved():
    """EmailLog must not have is_solved — use status field instead."""
    from app.models.models import EmailLog
    assert not hasattr(EmailLog, 'is_solved'), \
        "is_solved is redundant with status field — remove it"


def test_alembic_revisions_are_unique_with_one_head():
    """A duplicated revision id makes alembic see a cycle and the API won't boot.

    Hand-picked hex ids collide easily (a1b2c3d4e5f6 was used twice), and the
    failure only shows up at container start, so assert it here instead.
    """
    import glob
    import os
    import re

    versions = os.path.join(os.path.dirname(__file__), "..", "alembic", "versions")
    revisions, down_revisions = {}, {}
    for path in glob.glob(os.path.join(versions, "*.py")):
        source = open(path).read()
        rev = re.search(r"^revision = ['\"]([^'\"]+)", source, re.M)
        down = re.search(r"^down_revision = ['\"]?([^'\"\n]+)", source, re.M)
        if not rev:
            continue
        revisions.setdefault(rev.group(1), []).append(os.path.basename(path))
        down_revisions[rev.group(1)] = down.group(1) if down else None

    duplicates = {rev: files for rev, files in revisions.items() if len(files) > 1}
    assert not duplicates, f"duplicate alembic revision ids: {duplicates}"

    children = set(down_revisions.values())
    heads = [rev for rev in revisions if rev not in children]
    assert len(heads) == 1, f"expected a single alembic head, found {heads}"
