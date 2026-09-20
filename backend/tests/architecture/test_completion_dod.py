"""Executable gates for the architecture completion definition of done.

Each gate is strict-xfailed only while its corresponding production gap exists.
The small temporary projects below mutation-check the scanners themselves, so a
green gate cannot mean that its forbidden construct went unnoticed.
"""

import ast
from collections.abc import Iterable
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[2]
PACKAGE_PATH = Path("src/oncall")
MIGRATIONS_PATH = Path("migrations")
HISTORICAL_MIGRATIONS_PATH = MIGRATIONS_PATH / "versions"

TRANSACTION_OWNER_FILES = frozenset(
    {
        Path("database.py"),
        Path("seed_admin.py"),
        Path("seed_demo.py"),
    }
)
WALL_CLOCK_SYMBOLS = frozenset(
    {
        "datetime.date.today",
        "datetime.datetime.now",
        "datetime.datetime.today",
        "datetime.datetime.utcnow",
        "time.time",
        "time.time_ns",
    }
)
LEGACY_PORT_NAMES = frozenset(
    {
        "AccessPorts",
        "AdminPorts",
        "AvailabilityPorts",
        "RotationBook",
        "Schedules",
        "SchedulingPorts",
        "SharingPorts",
    }
)
MAX_PROTOCOL_METHODS = 8
MAX_BUNDLE_FIELDS = 8


def _python_files(*roots: Path) -> list[Path]:
    return sorted(path for root in roots if root.exists() for path in root.rglob("*.py"))


def _tree(path: Path) -> ast.Module:
    return ast.parse(path.read_text(), filename=str(path))


def _location(path: Path, project_root: Path, line: int) -> str:
    return f"{path.relative_to(project_root)}:{line}"


def _import_bindings(tree: ast.Module) -> dict[str, str]:
    """Map local import names to their qualified targets."""
    bindings: dict[str, str] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                local_name = alias.asname or alias.name.split(".")[0]
                bindings[local_name] = alias.name if alias.asname else local_name
        elif isinstance(node, ast.ImportFrom) and node.module:
            for alias in node.names:
                if alias.name != "*":
                    bindings[alias.asname or alias.name] = f"{node.module}.{alias.name}"
    return bindings


def _qualified_name(node: ast.expr, bindings: dict[str, str]) -> str | None:
    if isinstance(node, ast.Name):
        return bindings.get(node.id, node.id)
    if isinstance(node, ast.Attribute):
        owner = _qualified_name(node.value, bindings)
        if owner:
            return f"{owner}.{node.attr}"
    return None


def _transaction_violations(project_root: Path) -> list[str]:
    package_root = project_root / PACKAGE_PATH
    violations: list[str] = []
    for path in _python_files(package_root):
        if path.relative_to(package_root) in TRANSACTION_OWNER_FILES:
            continue
        for node in ast.walk(_tree(path)):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr in {"commit", "rollback"}
            ):
                violations.append(
                    f"{_location(path, project_root, node.lineno)} calls "
                    f"{node.func.attr}() outside a transaction owner"
                )
    return violations


def _wall_clock_violations(project_root: Path) -> list[str]:
    package_root = project_root / PACKAGE_PATH
    migrations_root = project_root / MIGRATIONS_PATH
    clock_path = package_root / "domain" / "clock.py"
    historical_migrations = project_root / HISTORICAL_MIGRATIONS_PATH
    violations: list[str] = []

    for path in _python_files(package_root, migrations_root):
        if path == clock_path or path.is_relative_to(historical_migrations):
            continue
        tree = _tree(path)
        bindings = _import_bindings(tree)
        for node in ast.walk(tree):
            if not isinstance(node, ast.Attribute | ast.Name):
                continue
            symbol = _qualified_name(node, bindings)
            if symbol in WALL_CLOCK_SYMBOLS:
                violations.append(
                    f"{_location(path, project_root, node.lineno)} accesses {symbol} directly"
                )
    return violations


def _imports_central_models(path: Path, tree: ast.Module, package_root: Path) -> list[int]:
    lines: list[int] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            if any(alias.name == "oncall.models" for alias in node.names):
                lines.append(node.lineno)
        elif isinstance(node, ast.ImportFrom):
            imports_registry = (
                node.module == "oncall.models"
                or (node.module == "oncall" and any(alias.name == "models" for alias in node.names))
                or (
                    path.is_relative_to(package_root)
                    and node.level > 0
                    and (
                        node.module == "models"
                        or (
                            node.module is None
                            and any(alias.name == "models" for alias in node.names)
                        )
                    )
                )
            )
            if imports_registry:
                lines.append(node.lineno)
    return lines


