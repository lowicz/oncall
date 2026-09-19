"""The domain must not depend on frameworks or adapters.

Checked in a fresh interpreter: this test process has already imported FastAPI
and SQLAlchemy through `conftest.py`, so its own `sys.modules` proves nothing.
"""

import json
import subprocess
import sys

DOMAIN_MODULES = (
    "oncall.domain.swaps.use_cases",
    "oncall.domain.availability.use_cases",
    "oncall.domain.overrides.use_cases",
    "oncall.domain.admin.use_cases",
    "oncall.domain.sharing.use_cases",
    "oncall.domain.access.use_cases",
    "oncall.domain.reports.use_cases",
    "oncall.domain.history.use_cases",
    "oncall.domain.balance.use_cases",
    "oncall.domain.calendar.use_cases",
    "oncall.domain.scheduling.drafts",
    "oncall.domain.scheduling.generation",
    "oncall.domain.scheduling.policy",
    "oncall.domain.scheduling.publication",
    "oncall.domain.handover",
    "oncall.domain.hard_rules",
)
FORBIDDEN_PREFIXES = (
    "fastapi",
    "starlette",
    "pydantic",
    "pydantic_settings",
    "sqlalchemy",
    "asyncpg",
    "aiosqlite",
    "oncall.infrastructure",
    "oncall.routes",
    "oncall.models",
    "oncall.database",
    "oncall.config",
)

PROBE = f"""
import importlib, json, sys
for name in {DOMAIN_MODULES!r}:
    importlib.import_module(name)
print(json.dumps(sorted(sys.modules)))
"""


def test_domain_imports_no_framework_and_no_adapter() -> None:
    result = subprocess.run(
        [sys.executable, "-c", PROBE], capture_output=True, text=True, check=True
    )
    loaded = json.loads(result.stdout)
    leaked = [
        name
        for name in loaded
        if any(name == prefix or name.startswith(f"{prefix}.") for prefix in FORBIDDEN_PREFIXES)
    ]
    assert leaked == []


def test_domain_is_imported_by_the_adapters_not_the_other_way_round() -> None:
    probe = (
        "import json, sys, oncall.infrastructure.sqlalchemy.swaps; "
        "print(json.dumps('oncall.domain.swaps.ports' in sys.modules))"
    )
    result = subprocess.run(
        [sys.executable, "-c", probe], capture_output=True, text=True, check=True
    )
    assert json.loads(result.stdout) is True
