"""The schema the migrations build is the schema the models describe, and
the rules it holds that SQLite cannot show.

`alembic check` compares tables, columns, types, indexes and keys, but not
check or exclusion constraints, collations, server defaults, or what a
foreign key does on delete. The test suites build their tables from the
models, so a rule declared there and missing from a migration would pass
every test and be absent in production. This builds both schemas in two
fresh databases and compares what PostgreSQL itself reports about them.

Skipped unless ``ONCALL_TEST_POSTGRES_URL`` points at a PostgreSQL server
where that user may create databases; the ones it creates beside the named
database are dropped afterwards.
"""

import asyncio
import os
import sys
from collections.abc import AsyncIterator
from datetime import date
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession, create_async_engine

from oncall.domain.vocabulary import AssignmentRole, AvailabilityKind
from oncall.infrastructure.sqlalchemy.availability_model import Availability
from oncall.infrastructure.sqlalchemy.base import Base
from oncall.infrastructure.sqlalchemy.reports import SqlAlchemyReportRoster
from oncall.infrastructure.sqlalchemy.team_models import Eligibility, TeamMember

POSTGRES_URL = os.environ.get("ONCALL_TEST_POSTGRES_URL")
pytestmark = pytest.mark.skipif(not POSTGRES_URL, reason="ONCALL_TEST_POSTGRES_URL is not set")

BACKEND = Path(__file__).resolve().parents[1]

#: What PostgreSQL reports about a schema, one query per kind of object. Each
#: row's leading columns name the object and the rest describe it.
CATALOG = {
    "column": """
        SELECT table_name, column_name, data_type, character_maximum_length,
               is_nullable, column_default, collation_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name <> 'alembic_version'
    """,
    "constraint": """
        SELECT conrelid::regclass::text, conname, pg_get_constraintdef(oid)
        FROM pg_constraint
        WHERE connamespace = 'public'::regnamespace
          AND conrelid::regclass::text <> 'alembic_version'
    """,
    "index": """
        SELECT tablename, indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public' AND tablename <> 'alembic_version'
    """,
    "extension": "SELECT extname, extname FROM pg_extension",
}
NAME_COLUMNS = {"column": 2, "constraint": 2, "index": 2, "extension": 1}


async def _recreate(admin: AsyncConnection, name: str) -> None:
    await admin.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
    await admin.execute(text(f'CREATE DATABASE "{name}"'))


async def _catalog(url: URL) -> dict[tuple, tuple]:
    engine = create_async_engine(url)
    try:
        async with engine.connect() as connection:
            found = {}
            for kind, query in CATALOG.items():
                split = NAME_COLUMNS[kind]
                for row in await connection.execute(text(query)):
                    found[(kind, *row[:split])] = tuple(row[split:])
            return found
    finally:
        await engine.dispose()


@pytest.fixture
async def databases() -> AsyncIterator[tuple[URL, URL]]:
    assert POSTGRES_URL is not None
    base = make_url(POSTGRES_URL)
    migrated = base.set(database=f"{base.database}_migrated")
    modelled = base.set(database=f"{base.database}_modelled")
    admin_engine = create_async_engine(base, isolation_level="AUTOCOMMIT")
    try:
        async with admin_engine.connect() as admin:
            for url in (migrated, modelled):
                await _recreate(admin, str(url.database))
        yield migrated, modelled
        async with admin_engine.connect() as admin:
            for url in (migrated, modelled):
                await admin.execute(text(f'DROP DATABASE IF EXISTS "{url.database}" WITH (FORCE)'))
    finally:
        await admin_engine.dispose()


