"""The on-call rotation domain: use cases, their types, errors and ports.

Nothing under this package imports FastAPI, Pydantic, SQLAlchemy or an
adapter; `tests/test_domain_boundaries.py` holds that line. The pure rule
modules it builds on (`oncall.rules`, `oncall.workdays`, `oncall.fairness`)
follow the same constraint.
"""
