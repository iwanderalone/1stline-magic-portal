import os

os.environ.setdefault("SECRET_KEY", "a" * 32)
os.environ.setdefault("JWT_SECRET", "b" * 64)


def test_inline_spans_do_not_break_a_sentence():
    """Marketing HTML wraps sentences in inline spans and hard-wraps its own
    source around 78 chars. Breaking on either shredded one sentence into six
    lines in the reader."""
    from app.services.mail_reporter_service import clean_email_body

    html = (
        "<html><body><table><tr><td>"
        "<p><span>Read</span> <span>and reply</span> <span>right in</span>\n"
        "<span>the browser,</span> <span>no signup</span> <span>needed.</span></p>"
        "</td></tr></table></body></html>"
    )
    out = clean_email_body(html, "text/html").strip()
    assert out == "Read and reply right in the browser, no signup needed."


def test_block_tags_and_br_still_break_lines():
    from app.services.mail_reporter_service import clean_email_body

    html = "<div><p>First line</p><p>Second line<br>Third line</p></div>"
    lines = [l for l in clean_email_body(html, "text/html").splitlines() if l.strip()]
    assert lines == ["First line", "Second line", "Third line"]


def test_link_text_is_kept_without_a_stray_space_before_punctuation():
    from app.services.mail_reporter_service import clean_email_body

    html = '<p>Grab the <a href="https://example.com/app">mobile app</a>.</p>'
    assert clean_email_body(html, "text/html").strip() == "Grab the mobile app."