def _central_models_violations(project_root: Path) -> list[str]:
    package_root = project_root / PACKAGE_PATH
    registry = package_root / "models.py"
    violations: list[str] = []
    if registry.exists():
        violations.append(f"{registry.relative_to(project_root)} is a central ORM registry")

    roots = (project_root / "src", project_root / "tests", project_root / "migrations")
    for path in _python_files(*roots):
        for line in _imports_central_models(path, _tree(path), package_root):
            violations.append(
                f"{_location(path, project_root, line)} imports the central oncall.models module"
            )
    return violations


def _defined_name(node: ast.AST) -> str | None:
    if isinstance(node, ast.ClassDef | ast.FunctionDef | ast.AsyncFunctionDef):
        return node.name
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    if isinstance(node, ast.alias):
        return node.name.rsplit(".", 1)[-1]
    return None


def _protocol_classes(tree: ast.Module, bindings: dict[str, str]) -> list[ast.ClassDef]:
    classes = {node.name: node for node in tree.body if isinstance(node, ast.ClassDef)}
    protocol_names = {
        node.name
        for node in classes.values()
        if any(_qualified_name(base, bindings) == "typing.Protocol" for base in node.bases)
    }
    changed = True
    while changed:
        changed = False
        for node in classes.values():
            if node.name in protocol_names:
                continue
            base_names = {
                qualified.rsplit(".", 1)[-1]
                for base in node.bases
                if (qualified := _qualified_name(base, bindings))
            }
            if base_names & protocol_names:
                protocol_names.add(node.name)
                changed = True
    return [classes[name] for name in sorted(protocol_names)]


def _is_dataclass(node: ast.ClassDef, bindings: dict[str, str]) -> bool:
    for decorator in node.decorator_list:
        target = decorator.func if isinstance(decorator, ast.Call) else decorator
        if _qualified_name(target, bindings) == "dataclasses.dataclass":
            return True
    return False


def _port_structure_violations(project_root: Path) -> list[str]:
    source_root = project_root / PACKAGE_PATH
    violations: list[str] = []
    for path in _python_files(source_root, project_root / "tests"):
        tree = _tree(path)
        for node in ast.walk(tree):
            name = _defined_name(node)
            line = getattr(node, "lineno", None)
            if name in LEGACY_PORT_NAMES and isinstance(line, int):
                violations.append(
                    f"{_location(path, project_root, line)} uses legacy port name {name}"
                )

        if not path.is_relative_to(source_root):
            continue
        bindings = _import_bindings(tree)
        for protocol in _protocol_classes(tree, bindings):
            methods = [
                member
                for member in protocol.body
                if isinstance(member, ast.FunctionDef | ast.AsyncFunctionDef)
            ]
            if len(methods) > MAX_PROTOCOL_METHODS:
                violations.append(
                    f"{_location(path, project_root, protocol.lineno)} Protocol "
                    f"{protocol.name} has {len(methods)} methods (maximum {MAX_PROTOCOL_METHODS})"
                )

        for node in tree.body:
            if not isinstance(node, ast.ClassDef):
                continue
            is_port_bundle = node.name.endswith("Ports") or (
                path.name == "ports.py" and _is_dataclass(node, bindings)
            )
            if not is_port_bundle:
                continue
            fields = [
                member
                for member in node.body
                if isinstance(member, ast.AnnAssign) and isinstance(member.target, ast.Name)
            ]
            if len(fields) > MAX_BUNDLE_FIELDS:
                violations.append(
                    f"{_location(path, project_root, node.lineno)} bundle {node.name} has "
                    f"{len(fields)} fields (maximum {MAX_BUNDLE_FIELDS})"
                )
    return sorted(set(violations))


def _write(root: Path, relative_path: str, source: str) -> None:
    path = root / relative_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(source)


def _assert_no_violations(violations: Iterable[str], title: str) -> None:
    found = list(violations)
    assert found == [], f"{title}:\n" + "\n".join(found)


@pytest.mark.xfail(
    strict=True,
    raises=AssertionError,
    reason="DOD-3: transaction ownership is not centralized yet",
)
def test_dod_3_only_transaction_owners_commit_or_rollback() -> None:
    _assert_no_violations(_transaction_violations(PROJECT_ROOT), "Transaction boundary violations")


