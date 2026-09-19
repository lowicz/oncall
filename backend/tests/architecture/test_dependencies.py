"""The dependency rule, read off the source rather than off a process.

`tests/test_domain_boundaries.py` imports the domain in a fresh interpreter and
looks at what came with it, which is the stronger check of the two - but it can
only see what a module drags in. This one reads every import statement under
`domain/` and answers the other question: what does this code reach for on
purpose.

Stated as an allowlist, because the denylist it replaced had gone quietly
stale. It named `oncall.adapters`, a package of forwarding modules deleted in
phase 6a, and named neither `oncall.infrastructure`, which holds the adapters
now, nor any application module. Measured before it was rewritten: a domain
module importing `oncall.metrics` passed both guards, and one importing
`oncall.infrastructure` failed only the other test, and only because that
package happens to import SQLAlchemy. A denylist has to be edited every time
the tree grows; this one was not, and that is how it rotted.
"""

import ast
import sys
from pathlib import Path

DOMAIN_ROOT = Path(__file__).resolve().parents[2] / "src" / "oncall" / "domain"

#: Pure policy that the domain owns in substance but that still sits at the
#: package root: the fairness metric, the hard rules, the working calendar and
#: coverage arithmetic. Finding A12 moves them inward; until then they are
#: named here one by one rather than covered by a prefix, so a fifth one cannot
#: arrive unnoticed.
ROOT_POLICY = ("oncall.coverage", "oncall.fairness", "oncall.rules", "oncall.workdays")


def _imports(path: Path) -> list[tuple[int, str]]:
    found: list[tuple[int, str]] = []
    for node in ast.walk(ast.parse(path.read_text())):
        if isinstance(node, ast.ImportFrom) and node.module:
            found.append((node.lineno, node.module))
        elif isinstance(node, ast.Import):
            found.extend((node.lineno, alias.name) for alias in node.names)
    return found


def _allowed(module: str) -> bool:
    if module in ROOT_POLICY:
        return True
    if module == "oncall.domain" or module.startswith("oncall.domain."):
        return True
    if module.startswith("oncall"):
        return False
    # Everything outside the package: the standard library only. The domain
    # reaches no framework and no client library of its own; `holidays` arrives
    # through `oncall.workdays`, which is the module that owns that dependency.
    return module.split(".")[0] in sys.stdlib_module_names


def test_the_domain_reaches_inward_only() -> None:
    violations = [
        f"{path.relative_to(DOMAIN_ROOT)}:{line} imports {module}"
        for path in DOMAIN_ROOT.rglob("*.py")
        for line, module in _imports(path)
        if not _allowed(module)
    ]
    assert violations == [], "Dependency direction violations:\n" + "\n".join(violations)