async def test_the_migrations_build_the_schema_the_models_describe(
    databases: tuple[URL, URL],
) -> None:
    migrated, modelled = databases
    upgrade = await asyncio.create_subprocess_exec(
        sys.executable,
        "-m",
        "alembic",
        "upgrade",
        "head",
        cwd=BACKEND,
        env={**os.environ, "ONCALL_DATABASE_URL": migrated.render_as_string(hide_password=False)},
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    output, _ = await upgrade.communicate()
    assert upgrade.returncode == 0, output.decode()
    engine = create_async_engine(modelled)
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
    finally:
        await engine.dispose()

    from_migrations = await _catalog(migrated)
    from_models = await _catalog(modelled)

    differences = sorted(
        (key, from_migrations.get(key), from_models.get(key))
        for key in from_migrations.keys() | from_models.keys()
        if from_migrations.get(key) != from_models.get(key)
    )
    assert differences == [], "\n".join(
        f"{key}: migrations {migrations!r}, models {models!r}"
        for key, migrations, models in differences
    )


@pytest.fixture
async def modelled_db() -> AsyncIterator[AsyncSession]:
    """A database built from the models, as the PostgreSQL suites build it."""
    assert POSTGRES_URL is not None
    base = make_url(POSTGRES_URL)
    url = base.set(database=f"{base.database}_rules")
    admin_engine = create_async_engine(base, isolation_level="AUTOCOMMIT")
    engine = create_async_engine(url)
    try:
        async with admin_engine.connect() as admin:
            await _recreate(admin, str(url.database))
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with AsyncSession(engine, expire_on_commit=False) as session:
            yield session
    finally:
        await engine.dispose()
        async with admin_engine.connect() as admin:
            await admin.execute(text(f'DROP DATABASE IF EXISTS "{url.database}" WITH (FORCE)'))
        await admin_engine.dispose()


def _member(name: str) -> TeamMember:
    return TeamMember(display_name=name, active_from=date(2026, 1, 1))


async def test_the_report_lists_people_in_polish_alphabetical_order(
    modelled_db: AsyncSession,
) -> None:
    names = ["Żaneta Nowak", "Marek Mróz", "Łukasz Zając", "ala Kowalska", "Lech Lis", "Ewa Ćwik"]
    modelled_db.add_all(_member(name) for name in names)
    await modelled_db.commit()

    roster = await SqlAlchemyReportRoster(modelled_db).members_active_between(
        date(2026, 10, 1), date(2026, 10, 31)
    )

    assert [entry.display_name for entry in roster] == [
        "ala Kowalska",
        "Ewa Ćwik",
        "Lech Lis",
        "Łukasz Zając",
        "Marek Mróz",
        "Żaneta Nowak",
    ]


async def test_a_persons_periods_cannot_overlap(modelled_db: AsyncSession) -> None:
    anna = _member("Anna")
    modelled_db.add(anna)
    modelled_db.add_all(
        [
            Eligibility(
                member=anna, role=AssignmentRole.primary, starts_on=date(2026, 1, 1), ends_on=None
            ),
            Eligibility(
                member=anna,
                role=AssignmentRole.secondary,
                starts_on=date(2026, 1, 1),
                ends_on=date(2026, 6, 30),
            ),
            # The day after an end is free again.
            Eligibility(
                member=anna,
                role=AssignmentRole.secondary,
                starts_on=date(2026, 7, 1),
                ends_on=None,
            ),
            Availability(
                member=anna,
                kind=AvailabilityKind.unavailable,
                starts_on=date(2026, 10, 1),
                ends_on=date(2026, 10, 5),
            ),
        ]
    )
    await modelled_db.commit()

    overlapping = [
        Eligibility(
            member_id=anna.id,
            role=AssignmentRole.primary,
            starts_on=date(2027, 3, 1),
            ends_on=date(2027, 3, 31),
        ),
        Availability(
            member_id=anna.id,
            kind=AvailabilityKind.prefer,
            starts_on=date(2026, 10, 5),
            ends_on=date(2026, 10, 9),
        ),
    ]
    for row in overlapping:
        with pytest.raises(IntegrityError, match="no_overlap"):
            async with modelled_db.begin_nested():
                modelled_db.add(row)
