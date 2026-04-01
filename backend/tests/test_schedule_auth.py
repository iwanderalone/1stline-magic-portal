# backend/tests/test_schedule_auth.py
import ast, pathlib

def test_role_check_uses_enum():
    """Ensure schedule.py uses enum-based role checks, not string literals."""
    src = pathlib.Path("app/api/schedule.py").read_text()
    assert '!= "admin"' not in src, "Use UserRole.ADMIN enum, not string 'admin'"
    assert '== "admin"' not in src, "Use UserRole.ADMIN enum, not string 'admin'"
