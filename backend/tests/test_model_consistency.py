# backend/tests/test_model_consistency.py
def test_email_log_no_is_solved():
    """EmailLog must not have is_solved — use status field instead."""
    from app.models.models import EmailLog
    assert not hasattr(EmailLog, 'is_solved'), \
        "is_solved is redundant with status field — remove it"
