"""The mapper registry keeps the split ORM whole without becoming a new `models.py`.

Each feature owns its mapped rows, and a relationship into another feature's
module names its target as a forward reference. SQLAlchemy resolves those the
first time any mapper is used, which works only once every model module has
been imported. `model_registry` imports them all, for the process entry points,
Alembic and the test bootstrap, and for nobody else.

The mapper checks run in fresh interpreters: this process has already imported
every model through `conftest.py`, so its own registry proves nothing.
"""

import ast
import json
import subprocess
import sys
from functools import cache
from pathlib import Path
from typing import TypedDict

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[2]
MODELS_PACKAGE = "oncall.infrastructure.sqlalchemy"
REGISTRY_MODULE = f"{MODELS_PACKAGE}.model_registry"
REGISTRY_PATH = PROJECT_ROOT / "src" / Path(*REGISTRY_MODULE.split(".")).with_suffix(".py")

#: Every process that uses the ORM, by the module production starts it from.
ENTRY_POINTS = ("oncall.main", "oncall.worker", "oncall.seed_admin", "oncall.seed_demo")

#: The only importers of the registry: the entry points above (`oncall.main`
#: through the HTTP bootstrap), Alembic and the test bootstrap.
REGISTRY_IMPORTERS = frozenset(
    {
        Path("src/oncall/bootstrap/http.py"),
        Path("src/oncall/worker.py"),
        Path("src/oncall/seed_admin.py"),
        Path("src/oncall/seed_demo.py"),
        Path("migrations/env.py"),
        Path("tests/conftest.py"),
    }
)

MAPPER_PROBE = """
import importlib, json, pkgutil, sys
from sqlalchemy import event
from sqlalchemy.orm import Mapper, configure_mappers

configured_on_import = []
event.listen(Mapper, "before_configured", lambda: configured_on_import.append(True))

names = sys.argv[1:]
if names == ["--whole-package"]:
    import oncall
    names = [module.name for module in pkgutil.walk_packages(oncall.__path__, "oncall.")]
for name in names:
    importlib.import_module(name)
imports_configured = bool(configured_on_import)
configure_mappers()

from oncall.infrastructure.sqlalchemy.base import Base

print(json.dumps({
    "configured_on_import": imports_configured,
    "mappers": sorted(
        f"{mapper.class_.__module__}.{mapper.class_.__qualname__}"
        for mapper in Base.registry.mappers
    ),
    "tables": sorted(Base.metadata.tables),
}))
"""


class MapperGraph(TypedDict):
    configured_on_import: bool
    mappers: list[str]
    tables: list[str]


def _mapped_after_importing(*modules: str) -> MapperGraph:
    result = subprocess.run(
        [sys.executable, "-c", MAPPER_PROBE, *modules],
        capture_output=True,
        text=True,
        cwd=PROJECT_ROOT,
    )
    assert result.returncode == 0, result.stderr
    loaded: MapperGraph = json.loads(result.stdout)
    return loaded


@cache
def _registered() -> MapperGraph:
    return _mapped_after_importing(REGISTRY_MODULE)


@cache
def _whole_package() -> MapperGraph:
    return _mapped_after_importing("--whole-package")


def test_registry_maps_every_class_the_package_defines() -> None:
    everything = _whole_package()

    assert _registered()["mappers"] == everything["mappers"]
    assert _registered()["tables"] == everything["tables"]
    assert everything["mappers"]
    assert all(name.startswith(f"{MODELS_PACKAGE}.") for name in everything["mappers"])


def test_importing_a_module_configures_no_mapper() -> None:
    """A loader option or `inspect()` at module level configures every mapper
    on import, and fails whenever a relationship target is not loaded yet."""
    assert _whole_package()["configured_on_import"] is False


@pytest.mark.parametrize("entry_point", ENTRY_POINTS)
def test_each_entry_point_configures_the_whole_mapper_graph(entry_point: str) -> None:
    assert _mapped_after_importing(entry_point) == _registered()


def test_registry_only_imports_model_modules() -> None:
    tree = ast.parse(REGISTRY_PATH.read_text())
    body = tree.body[1:] if ast.get_docstring(tree) is not None else tree.body

    assert body
    for statement in body:
        assert isinstance(statement, ast.Import), (
            f"model_registry.py:{statement.lineno} does more than import a model module"
        )
        for alias in statement.names:
            assert alias.asname is None
            assert alias.name.startswith(f"{MODELS_PACKAGE}.")


def _imports_registry(node: ast.AST) -> bool:
    if isinstance(node, ast.Import):
        return any(alias.name == REGISTRY_MODULE for alias in node.names)
    if isinstance(node, ast.ImportFrom):
        return node.module == REGISTRY_MODULE or (
            node.module == MODELS_PACKAGE
            and any(alias.name == "model_registry" for alias in node.names)
        )
    return False


def test_only_bootstrap_code_imports_the_registry() -> None:
    importers = {
        path.relative_to(PROJECT_ROOT)
        for root in ("src", "tests", "migrations", "scripts")
        for path in (PROJECT_ROOT / root).rglob("*.py")
        if any(_imports_registry(node) for node in ast.walk(ast.parse(path.read_text())))
    }

    assert importers == REGISTRY_IMPORTERS