def test_dod_3_guard_rejects_a_commit_outside_the_exact_allowlist(tmp_path: Path) -> None:
    for allowed in TRANSACTION_OWNER_FILES:
        _write(tmp_path, str(PACKAGE_PATH / allowed), "async def run(db):\n    await db.commit()\n")
    _write(
        tmp_path,
        "src/oncall/worker.py",
        "async def run(db):\n    await db.commit()\n    await db.rollback()\n",
    )
    _write(tmp_path, "src/oncall/seed_helper.py", "async def run(db):\n    await db.commit()\n")

    violations = _transaction_violations(tmp_path)

    assert len(violations) == 3
    assert any("worker.py:2 calls commit()" in violation for violation in violations)
    assert any("worker.py:3 calls rollback()" in violation for violation in violations)
    assert any("seed_helper.py:2 calls commit()" in violation for violation in violations)
    assert all(
        not any(str(path) in violation for path in TRANSACTION_OWNER_FILES)
        for violation in violations
    )


@pytest.mark.xfail(
    strict=True,
    raises=AssertionError,
    reason="DOD-4: runtime wall-clock access still bypasses Clock",
)
def test_dod_4_runtime_wall_clock_access_goes_through_clock() -> None:
    _assert_no_violations(_wall_clock_violations(PROJECT_ROOT), "Direct wall-clock access")


def test_dod_4_guard_rejects_runtime_time_but_allows_clock_and_migrations(
    tmp_path: Path,
) -> None:
    _write(
        tmp_path,
        "src/oncall/domain/clock.py",
        "from datetime import UTC, datetime\ndef utc_now():\n    return datetime.now(UTC)\n",
    )
    _write(
        tmp_path,
        "src/oncall/worker.py",
        "import time\nfrom datetime import datetime as Instant\n"
        "started = time.monotonic()\ncreated_at = Instant.now\nepoch = time.time()\n",
    )
    _write(
        tmp_path,
        "migrations/versions/0001_history.py",
        "from datetime import date\ncreated_on = date.today()\n",
    )

    violations = _wall_clock_violations(tmp_path)

    assert len(violations) == 2
    assert any(
        "worker.py:4 accesses datetime.datetime.now" in violation for violation in violations
    )
    assert any("worker.py:5 accesses time.time" in violation for violation in violations)
    assert all("clock.py" not in violation for violation in violations)
    assert all("migrations/versions" not in violation for violation in violations)


@pytest.mark.xfail(
    strict=True,
    raises=AssertionError,
    reason="DOD-6: the central ORM registry and its imports remain",
)
def test_dod_6_has_no_central_models_module_or_imports() -> None:
    _assert_no_violations(
        _central_models_violations(PROJECT_ROOT), "Central ORM registry violations"
    )


def test_dod_6_guard_rejects_the_registry_and_absolute_or_relative_imports(
    tmp_path: Path,
) -> None:
    _write(tmp_path, "src/oncall/models.py", "class User:\n    pass\n")
    _write(tmp_path, "src/oncall/worker.py", "from oncall.models import User\n")
    _write(tmp_path, "src/oncall/routes/admin.py", "from .. import models\n")

    violations = _central_models_violations(tmp_path)

    assert len(violations) == 3
    assert any(
        violation == "src/oncall/models.py is a central ORM registry" for violation in violations
    )
    assert any("worker.py:1 imports" in violation for violation in violations)
    assert any("admin.py:1 imports" in violation for violation in violations)


@pytest.mark.xfail(
    strict=True,
    raises=AssertionError,
    reason="DOD-9: broad legacy ports and bundles remain",
)
def test_dod_9_ports_are_consumer_owned_and_small() -> None:
    _assert_no_violations(
        _port_structure_violations(PROJECT_ROOT), "Consumer-owned port violations"
    )


def test_dod_9_guard_rejects_legacy_names_wide_protocols_and_bundles(tmp_path: Path) -> None:
    methods = "\n".join(f"    def operation_{index}(self): ..." for index in range(9))
    fields = "\n".join(f"    dependency_{index}: object" for index in range(9))
    _write(
        tmp_path,
        "src/oncall/domain/orders/ports.py",
        "from dataclasses import dataclass\nfrom typing import Protocol\n\n"
        f"class OrderStore(Protocol):\n{methods}\n\n"
        "@dataclass(frozen=True)\n"
        f"class OrderCommandPorts:\n{fields}\n\n"
        "AvailabilityPorts = OrderCommandPorts\n",
    )

    violations = _port_structure_violations(tmp_path)

    assert any("uses legacy port name AvailabilityPorts" in violation for violation in violations)
    assert any("Protocol OrderStore has 9 methods" in violation for violation in violations)
    assert any("bundle OrderCommandPorts has 9 fields" in violation for violation in violations)
