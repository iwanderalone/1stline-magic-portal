# backend/tests/test_schema_consistency.py
import inspect
from app.schemas import schemas

def test_no_bare_config_classes():
    """All ORM-mapped response schemas must inherit BaseOrmModel, not repeat Config."""
    violations = []
    for name, obj in inspect.getmembers(schemas, inspect.isclass):
        if not hasattr(obj, '__mro__'):
            continue
        # Check for inner Config class with from_attributes
        inner = getattr(obj, 'Config', None)
        if inner and getattr(inner, 'from_attributes', False):
            violations.append(name)
    assert violations == [], f"These schemas repeat Config manually: {violations}"


def test_get_or_404_used_consistently():
    """API modules must not implement manual 404 patterns for primary key lookups.

    Files with legitimate compound-filter patterns (ownership checks) are excluded:
    - reminders.py: filters on Reminder.id AND Reminder.user_id
    - notifications.py: filters on Notification.id AND Notification.user_id
    """
    import pathlib, re
    api_dir = pathlib.Path("app/api")
    # Pattern: scalar_one_or_none() on one line, then within 3 lines:
    #   if not <var>: raise HTTPException(status_code=404 ...)
    # Uses line-by-line matching to avoid cross-function false positives.
    pattern = re.compile(
        r'scalar_one_or_none\(\)\n(\s+.*\n){0,2}\s+if not \w+[^:]*:\n\s+raise HTTPException\(status_code=404'
    )
    # These files intentionally use compound filters (PK + ownership) and are excluded
    excluded = {"reminders.py", "notifications.py"}
    violations = []
    for f in api_dir.glob("*.py"):
        if f.name in excluded:
            continue
        src = f.read_text()
        if pattern.search(src):
            violations.append(f.name)
    assert violations == [], f"These files still use manual 404 patterns: {violations}"
