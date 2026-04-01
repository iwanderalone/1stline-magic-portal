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
