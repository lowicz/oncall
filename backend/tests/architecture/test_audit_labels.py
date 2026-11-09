"""Every audit action the application records has a name on the Audit screen.

The screen shows `labels.auditActions` from the frontend catalogs and offers
those actions in its filter, so an action missing there reads as its raw code
and cannot be filtered for. The actions are the string constants passed as
`action=` anywhere under `src/oncall`.
"""

import ast
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SOURCE_ROOT = ROOT / "backend" / "src" / "oncall"
CATALOGS = [ROOT / "frontend" / "src" / "i18n" / lang / "labels.ts" for lang in ("pl", "en")]


def _recorded_actions() -> set[str]:
    actions: set[str] = set()
    for path in SOURCE_ROOT.rglob("*.py"):
        for node in ast.walk(ast.parse(path.read_text())):
            if not isinstance(node, ast.Call):
                continue
            for keyword in node.keywords:
                if keyword.arg != "action":
                    continue
                actions.update(
                    constant.value
                    for constant in ast.walk(keyword.value)
                    if isinstance(constant, ast.Constant)
                    and isinstance(constant.value, str)
                    and re.fullmatch(r"[a-z_]+\.[a-z_]+", constant.value)
                )
    return actions


def test_every_recorded_action_is_named_in_both_catalogs() -> None:
    actions = _recorded_actions()
    assert "forwarding.handover_started" in actions
    for catalog in CATALOGS:
        named = set(re.findall(r"'([a-z_]+\.[a-z_]+)':", catalog.read_text()))
        assert sorted(actions - named) == [], catalog
